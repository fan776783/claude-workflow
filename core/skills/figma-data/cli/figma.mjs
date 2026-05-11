#!/usr/bin/env node
// figma — thin CLI over the Figma Desktop MCP Server (Streamable HTTP / SSE).
// Wraps all Figma MCP tools + asset management (tmp dir, diff, cleanup).

import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// ── config ───────────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "http://127.0.0.1:3845/mcp";
const ENDPOINT = process.env.FIGMA_MCP_URL || DEFAULT_ENDPOINT;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `node ${SCRIPT_PATH}`;

const TOOLS = [
  "get_design_context",
  "get_screenshot",
  "get_metadata",
  "get_variable_defs",
  "get_figjam",
  "create_design_system_rules",
];

// ── MCP transport ────────────────────────────────────────────────────────────

async function parseMcpResponse(res) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (ct.includes("application/json")) {
    return { sessionId: res.headers.get("mcp-session-id"), body: JSON.parse(text) };
  }
  // SSE format
  const events = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  let data = null;
  for (const ev of events) {
    const lines = ev.split(/\n/);
    const payload = lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (payload) {
      try { data = JSON.parse(payload); } catch { /* skip non-json */ }
    }
  }
  if (!data) throw new Error(`empty MCP response (ct=${ct}): ${text.slice(0, 300)}`);
  return { sessionId: res.headers.get("mcp-session-id"), body: data };
}

async function rpc({ sessionId, body }) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  return parseMcpResponse(res);
}

