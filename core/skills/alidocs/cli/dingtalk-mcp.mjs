#!/usr/bin/env node
// dingtalk-mcp — thin CLI over the DingTalk Doc/Sheet MCP Streamable HTTP endpoints.
//
// Two MCP servers are addressed explicitly via subcommand kind (doc|sheet).
// Credentials are the full URL (including ?key=...) stored in
// ~/.config/dingtalk-mcp/servers.json (chmod 600).
//
// No session handshake: the DingTalk MCP gateway accepts tools/call directly.
// See plan .claude/plans/dingtalk-skill.plan.md for design rationale.

import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── constants ─────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".config", "dingtalk-mcp");
const CONFIG_PATH = join(CONFIG_DIR, "servers.json");
const CACHE_DIR = join(homedir(), ".cache", "dingtalk-mcp");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const DEFAULT_HOST_ALLOWLIST = ["mcp-gw.dingtalk.com"];

// Three MCP servers:
//   doc     — 钉钉文档 (DingTalk Docs, rich-text)
//   aitable — 钉钉 AI 表格 (Airtable-like: Base/Table/Record/Field/View/Chart)
//   sheet   — 钉钉表格 (Excel-like: Workbook/Sheet/Range/Filter/Dimension)
const KINDS = ["doc", "aitable", "sheet"];

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `node ${SCRIPT_PATH}`;

// Tools that are unconditionally dangerous (CLI hard gate; requires --yes).
// Categorized for clearer error messages.
const DANGEROUS_TOOLS = {
  // ── doc ────────────────────────────────────────────────────────────────
  "doc:delete_document_block": { type: "destroy", note: "deletes a document block (unrecoverable)" },
  "doc:delete_document": { type: "destroy", note: "deletes a document/folder node (unrecoverable)" },
  "doc:update_document": { type: "overwrite", note: "full document content overwrite (NOT an append)" },

  // ── aitable (AI 表格, Airtable-like) ──────────────────────────────────
  "aitable:delete_base": { type: "destroy", note: "deletes the entire AI table Base and all datasheets" },
  "aitable:delete_table": { type: "destroy", note: "deletes a datasheet and all its records/fields/views" },
  "aitable:delete_field": { type: "destroy", note: "deletes a field column (all values lost)" },
  "aitable:delete_view": { type: "destroy", note: "deletes a view" },
  "aitable:delete_records": { type: "destroy", note: "deletes records (batch)" },
  "aitable:delete_chart": { type: "destroy", note: "deletes a chart" },
  "aitable:delete_dashboard": { type: "destroy", note: "deletes a dashboard" },
  "aitable:update_field": { type: "schema-change", note: "changing field type can drop or corrupt existing values" },
  "aitable:update_dashboard_share": { type: "visibility", note: "enables/updates public dashboard share link" },
  "aitable:update_chart_share": { type: "visibility", note: "enables/updates public chart share link" },

  // ── sheet (钉钉表格, Excel-like) ──────────────────────────────────────
  // destroy: prefix fallback already catches delete_dimension / delete_filter /
  // delete_filter_view / clear_filter_* — listed here only for richer messages
  // when hit.
  "sheet:delete_dimension": { type: "destroy", note: "deletes rows/columns (data in that range is lost)" },
  "sheet:delete_filter": { type: "destroy", note: "removes the sheet filter" },
  "sheet:delete_filter_view": { type: "destroy", note: "removes a filter view" },
  // overwrite: range-level rewrites can wipe cells if invoked wrong
  "sheet:update_range": { type: "overwrite", note: "overwrites cell values/formatting in a range (NOT an append)" },
  "sheet:replace_all": { type: "overwrite", note: "global find-and-replace across the sheet; impact may be large" },
  "sheet:move_dimension": { type: "overwrite", note: "moves rows/columns; may break formulas/references at old positions" },
  // structure-change: alters layout, affects references
  "sheet:unmerge_range": { type: "structure-change", note: "splits merged cells; may shift downstream formulas" },
  "sheet:update_dimension": { type: "schema-change", note: "changes row/column visibility or size across a block" },
  "sheet:write_image": { type: "overwrite", note: "writes an image into a cell; overwrites anything already there" },
};

