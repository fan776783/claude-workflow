#!/usr/bin/env node
// figma — thin CLI over the Figma Desktop MCP Server (Streamable HTTP / SSE).
// Wraps Figma MCP tools + asset management (tmp dir, diff, cleanup).
//
// 共享基础设施（RPC / cache / fingerprint / arg parsing / danger / 错误归一化 /
// baseline diff）来自 ../../_shared/mcp-baseline.mjs，见 ADR-0001。
//
// Design Package 输出 schemaVersion="1.1"（ADR-0005：新增 taskType echo，契约移除
// DesignAnchors → DesignInventory）。`design` 内部检测 get_design_context
// tool_not_found 时降级到 screenshot + get_metadata 只读路径。
// --taskType CREATE_ARTIFACT|CHANGE_ARTIFACT 透传给 get_design_context 并 echo 到输出。

import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  parseToolArgs,
  callTool,
  listToolsRemote,
  rpcRaw,
  rpcNotify,
  McpToolsCache,
  dangerClass,
  normalizeMcpError,
  buildBaseline,
  diffTools,
  diffHasChanges,
  EXIT_CODES,
  ERROR_KINDS,
} from "../../_shared/mcp-baseline.mjs";

// ── config ────────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "http://127.0.0.1:3845/mcp";
const ENDPOINT = process.env.FIGMA_MCP_URL || DEFAULT_ENDPOINT;
const CACHE_DIR = join(homedir(), ".cache", "figma-mcp");

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const INVOCATION = `node ${SCRIPT_PATH}`;
const BASELINE_PATH = resolve(SCRIPT_DIR, "..", "baseline-schema.json");

const DESIGN_PACKAGE_SCHEMA_VERSION = "1.1";
const DEFAULT_TASK_TYPE = "CREATE_ARTIFACT";
// Design Package contract enum (ADR-0005). The MCP server additionally accepts
// DELETE_ARTIFACT, but that never yields a Design Package — use `raw` for it.
const VALID_TASK_TYPES = new Set(["CREATE_ARTIFACT", "CHANGE_ARTIFACT"]);

// Figma MCP tools are read-only today; prefix fallback handles future destructive
// additions. Listed registry intentionally empty.
const DANGEROUS_TOOLS = {};

const TOOLS = [
  "get_design_context",
  "get_screenshot",
  "get_metadata",
  "get_variable_defs",
  "get_figjam",
  "create_design_system_rules",
];

const toolsCache = new McpToolsCache({ cacheDir: CACHE_DIR });

// ── helpers ───────────────────────────────────────────────────────────────

function die(msg, code = 1) {
  const out = typeof msg === "string" ? msg : String(msg);
  process.stderr.write(out.endsWith("\n") ? out : out + "\n");
  process.exit(code);
}

function dieOnRpc(errOrBody, fallback) {
  const norm = normalizeMcpError(errOrBody);
  if (norm) {
    process.stderr.write(
      JSON.stringify(
        {
          kind: norm.kind,
          hint: norm.hint,
          originalMessage: norm.originalMessage,
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(norm.exitCode);
  }
  die(fallback);
}

function sessionHeaders(sessionId) {
  return sessionId ? { "mcp-session-id": sessionId } : {};
}

async function openSession() {
  const init = await rpcRaw(ENDPOINT, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "figma-cli", version: "0.2.0" },
    },
  });
  if (init.body.error) {
    throw Object.assign(new Error(`initialize: ${JSON.stringify(init.body.error)}`), {
      rpcError: init.body.error,
    });
  }
  const sessionId = init.sessionId;
  await rpcNotify(
    ENDPOINT,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { headers: sessionHeaders(sessionId) },
  );
  return { sessionId, server: init.body.result };
}

function parseNodeId(url) {
  if (!url) return null;
  const m = url.match(/node-id=([^&]+)/);
  if (m) return m[1].replace("-", ":");
  if (/^-?\d+[:-]-?\d+$/.test(url)) return url.replace("-", ":");
  return null;
}