async function sendNotification({ sessionId, body }) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok && res.status !== 202) {
    const t = await res.text().catch(() => "");
    throw new Error(`notification failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
}

async function openSession() {
  const init = await rpc({
    sessionId: null,
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "figma-cli", version: "0.1.0" },
      },
    },
  });
  if (init.body.error) throw new Error(`initialize: ${JSON.stringify(init.body.error)}`);
  const sessionId = init.sessionId;
  await sendNotification({
    sessionId,
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  return { sessionId, server: init.body.result };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function die(msg, code = 1) {
  process.stderr.write(msg.endsWith("\n") ? msg : msg + "\n");
  process.exit(code);
}

function parseToolArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json" || a === "-j") {
      const raw = argv[++i];
      if (!raw) die("--json requires a value");
      Object.assign(out, JSON.parse(raw));
      continue;
    }
    if (!a.startsWith("--")) die(`unexpected argument: ${a}`);
    let key, raw;
    if (a.includes("=")) {
      [key, raw] = [a.slice(2, a.indexOf("=")), a.slice(a.indexOf("=") + 1)];
    } else {
      key = a.slice(2);
      raw = argv[++i];
      if (raw === undefined) die(`--${key} requires a value`);
    }
    out[key] = coerce(raw);
  }
  return out;
}

function coerce(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
    try { return JSON.parse(v); } catch { /* fall through */ }
  }
  return v;
}

function parseNodeId(url) {
  if (!url) return null;
  // Figma URL: node-id query param
  const m = url.match(/node-id=([^&]+)/);
  if (m) return m[1].replace("-", ":");
  // Already a node id
  if (/^-?\d+[:-]-?\d+$/.test(url)) return url.replace("-", ":");
  return null;
}

function parseFileKey(url) {
  if (!url) return null;
  // Branch URL: /design/:fileKey/branch/:branchKey/:name → use branchKey
  const branchMatch = url.match(/\/design\/[^/]+\/branch\/([^/]+)/);
  if (branchMatch) return branchMatch[1];
  // Standard URL: /design/:fileKey/:name
  const m = url.match(/\/design\/([^/]+)/);
  if (m) return m[1];
  return null;
}

// ── asset management ─────────────────────────────────────────────────────────

function getAssetsDir() {
  const cfgPath = resolve(process.cwd(), ".claude/config/ui-config.json");
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      if (cfg.assetsDir) return resolve(process.cwd(), cfg.assetsDir);
    } catch { /* fall through */ }
  }
  return resolve(process.cwd(), "public/images");
}

function createTaskDir(assetsDir, taskId) {
  const dir = join(assetsDir, ".figma-ui", "tmp", taskId || randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function listDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

// ── commands ─────────────────────────────────────────────────────────────────

async function cmdCall(tool, rest) {
  if (!TOOLS.includes(tool)) {
    die(`unknown tool: ${tool}\navailable: ${TOOLS.join(", ")}`);
  }
  const args = parseToolArgs(rest);

  // Convenience: --url extracts fileKey + nodeId
  if (args.url) {
    const url = args.url;
    delete args.url;
    if (!args.nodeId) {
      const nid = parseNodeId(url);
      if (nid) args.nodeId = nid;
    }
    if (!args.fileKey) {
      const fk = parseFileKey(url);
      if (fk) args.fileKey = fk;
    }
  }

  const { sessionId } = await openSession();
  const res = await rpc({
    sessionId,
    body: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    },
  });
  if (res.body.error) die(`tool error: ${JSON.stringify(res.body.error)}`);
  const r = res.body.result;
  if (r?.isError) {
    process.stderr.write(JSON.stringify(r, null, 2) + "\n");
    process.exit(2);
  }
  // Output content
  const contents = r?.content || [];
  for (const c of contents) {
    if (c.type === "text") {
      process.stdout.write(c.text + "\n");
    } else if (c.type === "image") {
      // Write base64 image to file
      const ext = (c.mimeType || "image/png").split("/")[1] || "png";
      const fname = `screenshot-${Date.now()}.${ext}`;
      const buf = Buffer.from(c.data, "base64");
      writeFileSync(fname, buf);
      process.stdout.write(`[image saved: ${resolve(fname)}]\n`);
    } else {
      process.stdout.write(JSON.stringify(c, null, 2) + "\n");
    }
  }
}

async function cmdDesign(rest) {
  // High-level wrapper: handles dirForAssetWrites + diff automatically
  const args = parseToolArgs(rest);

  // Convenience: --url
  if (args.url) {
    const url = args.url;
    delete args.url;
    if (!args.nodeId) {
      const nid = parseNodeId(url);
      if (nid) args.nodeId = nid;
    }
    if (!args.fileKey) {
      const fk = parseFileKey(url);
      if (fk) args.fileKey = fk;
    }
  }

  // Auto-manage dirForAssetWrites
  const assetsDir = args.assetsDir || getAssetsDir();
  delete args.assetsDir;
  const taskId = args.taskId || randomUUID().slice(0, 8);
  delete args.taskId;
  const taskDir = createTaskDir(assetsDir, taskId);

  if (!args.dirForAssetWrites) {
    args.dirForAssetWrites = taskDir;
  }

  // Snapshot before
  const before = new Set(listDir(taskDir));

  // Call get_design_context
  const { sessionId } = await openSession();
  const res = await rpc({
    sessionId,
    body: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_design_context", arguments: args },
    },
  });
  if (res.body.error) die(`tool error: ${JSON.stringify(res.body.error)}`);
  const r = res.body.result;
  if (r?.isError) {
    const errorText = r.content?.[0]?.text || "";
    const isDirNotAllowed = errorText.includes("Cannot write to this directory") || errorText.includes("allowed directories");
    const structured = {
      error: isDirNotAllowed ? "dir_not_allowed" : "tool_error",
      message: errorText,
      fallback: isDirNotAllowed ? "screenshot_and_metadata" : null,
    };
    process.stdout.write(JSON.stringify(structured, null, 2) + "\n");
    process.exit(2);
  }

  // Wait for async asset writes
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Snapshot after → diff
  const after = new Set(listDir(taskDir));
  const newFiles = [...after].filter((f) => !before.has(f));

  // Output
  const output = {
    taskId,
    taskDir,
    newlyDownloadedFiles: newFiles,
    totalFilesInDir: after.size,
  };

  // Extract text content
  const contents = r?.content || [];
  const textParts = [];
  for (const c of contents) {
    if (c.type === "text") textParts.push(c.text);
    else if (c.type === "image") {
      const ext = (c.mimeType || "image/png").split("/")[1] || "png";
      const fname = join(taskDir, `_screenshot.${ext}`);
      writeFileSync(fname, Buffer.from(c.data, "base64"));
      output.screenshot = fname;
    }
  }

  if (textParts.length) output.designContext = textParts.join("\n");

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

async function cmdScreenshot(rest) {
  const args = parseToolArgs(rest);
  if (args.url) {
    const url = args.url;
    delete args.url;
    if (!args.nodeId) { const nid = parseNodeId(url); if (nid) args.nodeId = nid; }
    if (!args.fileKey) { const fk = parseFileKey(url); if (fk) args.fileKey = fk; }
  }

  const outDir = args.outDir || ".";
  delete args.outDir;

  const { sessionId } = await openSession();
  const res = await rpc({
    sessionId,
    body: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_screenshot", arguments: args },
    },
  });
  if (res.body.error) die(`tool error: ${JSON.stringify(res.body.error)}`);
  const r = res.body.result;
  if (r?.isError) {
    process.stderr.write(JSON.stringify(r, null, 2) + "\n");
    process.exit(2);
  }

  const contents = r?.content || [];
  for (const c of contents) {
    if (c.type === "image") {
      const ext = (c.mimeType || "image/png").split("/")[1] || "png";
      const fname = join(outDir, `screenshot-${args.nodeId || "selection"}.${ext}`.replace(":", "-"));
      mkdirSync(outDir, { recursive: true });
      writeFileSync(fname, Buffer.from(c.data, "base64"));
      process.stdout.write(`${resolve(fname)}\n`);
    } else if (c.type === "text") {
      process.stdout.write(c.text + "\n");
    }
  }
}

function cmdCleanup(rest) {
  const args = parseToolArgs(rest);
  const assetsDir = args.assetsDir || getAssetsDir();
  const taskId = args.taskId;

  if (taskId) {
    const dir = join(assetsDir, ".figma-ui", "tmp", taskId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
      process.stdout.write(`removed: ${dir}\n`);
    } else {
      die(`task dir not found: ${dir}`);
    }
  } else {
    // Clean all tmp dirs
    const tmpRoot = join(assetsDir, ".figma-ui", "tmp");
    if (existsSync(tmpRoot)) {
      const dirs = readdirSync(tmpRoot);
      for (const d of dirs) {
        rmSync(join(tmpRoot, d), { recursive: true });
      }
      process.stdout.write(`removed ${dirs.length} task dir(s) from ${tmpRoot}\n`);
    } else {
      process.stdout.write("no tmp dirs to clean\n");
    }
  }
}

async function cmdListTools() {
  const { sessionId } = await openSession();
  const res = await rpc({
    sessionId,
    body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  if (res.body.error) die(`tools/list: ${JSON.stringify(res.body.error)}`);
  const tools = res.body.result?.tools || [];
  for (const t of tools) {
    process.stdout.write(`${t.name} — ${(t.description || "").split("\n")[0]}\n`);
  }
}

async function cmdPing() {
  const { server } = await openSession();
  process.stdout.write(JSON.stringify({ ok: true, endpoint: ENDPOINT, server }, null, 2) + "\n");
}

async function cmdDoctor() {
  const report = {
    endpoint: {
      value: ENDPOINT,
      source: process.env.FIGMA_MCP_URL ? "env FIGMA_MCP_URL" : `default (${DEFAULT_ENDPOINT})`,
    },
    assetsDir: getAssetsDir(),
    connectivity: null,
  };

  try {
    const { server } = await openSession();
    report.connectivity = { ok: true, server: server?.serverInfo };
  } catch (e) {
    report.connectivity = { ok: false, error: String(e.message || e) };
  }

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

function cmdHelp() {
  process.stdout.write(
    `figma — CLI for Figma Desktop MCP Server (${ENDPOINT})

invoke as:
  ${INVOCATION} <subcommand> [...]

commands:
  design     Get design context + auto-manage asset downloads
  screenshot Get visual screenshot of a node
  cleanup    Remove task tmp directories
  ping       Test MCP server connectivity
  doctor     Full diagnostic report
  list-tools List all available MCP tools from server

  <tool>     Raw MCP tool call (${TOOLS.join(", ")})

usage examples:
  # High-level: auto tmp dir + asset diff
  ${INVOCATION} design --url "https://figma.com/design/xxx/Name?node-id=42-15"
  ${INVOCATION} design --nodeId 42:15 --taskId my-task

  # Screenshot
  ${INVOCATION} screenshot --url "https://figma.com/design/xxx/Name?node-id=42-15"
  ${INVOCATION} screenshot --nodeId 42:15 --outDir ./screenshots

  # Raw tool calls
  ${INVOCATION} get_design_context --nodeId 42:15 --dirForAssetWrites /tmp/assets
  ${INVOCATION} get_metadata --nodeId 0:1
  ${INVOCATION} get_variable_defs --nodeId 42:15

  # Asset cleanup
  ${INVOCATION} cleanup --taskId my-task
  ${INVOCATION} cleanup                     # remove all tmp dirs

  # URL convenience: --url extracts fileKey + nodeId automatically
  # Works with any tool or high-level command

env:
  FIGMA_MCP_URL  Override endpoint (default: ${DEFAULT_ENDPOINT})
`,
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "-h":
      case "--help":
        return cmdHelp();
      case "design":
        return await cmdDesign(rest);
      case "screenshot":
        return await cmdScreenshot(rest);
      case "cleanup":
        return cmdCleanup(rest);
      case "ping":
        return await cmdPing();
      case "doctor":
        return await cmdDoctor();
      case "list-tools":
        return await cmdListTools();
      default:
        return await cmdCall(cmd, rest);
    }
  } catch (e) {
    die(`error: ${e.message || e}`);
  }
}

main();