// Pattern fallback: any future tool whose name starts with these prefixes
// is treated as dangerous, even if not in the explicit list above.
const DANGEROUS_PREFIXES = ["delete_", "remove_", "clear_", "drop_", "truncate_"];

// ── redaction ─────────────────────────────────────────────────────────────

// Params that carry credentials (primary or secondary) — must be redacted in
// diagnostic/error output: errors, stderr logs, doctor, smoke failures.
// (Successful tool payloads stream raw stdout; callers that pipe tool output
// into user-facing channels should redact downstream.)
const SENSITIVE_PARAMS = ["key", "signature", "Signature", "Expires", "accessKeyId", "AccessKeyId", "policy", "Policy"];
// JSON-style field names that MCP payloads use for upload/download credentials.
const SENSITIVE_JSON_FIELDS = ["uploadToken", "downloadToken", "token", "uploadUrl", "downloadUrl"];

// Redact URL-like and JSON-like strings. Handles both `param=value` (query
// string / form-urlencoded) and `"field":"value"` (JSON error echoes).
function redact(input) {
  if (input == null) return input;
  let s = String(input);
  for (const p of SENSITIVE_PARAMS) {
    const re = new RegExp(`(${p})=([^&\\s"']+)`, "g");
    s = s.replace(re, (_, k, v) => `${k}=${fingerprint(v)}`);
  }
  for (const f of SENSITIVE_JSON_FIELDS) {
    const re = new RegExp(`("${f}"\\s*:\\s*")([^"]+)(")`, "g");
    s = s.replace(re, (_, a, v, b) => `${a}${fingerprint(v)}${b}`);
  }
  return s;
}

function fingerprint(v) {
  if (!v) return "***";
  if (v.length < 12) return "***";
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}

// ── misc helpers ──────────────────────────────────────────────────────────

function die(msg, code = 1) {
  const out = redact(typeof msg === "string" ? msg : String(msg));
  process.stderr.write(out.endsWith("\n") ? out : out + "\n");
  process.exit(code);
}

function warn(msg) {
  process.stderr.write(redact(msg).replace(/\n?$/, "\n"));
}

function ensureDir(path, mode) {
  mkdirSync(path, { recursive: true, mode });
}

function atomicWriteJson(path, obj, mode = 0o600) {
  // Config dir hardened to 0700 since servers.json contains full MCP URLs
  // (key included). Cache dir callers override via their own mkdirSync.
  ensureDir(dirname(path), 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    // Create with final mode atomically; avoids a window where umask leaves
    // the file 0644 with full URL inside before chmod narrows it.
    writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode });
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw e;
  }
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    warn(`warning: failed to parse ${path}: ${e.message}`);
    return null;
  }
}

function needAuth(kind) {
  return (
    `missing ${kind} server URL. steps:\n` +
    `  1. obtain the DingTalk ${kind} MCP URL (format: https://mcp-gw.dingtalk.com/server/<hash>?key=<key>)\n` +
    `  2. save it via stdin (URL stays out of dingtalk-mcp's argv; note the shell\n` +
    `     command string itself still appears in agent tool logs / shell history —\n` +
    `     prefer feeding the URL via your agent's stdin parameter rather than\n` +
    `     interpolating into a bash string):\n` +
    `       ${INVOCATION} auth ${kind} --stdin --verify <<< "<url>"\n` +
    `     (or for humans, hide from history with:\n` +
    `       read -rsp 'URL: ' U && printf '%s\\n' "$U" | ${INVOCATION} auth ${kind} --stdin --verify; unset U)\n` +
    `  config file on success: ${CONFIG_PATH} (chmod 600)\n`
  );
}

// ── credential resolution ────────────────────────────────────────────────