function parseFileKey(url) {
  if (!url) return null;
  // Branch URL: /design/:fileKey/branch/:branchKey/:name → use branchKey
  const branchMatch = url.match(/\/design\/[^/]+\/branch\/([^/]+)/);
  if (branchMatch) return branchMatch[1];
  const m = url.match(/\/design\/([^/]+)/);
  if (m) return m[1];
  return null;
}

function applyUrlConvenience(args) {
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
}

// ── asset management ─────────────────────────────────────────────────────

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

// ── cache helpers ────────────────────────────────────────────────────────

async function ensureToolsCacheForFigma({ refresh = false } = {}) {
  const fp = toolsCache.read("default", null);
  if (!refresh && fp) return { payload: fp, cached: true };
  const { sessionId, server } = await openSession();
  const headers = sessionHeaders(sessionId);
  const extras = server?.serverInfo?.version
    ? { version: server.serverInfo.version }
    : undefined;
  return toolsCache.ensure({
    key: "default",
    url: ENDPOINT,
    refresh: true,
    headers,
    extras,
  });
}

// ── tool invocation ──────────────────────────────────────────────────────

async function invokeRaw(toolName, args, { onToolNotFound } = {}) {
  let session;
  try {
    session = await openSession();
  } catch (e) {
    dieOnRpc(e.rpcError || e, `error: ${e.message || e}`);
  }
  const headers = sessionHeaders(session.sessionId);

  let body;
  try {
    body = await callTool(ENDPOINT, toolName, args, { headers });
  } catch (e) {
    if (onToolNotFound) {
      const norm = normalizeMcpError(e);
      if (norm?.kind === ERROR_KINDS.TOOL_NOT_FOUND) return onToolNotFound(norm);
    }
    dieOnRpc(e, `error: ${e.message || e}`);
  }
  if (body.error) {
    if (onToolNotFound) {
      const norm = normalizeMcpError(body.error);
      if (norm?.kind === ERROR_KINDS.TOOL_NOT_FOUND) return onToolNotFound(norm);
    }
    dieOnRpc(body.error, `tool error: ${JSON.stringify(body.error)}`);
  }
  const r = body.result;
  if (r?.isError) {
    if (onToolNotFound) {
      const norm = normalizeMcpError(r);
      if (norm?.kind === ERROR_KINDS.TOOL_NOT_FOUND) return onToolNotFound(norm);
    }
    const norm = normalizeMcpError(r);
    if (norm) {
      process.stderr.write(
        JSON.stringify(
          {
            kind: norm.kind,
            hint: norm.hint,
            originalMessage: norm.originalMessage,
            raw: r,
          },
          null,
          2,
        ) + "\n",
      );
      process.exit(norm.exitCode);
    }
    process.stderr.write(JSON.stringify(r, null, 2) + "\n");
    process.exit(EXIT_CODES.SERVER_ERROR);
  }
  return { session, result: r };
}

// ── design command (high-level Design Package) ───────────────────────────

async function fallbackReadOnly({ args, taskId, taskDir, reason }) {
  // Degrade to get_screenshot + get_metadata. Used when get_design_context is
  // unavailable (tool_not_found). Dir rejection takes the separate
  // {error: "dir_not_allowed"} exit-4 path in cmdDesign, not this fallback.
  const output = {
    schemaVersion: DESIGN_PACKAGE_SCHEMA_VERSION,
    taskType: args.taskType || DEFAULT_TASK_TYPE,
    mode: "read-only-fallback",
    reason,
    taskId,
    taskDir,
  };

  // get_screenshot
  try {
    const { result } = await invokeRaw("get_screenshot", args);
    const contents = result?.content || [];
    for (const c of contents) {
      if (c.type === "image") {
        const ext = (c.mimeType || "image/png").split("/")[1] || "png";
        const fname = join(taskDir, `_screenshot.${ext}`);
        writeFileSync(fname, Buffer.from(c.data, "base64"));
        output.screenshot = fname;
      }
    }
  } catch (e) {
    output.screenshot_error = String(e.message || e);
  }

  // get_metadata
  try {
    const { result } = await invokeRaw("get_metadata", args);
    const texts = (result?.content || []).filter((c) => c.type === "text").map((c) => c.text);
    if (texts.length) output.metadata = texts.join("\n");
  } catch (e) {
    output.metadata_error = String(e.message || e);
  }

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  process.stderr.write(
    `info: figma-data emitted read-only fallback (reason: ${reason}). ` +
      `downstream Design Package gates (figma-ui Phase B) will not satisfy — needs user action.\n`,
  );
}

