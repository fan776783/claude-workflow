#!/usr/bin/env node
// bk — thin CLI over the bk-mcp Streamable HTTP endpoint.

import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ENDPOINT = "http://192.168.82.121:3088/bk/mcp";
const ENDPOINT = process.env.BK_MCP_URL || DEFAULT_ENDPOINT;
const TOKEN_PATH = join(homedir(), ".config", "bk-mcp", "token");
const PROJECT_CONFIG_REL = ".claude/config/project-config.json";

// The CLI isn't globally registered — `bk` only exists if the user aliases it.
// Always print the actual invocation the user can copy-paste, defaulting to
// the absolute path of this script. If argv[1] is already a usable path, use
// argv[1] to match however the user invoked us.
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `node ${SCRIPT_PATH}`;

const TOOLS = [
  "add_issue_comment",
  "create_blueking_task",
  "create_issue",
  "get_issue",
  "get_todolist",
  "list_issues",
  "search_projects",
  "task_breakdown",
  "transition_issue",
  "update_issue",
  "upload_files",
];

// Tools that take a `project_id` argument — CLI can auto-inject the fallback
// project id only for these. Stays opt-in per-tool so it never surprises
// calls where the field doesn't exist.
const PROJECT_ID_TOOLS = new Set([
  "list_issues",
  "create_issue",
  "create_blueking_task",
  "task_breakdown",
]);

// ── credential / context resolution ───────────────────────────────────────

function readToken() {
  if (process.env.MCPR_TOKEN) return { value: process.env.MCPR_TOKEN.trim(), source: "env MCPR_TOKEN" };
  if (existsSync(TOKEN_PATH)) {
    const t = readFileSync(TOKEN_PATH, "utf8").trim();
    if (t) return { value: t, source: `file ${TOKEN_PATH}` };
  }
  return { value: null, source: null };
}

function readProjectId() {
  if (process.env.BK_PROJECT_ID) {
    return { value: process.env.BK_PROJECT_ID.trim(), source: "env BK_PROJECT_ID" };
  }
  const cfgPath = resolve(process.cwd(), PROJECT_CONFIG_REL);
  if (existsSync(cfgPath)) {
    try {
      const j = JSON.parse(readFileSync(cfgPath, "utf8"));
      const id = j?.project?.bkProjectId;
      if (typeof id === "string" && id.trim()) {
        return { value: id.trim(), source: `file ${cfgPath} (project.bkProjectId)` };
      }
    } catch (e) {
      process.stderr.write(`warning: failed to parse ${cfgPath}: ${e.message}\n`);
    }
  }
  return { value: null, source: null };
}

function warnIfProjectIdLooksWrong(id, source) {
  // vTeam project id is typically `v` + digits (e.g. v10125).
  // A value like `p328` is the Issue number prefix, not a project id —
  // passing it to bk-mcp yields a 400 "项目不存在或在CTeam中未初始化".
  if (!/^v\d+$/.test(id)) {
    process.stderr.write(
      `warning: project_id=${JSON.stringify(id)} (from ${source}) does not match /^v\\d+$/.\n` +
        `         若调用失败报 "项目不存在或在CTeam中未初始化"，检查 ${PROJECT_CONFIG_REL} 是否误填了 Issue 前缀（如 p328）。\n`,
    );
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function die(msg, code = 1) {
  process.stderr.write(msg.endsWith("\n") ? msg : msg + "\n");
  process.exit(code);
}

function needToken() {
  return (
    "missing bk-mcp token. steps:\n" +
    "  1. open https://mcp.300624.cn/api-keys to generate an API key\n" +
    "  2. save it by running:\n" +
    `       ${INVOCATION} auth <token> [--verify]\n` +
    "     (or set env MCPR_TOKEN=<token> for one-off / CI use)\n" +
    `  token file on success: ${TOKEN_PATH} (chmod 600)\n`
  );
}

// Parse a Streamable HTTP response: may be JSON or SSE (event: message\ndata: {...}).
async function parseMcpResponse(res) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (ct.includes("application/json")) {
    return { sessionId: res.headers.get("mcp-session-id"), body: JSON.parse(text) };
  }
  const events = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  let data = null;
  for (const ev of events) {
    const lines = ev.split(/\n/);
    const isMessage = lines.some((l) => l === "event: message");
    if (!isMessage && !lines.some((l) => l.startsWith("data:"))) continue;
    const payload = lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (payload) data = JSON.parse(payload);
  }
  if (!data) throw new Error(`empty MCP response (ct=${ct}): ${text.slice(0, 300)}`);
  return { sessionId: res.headers.get("mcp-session-id"), body: data };
}

async function rpc({ token, sessionId, body }) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  return parseMcpResponse(res);
}