function readServerUrl(kind, { allowInvalid = false } = {}) {
  const envKey = `DINGTALK_${kind.toUpperCase()}_URL`;
  let value = null;
  let source = null;
  if (process.env[envKey]) {
    value = process.env[envKey].trim();
    source = `env ${envKey}`;
  } else {
    const cfg = readJsonIfExists(CONFIG_PATH);
    if (cfg && typeof cfg[kind] === "string" && cfg[kind].trim()) {
      value = cfg[kind].trim();
      source = `file ${CONFIG_PATH}`;
    }
  }
  if (!value) return { value: null, source: null };
  // Re-validate at read time: env var or file could have been tampered with
  // or predate a host allowlist change. Saves the user from sending requests
  // (and Bearer-equivalent key) to a wrong host.
  if (!allowInvalid) {
    const err = validateUrl(value);
    if (err) die(`refusing to use ${kind} URL from ${source}: ${err}`, 2);
  }
  return { value, source };
}

function hostAllowlist() {
  const extra = (process.env.DINGTALK_HOST_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_HOST_ALLOWLIST, ...extra];
}

function validateUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return `not a valid URL: ${e.message}`;
  }
  if (u.protocol !== "https:") return `protocol must be https: (got ${u.protocol})`;
  const allow = hostAllowlist();
  if (!allow.includes(u.hostname)) {
    return `host ${u.hostname} not in allowlist [${allow.join(", ")}]. set DINGTALK_HOST_ALLOWLIST=<host> to extend.`;
  }
  if (!u.searchParams.get("key")) return `URL missing ?key=... query param`;
  return null;
}

function saveServerUrl(kind, url) {
  const err = validateUrl(url);
  if (err) die(`refusing to save ${kind} URL: ${err}`, 2);
  const existing = readJsonIfExists(CONFIG_PATH) || {};
  existing[kind] = url;
  atomicWriteJson(CONFIG_PATH, existing, 0o600);
}

// ── MCP RPC (no session) ─────────────────────────────────────────────────

async function parseMcpResponse(res) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  if (ct.includes("application/json")) return JSON.parse(text);
  // SSE fallback (MCP spec allows event: message\ndata: {...})
  const events = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  let data = null;
  for (const ev of events) {
    const lines = ev.split(/\n/);
    const payload = lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (payload) data = JSON.parse(payload);
  }
  if (!data) throw new Error(`empty MCP response (ct=${ct}): ${text.slice(0, 300)}`);
  return data;
}

async function rpc(url, body) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return parseMcpResponse(res);
}

let rpcIdSeq = 1;
function nextId() {
  return rpcIdSeq++;
}

async function callTool(url, name, args) {
  const body = {
    jsonrpc: "2.0",
    id: nextId(),
    method: "tools/call",
    params: { name, arguments: args || {} },
  };
  return rpc(url, body);
}

async function listToolsRemote(url) {
  const body = { jsonrpc: "2.0", id: nextId(), method: "tools/list", params: {} };
  return rpc(url, body);
}

// ── arg parsing ──────────────────────────────────────────────────────────

function parseToolArgs(argv) {
  const out = {};
  let yes = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") {
      yes = true;
      continue;
    }
    if (a === "--json" || a === "-j") {
      const raw = argv[++i];
      if (!raw) die("--json requires a value");
      Object.assign(out, JSON.parse(raw));
      continue;
    }
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
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
  return { args: out, yes, rest };
}

function coerce(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
    try {
      return JSON.parse(v);
    } catch {
      /* fall through */
    }
  }
  return v;
}

// ── danger check ─────────────────────────────────────────────────────────

function dangerClass(kind, toolName) {
  const explicit = DANGEROUS_TOOLS[`${kind}:${toolName}`];
  if (explicit) return explicit;
  for (const p of DANGEROUS_PREFIXES) {
    if (toolName.startsWith(p)) return { type: "pattern-match", note: `tool name starts with "${p}" (matched by fallback pattern)` };
  }
  return null;
}

// ── schema cache ─────────────────────────────────────────────────────────

function serverFingerprint(url) {
  try {
    const u = new URL(url);
    const hash = (u.pathname.split("/").pop() || "").slice(-8);
    return `${u.hostname}+${hash}`;
  } catch {
    return "invalid-url";
  }
}

function cachePath(kind) {
  return join(CACHE_DIR, `tools-${kind}.json`);
}