async function cmdDesign(rest) {
  let parsed;
  try {
    parsed = parseToolArgs(rest);
  } catch (e) {
    die(e.message || String(e));
  }
  const args = parsed.args;

  applyUrlConvenience(args);

  if (args.taskType !== undefined && !VALID_TASK_TYPES.has(args.taskType)) {
    die(
      `invalid --taskType "${args.taskType}" (expected CREATE_ARTIFACT|CHANGE_ARTIFACT); ` +
        `a typo here would silently disable the downstream CHANGE gates`,
      EXIT_CODES.ENUM_INVALID,
    );
  }

  const assetsDir = args.assetsDir || getAssetsDir();
  delete args.assetsDir;
  const taskId = args.taskId || randomUUID().slice(0, 8);
  delete args.taskId;
  const taskDir = createTaskDir(assetsDir, taskId);

  if (!args.dirForAssetWrites) args.dirForAssetWrites = taskDir;

  const before = new Set(listDir(taskDir));

  let session;
  try {
    session = await openSession();
  } catch (e) {
    dieOnRpc(e.rpcError || e, `error: ${e.message || e}`);
  }
  const headers = sessionHeaders(session.sessionId);

  let body;
  try {
    body = await callTool(ENDPOINT, "get_design_context", args, { headers });
  } catch (e) {
    const norm = normalizeMcpError(e);
    if (norm?.kind === ERROR_KINDS.TOOL_NOT_FOUND) {
      return fallbackReadOnly({
        args,
        taskId,
        taskDir,
        reason: "get_design_context not available on server (tool_not_found)",
      });
    }
    dieOnRpc(e, `error: ${e.message || e}`);
  }
  if (body.error) {
    const norm = normalizeMcpError(body.error);
    if (norm?.kind === ERROR_KINDS.TOOL_NOT_FOUND) {
      return fallbackReadOnly({
        args,
        taskId,
        taskDir,
        reason: "get_design_context not available on server (tool_not_found)",
      });
    }
    die(`tool error: ${JSON.stringify(body.error)}`, EXIT_CODES.SERVER_ERROR);
  }

  const r = body.result;
  if (r?.isError) {
    const errorText = r.content?.[0]?.text || "";
    const isDirNotAllowed =
      errorText.includes("Cannot write to this directory") ||
      errorText.includes("allowed directories");
    if (isDirNotAllowed) {
      process.stdout.write(
        JSON.stringify(
          {
            schemaVersion: DESIGN_PACKAGE_SCHEMA_VERSION,
            taskType: args.taskType || DEFAULT_TASK_TYPE,
            error: "dir_not_allowed",
            message: errorText,
            fallback: "screenshot_and_metadata",
            taskId,
            taskDir,
          },
          null,
          2,
        ) + "\n",
      );
      process.exit(EXIT_CODES.SERVER_ERROR);
    }
    const norm = normalizeMcpError(r);
    if (norm?.kind === ERROR_KINDS.TOOL_NOT_FOUND) {
      return fallbackReadOnly({
        args,
        taskId,
        taskDir,
        reason: "get_design_context returned tool_not_found",
      });
    }
    if (norm) {
      process.stderr.write(
        JSON.stringify(
          { kind: norm.kind, hint: norm.hint, originalMessage: norm.originalMessage, raw: r },
          null,
          2,
        ) + "\n",
      );
      process.exit(norm.exitCode);
    }
    process.stderr.write(JSON.stringify(r, null, 2) + "\n");
    process.exit(EXIT_CODES.SERVER_ERROR);
  }

  // Wait for async asset writes
  await new Promise((res) => setTimeout(res, 3000));
  const after = new Set(listDir(taskDir));
  const newFiles = [...after].filter((f) => !before.has(f));

  const output = {
    schemaVersion: DESIGN_PACKAGE_SCHEMA_VERSION,
    // echo only; when user-supplied it stays in args and forwards to get_design_context
    taskType: args.taskType || DEFAULT_TASK_TYPE,
    taskId,
    taskDir,
    newlyDownloadedFiles: newFiles,
    totalFilesInDir: after.size,
  };

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

// ── screenshot command ───────────────────────────────────────────────────

async function cmdScreenshot(rest) {
  let parsed;
  try { parsed = parseToolArgs(rest); } catch (e) { die(e.message); }
  const args = parsed.args;
  applyUrlConvenience(args);

  const outDir = args.outDir || ".";
  delete args.outDir;

  const { result } = await invokeRaw("get_screenshot", args);
  const contents = result?.content || [];
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

// ── generic tool call (whitelist) ────────────────────────────────────────

async function cmdCall(tool, rest) {
  if (!TOOLS.includes(tool)) {
    die(
      `unknown tool: ${tool}\n` +
        `available: ${TOOLS.join(", ")}\n` +
        `if this is a new server tool, use: ${INVOCATION} raw ${tool} [...] (bypasses whitelist)`,
    );
  }

  let parsed;
  try { parsed = parseToolArgs(rest); } catch (e) { die(e.message); }
  const { args, yes } = parsed;
  applyUrlConvenience(args);

  const danger = dangerClass(tool, { registry: DANGEROUS_TOOLS });
  if (danger && !yes) {
    process.stderr.write(
      JSON.stringify(
        {
          blocked: true,
          tool,
          type: danger.type,
          note: danger.note,
          hint: "add --yes to confirm.",
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(EXIT_CODES.DESTRUCTIVE_BLOCKED);
  }

  const { result } = await invokeRaw(tool, args);
  emitContent(result);
}

// raw: bypass TOOLS whitelist for ad-hoc / new server tools.
async function cmdRaw(rest) {
  const [toolName, ...toolRest] = rest;
  if (!toolName) {
    die(`usage: ${INVOCATION} raw <toolName> [--json '{...}'] [--key value ...]`);
  }
  let parsed;
  try { parsed = parseToolArgs(toolRest); } catch (e) { die(e.message); }
  const { args, yes } = parsed;
  applyUrlConvenience(args);

  const danger = dangerClass(toolName, { registry: DANGEROUS_TOOLS });
  if (danger && !yes) {
    process.stderr.write(
      JSON.stringify(
        {
          blocked: true,
          tool: toolName,
          type: danger.type,
          note: danger.note,
          hint: "add --yes to confirm.",
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(EXIT_CODES.DESTRUCTIVE_BLOCKED);
  }

  const { result } = await invokeRaw(toolName, args);
  emitContent(result);
}

function emitContent(r) {
  const contents = r?.content || [];
  for (const c of contents) {
    if (c.type === "text") {
      process.stdout.write(c.text + "\n");
    } else if (c.type === "image") {
      const ext = (c.mimeType || "image/png").split("/")[1] || "png";
      const fname = `screenshot-${Date.now()}.${ext}`;
      writeFileSync(fname, Buffer.from(c.data, "base64"));
      process.stdout.write(`[image saved: ${resolve(fname)}]\n`);
    } else {
      process.stdout.write(JSON.stringify(c, null, 2) + "\n");
    }
  }
}

// ── cleanup ──────────────────────────────────────────────────────────────

function cmdCleanup(rest) {
  let parsed;
  try { parsed = parseToolArgs(rest); } catch (e) { die(e.message); }
  const args = parsed.args;
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
    const tmpRoot = join(assetsDir, ".figma-ui", "tmp");
    if (existsSync(tmpRoot)) {
      const dirs = readdirSync(tmpRoot);
      for (const d of dirs) rmSync(join(tmpRoot, d), { recursive: true });
      process.stdout.write(`removed ${dirs.length} task dir(s) from ${tmpRoot}\n`);
    } else {
      process.stdout.write("no tmp dirs to clean\n");
    }
  }
}

// ── list-tools / schema (with cache) ─────────────────────────────────────

async function cmdListTools(rest) {
  let refresh = false;
  for (const a of rest) {
    if (a === "--refresh") refresh = true;
    else die(`unexpected argument: ${a}`);
  }
  const { payload, cached } = await ensureToolsCacheForFigma({ refresh });
  process.stdout.write(
    JSON.stringify(
      {
        count: payload.toolCount,
        cached,
        fetchedAt: payload.fetchedAt,
        tools: payload.tools.map((t) => ({ name: t.name, description: (t.description || "").split("\n")[0] })),
      },
      null,
      2,
    ) + "\n",
  );
}

async function cmdSchema(rest) {
  let toolName = null;
  let refresh = false;
  for (const a of rest) {
    if (a === "--refresh") refresh = true;
    else if (!toolName) toolName = a;
    else die(`unexpected argument: ${a}`);
  }
  if (!toolName) die(`usage: ${INVOCATION} schema <tool> [--refresh]`);

  let { payload, cached } = await ensureToolsCacheForFigma({ refresh });
  let tool = payload.tools.find((t) => t.name === toolName);
  if (!tool && cached) {
    ({ payload } = await ensureToolsCacheForFigma({ refresh: true }));
    tool = payload.tools.find((t) => t.name === toolName);
  }
  if (!tool) die(`tool not found: ${toolName}\nrun: ${INVOCATION} list-tools --refresh`);

  const danger = dangerClass(toolName, { registry: DANGEROUS_TOOLS });
  process.stdout.write(
    JSON.stringify(
      {
        name: tool.name,
        description: tool.description || null,
        required: tool.inputSchema?.required || [],
        properties: tool.inputSchema?.properties || {},
        danger: danger ? { type: danger.type, note: danger.note } : null,
      },
      null,
      2,
    ) + "\n",
  );
}

// ── diff-tools ───────────────────────────────────────────────────────────

async function cmdDiffTools(rest) {
  let promoteInitial = false;
  let promote = false;
  for (const a of rest) {
    if (a === "--promote-initial") promoteInitial = true;
    else if (a === "--promote") promote = true;
    else die(`unexpected argument: ${a}`);
  }

  let session;
  try {
    session = await openSession();
  } catch (e) {
    dieOnRpc(e.rpcError || e, `error: ${e.message || e}`);
  }
  const headers = sessionHeaders(session.sessionId);

  let listRes;
  try {
    listRes = await listToolsRemote(ENDPOINT, { headers });
  } catch (e) {
    dieOnRpc(e, `tools/list: ${e.message || e}`);
  }
  if (listRes.error) dieOnRpc(listRes.error, `tools/list: ${JSON.stringify(listRes.error)}`);
  const currentTools = listRes.result?.tools || [];

  const extras = session.server?.serverInfo?.version
    ? { version: session.server.serverInfo.version }
    : undefined;
  const baselineExists = existsSync(BASELINE_PATH);

  if (promoteInitial) {
    if (baselineExists && !promote) {
      die(`baseline already exists at ${BASELINE_PATH} — use --promote to overwrite`, 1);
    }
    const baseline = buildBaseline(currentTools, { extras });
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          action: "promote-initial",
          path: BASELINE_PATH,
          toolCount: currentTools.length,
          extras: extras || null,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  if (!baselineExists) {
    die(`no baseline at ${BASELINE_PATH}\nrun: ${INVOCATION} diff-tools --promote-initial`, 1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const diff = diffTools(baseline, currentTools);
  const hasDrift = diffHasChanges(diff);

  process.stdout.write(
    JSON.stringify(
      {
        baseline_path: BASELINE_PATH,
        baseline_promoted_at: baseline.promotedAt,
        baseline_tool_count: baseline.toolCount,
        current_tool_count: currentTools.length,
        drift: diff,
        has_drift: hasDrift,
      },
      null,
      2,
    ) + "\n",
  );

  if (promote && hasDrift) {
    const newBaseline = buildBaseline(currentTools, { extras });
    writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2) + "\n");
    process.stderr.write(`promoted new baseline (${currentTools.length} tools)\n`);
  }

  process.exit(hasDrift && !promote ? 1 : 0);
}

// ── ping / doctor ────────────────────────────────────────────────────────

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
    cache_dir: CACHE_DIR,
    baseline_path: BASELINE_PATH,
    baseline_present: existsSync(BASELINE_PATH),
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
  design       Get design context + auto-manage asset downloads (returns Design Package)
  screenshot   Get visual screenshot of a node
  cleanup      Remove task tmp directories
  ping         Test MCP server connectivity
  doctor       Full diagnostic report
  list-tools   List server tools (cached; --refresh to force fetch)
  schema <t>   Show tool inputSchema (auto-refresh on cache miss)
  diff-tools   Compare server schema vs checkin baseline (--promote-initial / --promote)
  raw <tool>   Raw MCP tool call (bypasses whitelist; for new server tools)

  <tool>       Whitelisted tool call (${TOOLS.join(", ")})

usage examples:
  ${INVOCATION} design --url "https://figma.com/design/xxx/Name?node-id=42-15"
  ${INVOCATION} design --nodeId 42:15 --taskId my-task
  ${INVOCATION} design --nodeId 42:15 --taskType CHANGE_ARTIFACT   # modifying an existing page
  ${INVOCATION} screenshot --url "..."
  ${INVOCATION} get_metadata --nodeId 0:1
  ${INVOCATION} raw new_tool_name --json '{...}'      # for tools not in whitelist
  ${INVOCATION} diff-tools                            # check server schema drift
  ${INVOCATION} cleanup --taskId my-task

Design Package output: schemaVersion="${DESIGN_PACKAGE_SCHEMA_VERSION}".
  Downstream (figma-ui) asserts schemaVersion before consuming.
  taskType (default ${DEFAULT_TASK_TYPE}) is echoed in output; pass
  --taskType CHANGE_ARTIFACT when modifying an existing page — it is forwarded
  to get_design_context and gates the DesignInventory requirement downstream.
  On get_design_context tool_not_found → degrades to {mode:"read-only-fallback",
  screenshot, metadata}; figma-ui Phase B Gate will not satisfy (user action needed).

schema cache: ${CACHE_DIR} (TTL 24h)
baseline: ${BASELINE_PATH}

exit codes (shared with bk/alidocs per ADR-0001):
  0  success
  1  generic error (network / JSON / argv / drift detected without --promote)
  2  credential / auth issue
  3  dangerous tool called without --yes
  4  server returned isError or tool body.error
  5  tool_not_found
  6  enum_invalid

env:
  FIGMA_MCP_URL  Override endpoint (default: ${DEFAULT_ENDPOINT})
`,
  );
}

// ── main ─────────────────────────────────────────────────────────────────

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
        return await cmdListTools(rest);
      case "schema":
        return await cmdSchema(rest);
      case "diff-tools":
        return await cmdDiffTools(rest);
      case "raw":
        return await cmdRaw(rest);
      default:
        return await cmdCall(cmd, rest);
    }
  } catch (e) {
    die(`error: ${e.message || e}`);
  }
}

main();