async function sendNotification({ token, sessionId, body }) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok && res.status !== 202) {
    const t = await res.text().catch(() => "");
    throw new Error(`notification failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
}

async function openSession(token) {
  const init = await rpc({
    token,
    sessionId: null,
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bk-cli", version: "0.2.0" },
      },
    },
  });
  if (init.body.error) throw new Error(`initialize: ${JSON.stringify(init.body.error)}`);
  const sessionId = init.sessionId;
  await sendNotification({
    token,
    sessionId,
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  return { sessionId, server: init.body.result };
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

// ── commands ──────────────────────────────────────────────────────────────

async function cmdCall(tool, rest) {
  const { value: token } = readToken();
  if (!token) die(needToken());
  if (!TOOLS.includes(tool)) {
    die(`unknown tool: ${tool}\navailable: ${TOOLS.join(", ")}`);
  }
  const args = parseToolArgs(rest);

  // Auto-inject project_id fallback only for tools that accept it, and only
  // when the caller didn't supply project_id / project_name themselves.
  // list_issues additionally allows project_name as an alternative, so skip
  // injection if either is already present.
  if (PROJECT_ID_TOOLS.has(tool) && args.project_id == null && args.project_name == null) {
    const { value: pid, source } = readProjectId();
    if (pid) {
      args.project_id = pid;
      process.stderr.write(`info: project_id=${pid} (from ${source})\n`);
      warnIfProjectIdLooksWrong(pid, source);
    }
  } else if (PROJECT_ID_TOOLS.has(tool) && typeof args.project_id === "string") {
    warnIfProjectIdLooksWrong(args.project_id, "--project_id");
  }

  const { sessionId } = await openSession(token);
  const res = await rpc({
    token,
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
  if (r?.structuredContent !== undefined) {
    process.stdout.write(JSON.stringify(r.structuredContent, null, 2) + "\n");
    return;
  }
  const texts = (r?.content || []).filter((c) => c.type === "text").map((c) => c.text);
  if (texts.length) {
    process.stdout.write(texts.join("\n") + "\n");
  } else {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  }
}

async function cmdListTools() {
  const { value: token } = readToken();
  if (!token) die(needToken());
  const { sessionId } = await openSession(token);
  const res = await rpc({
    token,
    sessionId,
    body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  if (res.body.error) die(`tools/list: ${JSON.stringify(res.body.error)}`);
  const tools = res.body.result?.tools || [];
  const filtered = tools.filter((t) => TOOLS.includes(t.name));
  process.stdout.write(JSON.stringify(filtered, null, 2) + "\n");
}

async function cmdAuth(rest) {
  let token = null;
  let verify = false;
  for (const a of rest) {
    if (a === "--verify") verify = true;
    else if (a === "--no-verify") verify = false;
    else if (!token) token = a;
    else die(`unexpected argument: ${a}`);
  }
  if (!token) {
    die(
      `usage: ${INVOCATION} auth <token> [--verify]\n` +
        "get one at https://mcp.300624.cn/api-keys",
    );
  }
  token = token.trim();

  if (verify) {
    try {
      const { server } = await openSession(token);
      process.stderr.write(
        `verify ok: connected to ${server?.serverInfo?.name ?? "bk-mcp"} ${server?.serverInfo?.version ?? ""}\n`,
      );
    } catch (e) {
      die(
        `verify failed: ${e.message || e}\n` +
          "token not saved. check the value and retry, or drop --verify to save anyway.",
        2,
      );
    }
  }

  const dir = join(homedir(), ".config", "bk-mcp");
  mkdirSync(dir, { recursive: true });
  writeFileSync(TOKEN_PATH, token + "\n");
  chmodSync(TOKEN_PATH, 0o600);
  const preview = token.length > 12 ? token.slice(0, 8) + "…" + token.slice(-4) : "***";
  process.stdout.write(
    JSON.stringify({ ok: true, path: TOKEN_PATH, preview, verified: verify }, null, 2) + "\n",
  );
}

// Persist bkProjectId into the repo's project-config.json, preserving any
// other fields. Creates the file (and .claude/config/ dir) if missing.
function cmdProject(rest) {
  const sub = rest[0];
  if (sub === "get") {
    const { value, source } = readProjectId();
    process.stdout.write(JSON.stringify({ value: value ?? null, source: source ?? null }, null, 2) + "\n");
    return;
  }
  if (sub === "set") {
    const id = rest[1];
    if (!id) {
      die(
        `usage: ${INVOCATION} project set <bkProjectId>\n` +
          `  writes project.bkProjectId into \${cwd}/${PROJECT_CONFIG_REL}\n` +
          "  expected format: /^v\\d+$/ (e.g. v10125). p328-style values are Issue prefixes, not project ids.\n",
      );
    }
    if (!/^v\d+$/.test(id)) {
      process.stderr.write(
        `warning: ${JSON.stringify(id)} does not match /^v\\d+$/. ` +
          "若这不是 vTeam 项目 ID（形如 v10125），bk-mcp 会拒绝。仍然写入。\n",
      );
    }
    const cfgPath = resolve(process.cwd(), PROJECT_CONFIG_REL);
    let cfg = {};
    if (existsSync(cfgPath)) {
      try {
        cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
        if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) cfg = {};
      } catch (e) {
        die(`failed to parse existing ${cfgPath}: ${e.message}\nrefusing to overwrite — fix the file by hand or delete it first.`);
      }
    } else {
      mkdirSync(resolve(process.cwd(), ".claude/config"), { recursive: true });
    }
    if (cfg.project == null || typeof cfg.project !== "object" || Array.isArray(cfg.project)) {
      cfg.project = {};
    }
    const prev = cfg.project.bkProjectId;
    cfg.project.bkProjectId = id.trim();
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          path: cfgPath,
          previous: prev ?? null,
          current: cfg.project.bkProjectId,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  die(`usage: ${INVOCATION} project <get|set> [args]`);
}

async function cmdPing() {
  const { value: token } = readToken();
  if (!token) die(needToken());
  const { server } = await openSession(token);
  process.stdout.write(JSON.stringify({ ok: true, server }, null, 2) + "\n");
}

async function cmdDoctor() {
  const tok = readToken();
  const pid = readProjectId();
  const report = {
    endpoint: {
      value: ENDPOINT,
      source: process.env.BK_MCP_URL ? "env BK_MCP_URL" : `default (${DEFAULT_ENDPOINT})`,
    },
    token: {
      present: Boolean(tok.value),
      source: tok.source || "none",
      preview: tok.value ? tok.value.slice(0, 8) + "…" + tok.value.slice(-4) : null,
    },
    project_id: {
      value: pid.value,
      source: pid.source || "none",
      format_ok: pid.value ? /^v\d+$/.test(pid.value) : null,
    },
    cwd: process.cwd(),
    project_config_path: resolve(process.cwd(), PROJECT_CONFIG_REL),
    connectivity: null,
  };

  if (tok.value) {
    try {
      const { server } = await openSession(tok.value);
      report.connectivity = { ok: true, server: server?.serverInfo };
    } catch (e) {
      report.connectivity = { ok: false, error: String(e.message || e) };
    }
  } else {
    report.connectivity = { ok: false, error: "skipped: no token" };
  }

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

function cmdHelp() {
  const tokenSrc = readToken().source || "(none — run `bk auth <token>`)";
  const pidInfo = readProjectId();
  process.stdout.write(
    `bk — CLI for bk-mcp (${ENDPOINT})

this script is not installed globally; invoke it as:
  ${INVOCATION} <subcommand> [...]

usage:
  ${INVOCATION} <tool> [--json '{...}'] [--key value | --key=value ...]
  ${INVOCATION} list-tools
  ${INVOCATION} auth <token> [--verify]
  ${INVOCATION} project get
  ${INVOCATION} project set <bkProjectId>
  ${INVOCATION} ping
  ${INVOCATION} doctor
  ${INVOCATION} help

tools (${TOOLS.length}):
  ${TOOLS.join("\n  ")}

credential resolution (first match wins):
  token:
    1. env MCPR_TOKEN
    2. ${TOKEN_PATH}
    current: ${tokenSrc}
  endpoint (env BK_MCP_URL overrides): ${ENDPOINT}

context resolution (for tools that take project_id: ${[...PROJECT_ID_TOOLS].join(", ")}):
  1. --project_id on the command line (or --project_name for list_issues)
  2. env BK_PROJECT_ID
  3. \${cwd}/${PROJECT_CONFIG_REL} → project.bkProjectId
  current: ${pidInfo.value ? pidInfo.value + " (from " + pidInfo.source + ")" : "(none)"}

obtain a token: https://mcp.300624.cn/api-keys
`,
  );
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "-h":
      case "--help":
        return cmdHelp();
      case "auth":
        return await cmdAuth(rest);
      case "project":
        return cmdProject(rest);
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