function readCache(kind, expectedFingerprint) {
  const p = cachePath(kind);
  const cached = readJsonIfExists(p);
  if (!cached) return null;
  if (cached.serverFingerprint !== expectedFingerprint) return null;
  const age = Date.now() - new Date(cached.fetchedAt).getTime();
  if (!(age >= 0) || age > CACHE_TTL_MS) return null;
  if (!Array.isArray(cached.tools)) return null;
  return cached;
}

function writeCache(kind, url, tools) {
  const payload = {
    fetchedAt: new Date().toISOString(),
    serverFingerprint: serverFingerprint(url),
    toolCount: tools.length,
    tools,
  };
  atomicWriteJson(cachePath(kind), payload, 0o600);
  return payload;
}

async function ensureToolsCache(kind, { refresh = false } = {}) {
  const { value: url, source } = readServerUrl(kind);
  if (!url) die(needAuth(kind), 2);
  const fp = serverFingerprint(url);
  if (!refresh) {
    const hit = readCache(kind, fp);
    if (hit) return { payload: hit, source, url, cached: true };
  }
  const res = await listToolsRemote(url);
  if (res.error) die(`tools/list (${kind}): ${JSON.stringify(res.error)}`, 4);
  const tools = res.result?.tools || [];
  const payload = writeCache(kind, url, tools);
  return { payload, source, url, cached: false };
}

// ── commands ─────────────────────────────────────────────────────────────

async function cmdAuth(rest) {
  const kind = rest.shift();
  if (!KINDS.includes(kind)) {
    die(
      `usage: ${INVOCATION} auth <doc|sheet> [<url> | --stdin] [--verify]\n` +
        `  --stdin (recommended)  read URL from stdin; keeps it out of argv/shell history\n` +
        `  --verify               run a tools/list against the URL before persisting\n`,
      1,
    );
  }

  let url = null;
  let useStdin = false;
  let verify = false;
  for (const a of rest) {
    if (a === "--stdin") useStdin = true;
    else if (a === "--verify") verify = true;
    else if (a === "--no-verify") verify = false;
    else if (!url) url = a;
    else die(`unexpected argument: ${a}`);
  }

  if (useStdin) {
    if (url) die("--stdin and an inline URL are mutually exclusive");
    url = await readStdin();
    if (!url) die("stdin was empty", 1);
  } else {
    if (!url) die(`no URL provided. pass one inline or use --stdin.\n${needAuth(kind)}`, 1);
    warn(
      `warning: URL passed on argv is recorded by your shell history AND visible in process listings. next time, prefer:\n` +
        `  ${INVOCATION} auth ${kind} --stdin --verify <<< "<url>"\n` +
        `  (or for humans: read -rsp 'URL: ' U && printf '%s\\n' "$U" | ${INVOCATION} auth ${kind} --stdin --verify; unset U)`,
    );
  }

  url = url.trim();
  const invalid = validateUrl(url);
  if (invalid) die(`refusing to save ${kind} URL: ${invalid}`, 2);

  if (verify) {
    try {
      const res = await listToolsRemote(url);
      if (res.error) throw new Error(JSON.stringify(res.error));
      const n = res.result?.tools?.length ?? 0;
      warn(`verify ok: ${kind} server returned ${n} tools`);
    } catch (e) {
      die(`verify failed: ${e.message || e}\nURL not saved. check the value and retry, or drop --verify to save anyway.`, 2);
    }
  }

  saveServerUrl(kind, url);
  const u = new URL(url);
  const keyPreview = fingerprint(u.searchParams.get("key") || "");
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        kind,
        path: CONFIG_PATH,
        host: u.hostname,
        key_preview: keyPreview,
        verified: verify,
      },
      null,
      2,
    ) + "\n",
  );
}

function readStdin() {
  return new Promise((resolveP, rejectP) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolveP(buf.trim()));
    process.stdin.on("error", rejectP);
  });
}

async function cmdCall(kind, toolName, restArgv) {
  if (!KINDS.includes(kind)) die(`unknown server kind: ${kind}. expected one of: ${KINDS.join(", ")}`);
  if (!toolName) die(`${kind} requires a tool name. run: ${INVOCATION} list-tools ${kind}`);

  const { args, yes } = parseToolArgs(restArgv);
  const danger = dangerClass(kind, toolName);
  if (danger && !yes) {
    process.stderr.write(
      JSON.stringify(
        {
          blocked: true,
          kind,
          tool: toolName,
          type: danger.type,
          note: danger.note,
          hint: `add --yes to confirm. skill protocol: show the target ID + impact to the user and get explicit consent first.`,
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(3);
  }

  const { value: url } = readServerUrl(kind);
  if (!url) die(needAuth(kind), 2);

  const res = await callTool(url, toolName, args);
  if (res.error) die(`tool error: ${JSON.stringify(res.error)}`, 4);

  const r = res.result;
  if (r?.isError) {
    process.stderr.write(redact(JSON.stringify(r, null, 2)) + "\n");
    process.exit(4);
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

async function cmdListTools(rest) {
  let target = "all";
  let refresh = false;
  for (const a of rest) {
    if (a === "--refresh") refresh = true;
    else if (KINDS.includes(a) || a === "all") target = a;
    else die(`unexpected argument: ${a}`);
  }
  const kinds = target === "all" ? KINDS : [target];
  const out = {};
  for (const k of kinds) {
    const { payload, cached } = await ensureToolsCache(k, { refresh });
    out[k] = {
      count: payload.toolCount,
      cached,
      fetchedAt: payload.fetchedAt,
      tools: payload.tools.map((t) => ({ name: t.name, title: t.title || null })),
    };
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

async function cmdSchema(rest) {
  let path = null;
  let refresh = false;
  for (const a of rest) {
    if (a === "--refresh") refresh = true;
    else if (!path) path = a;
    else die(`unexpected argument: ${a}`);
  }
  if (!path || !path.includes(".")) {
    die(`usage: ${INVOCATION} schema <doc|sheet>.<tool> [--refresh]\n  e.g. ${INVOCATION} schema doc.create_document`);
  }
  const [kind, ...toolParts] = path.split(".");
  const toolName = toolParts.join(".");
  if (!KINDS.includes(kind)) die(`unknown kind in "${path}": ${kind}`);

  let { payload, cached } = await ensureToolsCache(kind, { refresh });
  let tool = payload.tools.find((t) => t.name === toolName);
  // Auto-refresh on tool miss (cache may predate a server-side addition).
  if (!tool && cached) {
    ({ payload } = await ensureToolsCache(kind, { refresh: true }));
    tool = payload.tools.find((t) => t.name === toolName);
  }
  if (!tool) die(`tool not found: ${kind}.${toolName}`, 1);

  const danger = dangerClass(kind, toolName);
  process.stdout.write(
    JSON.stringify(
      {
        name: tool.name,
        title: tool.title || null,
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

async function cmdPing() {
  const results = {};
  for (const k of KINDS) {
    const { value: url } = readServerUrl(k);
    if (!url) {
      results[k] = { ok: false, error: "no URL configured" };
      continue;
    }
    try {
      const res = await listToolsRemote(url);
      if (res.error) throw new Error(JSON.stringify(res.error));
      results[k] = { ok: true, tool_count: res.result?.tools?.length ?? 0 };
    } catch (e) {
      results[k] = { ok: false, error: redact(String(e.message || e)) };
    }
  }
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

async function cmdDoctor(rest) {
  const unsafe = rest.includes("--unsafe-full");
  const report = { config_path: CONFIG_PATH, cache_dir: CACHE_DIR, servers: {} };
  const cfgStat = existsSync(CONFIG_PATH) ? statSync(CONFIG_PATH) : null;
  report.config_mode = cfgStat ? (cfgStat.mode & 0o777).toString(8) : null;

  for (const k of KINDS) {
    // doctor is diagnostic: show invalid/tampered URLs so the user can fix
    // them instead of dying silently.
    const { value: url, source } = readServerUrl(k, { allowInvalid: true });
    const entry = { present: Boolean(url), source: source || "none" };
    if (url) {
      const invalid = validateUrl(url);
      if (invalid) entry.validation_error = invalid;
      try {
        const u = new URL(url);
        entry.host = u.hostname;
        entry.path_hash_tail = (u.pathname.split("/").pop() || "").slice(-8);
        entry.key_preview = fingerprint(u.searchParams.get("key") || "");
        if (unsafe) entry.url_unsafe_full = url;
      } catch {
        entry.parse_error = "invalid URL stored in config";
      }
      if (!invalid) {
        try {
          const res = await listToolsRemote(url);
          if (res.error) throw new Error(JSON.stringify(res.error));
          entry.connectivity = { ok: true, tool_count: res.result?.tools?.length ?? 0 };
        } catch (e) {
          entry.connectivity = { ok: false, error: redact(String(e.message || e)) };
        }
      } else {
        entry.connectivity = { ok: false, error: `skipped: ${invalid}` };
      }
    }
    report.servers[k] = entry;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  // doctor always exits 0 so it's usable in smoke-test/CI pipelines regardless
  // of auth / connectivity state — callers inspect the JSON for verdicts.
}

function cmdHelp() {
  const docInfo = readServerUrl("doc", { allowInvalid: true });
  const aitableInfo = readServerUrl("aitable", { allowInvalid: true });
  const sheetInfo = readServerUrl("sheet", { allowInvalid: true });
  const fmt = (i) => (i.value ? `set (${i.source})` : "(none — run auth)");
  process.stdout.write(
    `dingtalk-mcp — CLI over DingTalk Doc + AI-Table MCP servers

this script is not installed globally; invoke it as:
  ${INVOCATION} <subcommand> [...]

usage:
  ${INVOCATION} auth <doc|aitable|sheet> [--stdin | <url>] [--verify]
  ${INVOCATION} doc      <tool> [--json '{...}'] [--key value ...] [--yes]
  ${INVOCATION} aitable  <tool> [--json '{...}'] [--key value ...] [--yes]
  ${INVOCATION} sheet    <tool> [--json '{...}'] [--key value ...] [--yes]
  ${INVOCATION} list-tools [doc|aitable|sheet|all] [--refresh]
  ${INVOCATION} schema <doc|aitable|sheet>.<tool> [--refresh]
  ${INVOCATION} ping
  ${INVOCATION} doctor [--unsafe-full]     # --unsafe-full prints the raw URL (incl. key) — do NOT use in chat/logs
  ${INVOCATION} help

server URLs (first match wins):
  doc (钉钉文档):
          1. env DINGTALK_DOC_URL     2. ${CONFIG_PATH} (key: doc)
          current: ${fmt(docInfo)}
  aitable (钉钉 AI 表格, Airtable-like):
          1. env DINGTALK_AITABLE_URL 2. ${CONFIG_PATH} (key: aitable)
          current: ${fmt(aitableInfo)}
  sheet (钉钉表格, Excel-like):
          1. env DINGTALK_SHEET_URL   2. ${CONFIG_PATH} (key: sheet)
          current: ${fmt(sheetInfo)}

host allowlist: ${hostAllowlist().join(", ")}
  (extend via env DINGTALK_HOST_ALLOWLIST=a.example.com,b.example.com)

schema cache: ${CACHE_DIR} (TTL 24h; auto-refresh on server fingerprint change or tool miss)

exit codes:
  0  success (doctor always exits 0)
  1  generic error (network / JSON / local argv)
  2  credential missing or --verify failed / 401 / 403
  3  dangerous tool called without --yes
  4  MCP body.error or tool result.isError=true
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
      case "list-tools":
        return await cmdListTools(rest);
      case "schema":
        return await cmdSchema(rest);
      case "ping":
        return await cmdPing();
      case "doctor":
        return await cmdDoctor(rest);
      case "doc":
      case "aitable":
      case "sheet": {
        const [tool, ...toolRest] = rest;
        return await cmdCall(cmd, tool, toolRest);
      }
      default:
        die(`unknown command: ${cmd}\nrun '${INVOCATION} help' for usage.`);
    }
  } catch (e) {
    die(`error: ${e.message || e}`);
  }
}

main();
