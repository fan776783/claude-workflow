// mcp-baseline — 跨 skill 共享的 MCP 客户端基础设施。
//
// 抽自 core/skills/alidocs/cli/dingtalk-mcp.mjs 的 schema cache + fingerprint +
// danger detection + arg parsing 实现。供 bk / alidocs / figma-data CLI 共用。
//
// 设计原则：
//   - 纯函数 + 工厂类，不直接 process.exit / process.stderr.write
//   - 调用方决定如何处理错误（die / 透传 / 包装），便于不同 CLI 接入
//   - fetch 通过 opts.fetchImpl 注入，方便测试 mock
//
// 见 ADR-0001 决策依据。

import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

// ── 常量 ─────────────────────────────────────────────────────────────────

export const DEFAULT_DANGEROUS_PREFIXES = [
  "delete_",
  "remove_",
  "clear_",
  "drop_",
  "truncate_",
];

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// 跨 CLI 统一的 exit code。各 CLI 自身可保留其他约定（如 alidocs 的 3=
// destructive blocked、4=server error），但下面这三个为共享契约。
export const EXIT_CODES = Object.freeze({
  GENERIC: 1,
  AUTH: 2,
  DESTRUCTIVE_BLOCKED: 3,
  SERVER_ERROR: 4,
  TOOL_NOT_FOUND: 5,
  ENUM_INVALID: 6,
});

export const ERROR_KINDS = Object.freeze({
  TOOL_NOT_FOUND: "tool_not_found",
  ENUM_INVALID: "enum_invalid",
  AUTH: "auth",
});

// ── 脱敏 ─────────────────────────────────────────────────────────────────

export function fingerprint(v) {
  if (!v) return "***";
  const s = String(v);
  if (s.length < 12) return "***";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

const DEFAULT_SENSITIVE_PARAMS = [
  "key",
  "signature",
  "Signature",
  "Expires",
  "accessKeyId",
  "AccessKeyId",
  "policy",
  "Policy",
];

const DEFAULT_SENSITIVE_JSON_FIELDS = [
  "uploadToken",
  "downloadToken",
  "token",
  "uploadUrl",
  "downloadUrl",
];

export function redact(input, opts = {}) {
  if (input == null) return input;
  const params = opts.params || DEFAULT_SENSITIVE_PARAMS;
  const jsonFields = opts.jsonFields || DEFAULT_SENSITIVE_JSON_FIELDS;
  let s = String(input);
  for (const p of params) {
    const re = new RegExp(`(${p})=([^&\\s"']+)`, "g");
    s = s.replace(re, (_, k, v) => `${k}=${fingerprint(v)}`);
  }
  for (const f of jsonFields) {
    const re = new RegExp(`("${f}"\\s*:\\s*")([^"]+)(")`, "g");
    s = s.replace(re, (_, a, v, b) => `${a}${fingerprint(v)}${b}`);
  }
  return s;
}

// ── FS helpers ───────────────────────────────────────────────────────────

export function ensureDir(path, mode) {
  mkdirSync(path, { recursive: true, mode });
}

export function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function atomicWriteJson(path, obj, mode = 0o600) {
  // 父目录用 0o700 收紧，避免 umask 让 servers.json 这类文件落到 0o644
  ensureDir(dirname(path), 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode });
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* best-effort */ }
    throw e;
  }
}

// ── arg parsing ──────────────────────────────────────────────────────────

export function coerce(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  if (
    (v.startsWith("{") && v.endsWith("}")) ||
    (v.startsWith("[") && v.endsWith("]"))
  ) {
    try { return JSON.parse(v); } catch { /* fall through */ }
  }
  return v;
}

export function parseToolArgs(argv) {
  const out = {};
  let yes = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") { yes = true; continue; }
    if (a === "--json" || a === "-j") {
      const raw = argv[++i];
      if (raw === undefined) throw new Error("--json requires a value");
      Object.assign(out, JSON.parse(raw));
      continue;
    }
    if (!a.startsWith("--")) { rest.push(a); continue; }
    let key;
    let raw;
    if (a.includes("=")) {
      key = a.slice(2, a.indexOf("="));
      raw = a.slice(a.indexOf("=") + 1);
    } else {
      key = a.slice(2);
      raw = argv[++i];
      if (raw === undefined) throw new Error(`--${key} requires a value`);
    }
    out[key] = coerce(raw);
  }
  return { args: out, yes, rest };
}

// ── arg validation (typo guard) ──────────────────────────────────────────

// validateArgKeys — flag CLI arg keys not declared in a tool's input schema
// (catches `--to_state` for `--target_state`). Conservative by design: only a
// schema that *explicitly closes* (additionalProperties === false) authorizes
// rejection. Absent or `true` → the server tolerates extras (or we can't tell)
// → pass through. This keeps the guard safe to share across CLIs — a tool whose
// schema doesn't close stays unaffected, so adopting it can't break callers.
//
// Returns [{ key, suggestion }] per unknown key (suggestion may be null). Only
// top-level keys are checked; nested object values pass through untouched.
export function validateArgKeys(args, inputSchema, { ignore = [] } = {}) {
  if (!inputSchema || typeof inputSchema !== "object") return [];
  if (inputSchema.additionalProperties !== false) return [];
  const props = inputSchema.properties;
  if (!props || typeof props !== "object") return [];
  const known = Object.keys(props);
  const knownSet = new Set(known);
  const ignoreSet = new Set(ignore);
  const unknown = [];
  for (const key of Object.keys(args || {})) {
    if (ignoreSet.has(key) || knownSet.has(key)) continue;
    unknown.push({ key, suggestion: suggestKey(key, known) });
  }
  return unknown;
}

// suggestKey — best "did you mean" for an unknown key: prefer the known key
// sharing the most `_`/`-`-separated tokens (so `to_state` → `target_state` via
// the shared "state" token), fall back to nearest edit distance within a small
// threshold, else null.
function suggestKey(unknown, known) {
  const tokens = (s) => String(s).split(/[_-]/).filter(Boolean);
  const ut = new Set(tokens(unknown));
  let best = null;
  let bestShared = 0;
  for (const k of known) {
    let shared = 0;
    for (const t of tokens(k)) if (ut.has(t)) shared++;
    if (shared > bestShared) { bestShared = shared; best = k; }
  }
  if (best) return best;
  let bestK = null;
  let bestD = Infinity;
  for (const k of known) {
    const d = levenshtein(unknown, k);
    if (d < bestD) { bestD = d; bestK = k; }
  }
  return bestK && bestD <= Math.max(2, Math.ceil(unknown.length * 0.4)) ? bestK : null;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ── MCP RPC ──────────────────────────────────────────────────────────────

let rpcIdSeq = 1;
export function nextId() { return rpcIdSeq++; }

export async function parseMcpResponse(res) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  if (ct.includes("application/json")) return JSON.parse(text);
  // SSE fallback（MCP spec 允许 event: message\ndata: {...}）
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

export async function rpcRaw(url, body, { fetchImpl, headers: extraHeaders } = {}) {
  const f = fetchImpl || fetch;
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(extraHeaders || {}),
  };
  const res = await f(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const sessionId = res.headers?.get?.("mcp-session-id") || null;
  const parsed = await parseMcpResponse(res);
  return { body: parsed, sessionId, response: res };
}

export async function rpc(url, body, opts) {
  const { body: parsed } = await rpcRaw(url, body, opts);
  return parsed;
}

// 通知类消息（如 notifications/initialized），无 JSON-RPC id，期望 HTTP 200/202。
export async function rpcNotify(url, body, { fetchImpl, headers: extraHeaders } = {}) {
  const f = fetchImpl || fetch;
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(extraHeaders || {}),
  };
  const res = await f(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 202) {
    const t = await res.text().catch(() => "");
    throw new Error(`notification failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
}

export async function callTool(url, name, args, opts) {
  const body = {
    jsonrpc: "2.0",
    id: nextId(),
    method: "tools/call",
    params: { name, arguments: args || {} },
  };
  return rpc(url, body, opts);
}

export async function listToolsRemote(url, opts) {
  const body = { jsonrpc: "2.0", id: nextId(), method: "tools/list", params: {} };
  return rpc(url, body, opts);
}

// ── fingerprint & cache ──────────────────────────────────────────────────

export function serverFingerprint(url, { extras } = {}) {
  let base;
  try {
    const u = new URL(url);
    const hash = (u.pathname.split("/").pop() || "").slice(-8);
    base = `${u.hostname}+${hash}`;
  } catch {
    base = "invalid-url";
  }
  if (extras && typeof extras === "object") {
    const keys = Object.keys(extras).sort();
    const tail = keys.map((k) => `${k}=${extras[k]}`).join(",");
    if (tail) base += `+${tail}`;
  }
  return base;
}

export class McpToolsCache {
  constructor({ cacheDir, ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
    if (!cacheDir) throw new Error("cacheDir required");
    this.cacheDir = cacheDir;
    this.ttlMs = ttlMs;
  }

  pathFor(key) {
    return join(this.cacheDir, `tools-${key}.json`);
  }

  read(key, expectedFingerprint) {
    const cached = readJsonIfExists(this.pathFor(key));
    if (!cached) return null;
    if (cached.serverFingerprint !== expectedFingerprint) return null;
    const fetchedAt = new Date(cached.fetchedAt).getTime();
    const age = Date.now() - fetchedAt;
    if (Number.isNaN(fetchedAt) || age < 0 || age > this.ttlMs) return null;
    if (!Array.isArray(cached.tools)) return null;
    return cached;
  }

  write(key, url, tools, { extras } = {}) {
    const payload = {
      fetchedAt: new Date().toISOString(),
      serverFingerprint: serverFingerprint(url, { extras }),
      toolCount: tools.length,
      tools,
    };
    atomicWriteJson(this.pathFor(key), payload, 0o600);
    return payload;
  }

  // ensure: 命中且未过期返回 cache；否则 listTools 并落盘。
  // refresh=true 强制重新拉。
  // headers 透传给 listToolsRemote（如 bk 的 Bearer + mcp-session-id）。
  async ensure({ key, url, refresh = false, fetchImpl, extras, headers } = {}) {
    if (!key) throw new Error("key required");
    if (!url) throw new Error("url required");
    const fp = serverFingerprint(url, { extras });
    if (!refresh) {
      const hit = this.read(key, fp);
      if (hit) return { payload: hit, cached: true };
    }
    const res = await listToolsRemote(url, { fetchImpl, headers });
    if (res.error) {
      const err = new Error(`tools/list failed: ${JSON.stringify(res.error)}`);
      err.rpcError = res.error;
      throw err;
    }
    const tools = res.result?.tools || [];
    const payload = this.write(key, url, tools, { extras });
    return { payload, cached: false };
  }
}

// ── baseline / drift ─────────────────────────────────────────────────────

// L3 baseline 记录：每个 tool 留 name + required + 静态 enum。
// 动态 enum（runtime 决定的）不在这层抓；走 SKILL.md snapshot 注释 + 调用前内省。
export function toBaselineRecord(serverTool) {
  return {
    name: serverTool.name,
    required: serverTool.inputSchema?.required || [],
    enums: extractStaticEnums(serverTool.inputSchema?.properties || {}),
  };
}

function extractStaticEnums(properties) {
  const out = {};
  for (const [k, v] of Object.entries(properties || {})) {
    if (Array.isArray(v?.enum)) out[k] = [...v.enum];
  }
  return out;
}

// 构造完整 baseline 落盘对象。
export function buildBaseline(serverTools, { extras } = {}) {
  return {
    schemaVersion: "1",
    promotedAt: new Date().toISOString(),
    toolCount: serverTools.length,
    extras: extras || null,
    tools: serverTools.map(toBaselineRecord),
  };
}

// 对比 baseline vs current server tools。
// 返回 { added, removed, requiredChanged, enumChanged }。
export function diffTools(baseline, currentTools) {
  const baseMap = new Map();
  for (const t of (baseline.tools || [])) baseMap.set(t.name, t);
  const currMap = new Map();
  for (const t of currentTools) currMap.set(t.name, t);

  const added = [];
  const removed = [];
  const requiredChanged = [];
  const enumChanged = [];

  for (const [name, t] of currMap) {
    if (!baseMap.has(name)) {
      added.push({ tool: name });
      continue;
    }
    const base = baseMap.get(name);
    const baseReq = new Set(base.required || []);
    const currReq = new Set(t.inputSchema?.required || []);
    if (!setsEqual(baseReq, currReq)) {
      requiredChanged.push({
        tool: name,
        baseline: [...baseReq],
        current: [...currReq],
        addedRequired: [...currReq].filter((x) => !baseReq.has(x)),
        removedRequired: [...baseReq].filter((x) => !currReq.has(x)),
      });
    }
    const propChanges = compareEnums(base.enums || {}, extractStaticEnums(t.inputSchema?.properties || {}));
    if (propChanges.length) enumChanged.push({ tool: name, props: propChanges });
  }

  for (const [name] of baseMap) {
    if (!currMap.has(name)) removed.push({ tool: name });
  }

  return { added, removed, requiredChanged, enumChanged };
}

export function diffHasChanges(diff) {
  return (
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.requiredChanged.length > 0 ||
    diff.enumChanged.length > 0
  );
}

function compareEnums(base, curr) {
  const changes = [];
  const allKeys = new Set([...Object.keys(base), ...Object.keys(curr)]);
  for (const k of allKeys) {
    const b = base[k];
    const c = curr[k];
    if (!b && c) {
      changes.push({ prop: k, change: "enum_added", current: c });
    } else if (b && !c) {
      changes.push({ prop: k, change: "enum_removed", baseline: b });
    } else if (b && c && !arraysEqualUnsorted(b, c)) {
      changes.push({
        prop: k,
        change: "enum_value_changed",
        baseline: b,
        current: c,
        added: c.filter((v) => !b.includes(v)),
        removed: b.filter((v) => !c.includes(v)),
      });
    }
  }
  return changes;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function arraysEqualUnsorted(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

// ── danger detection ─────────────────────────────────────────────────────

// dangerClass: registry 命中优先；否则前缀兜底；都不命中返回 null。
//
// registry 格式：
//   - 无 kind：{ "delete_xxx": { type, note } }
//   - 有 kind：{ "doc:delete_xxx": { type, note } }（registryKey="doc"）
export function dangerClass(toolName, {
  registry = {},
  registryKey,
  prefixes = DEFAULT_DANGEROUS_PREFIXES,
} = {}) {
  const fullKey = registryKey ? `${registryKey}:${toolName}` : toolName;
  if (registry[fullKey]) return registry[fullKey];
  for (const p of prefixes) {
    if (toolName.startsWith(p)) {
      return {
        type: "pattern-match",
        note: `tool name starts with "${p}" (matched by fallback pattern)`,
      };
    }
  }
  return null;
}

// ── error normalization ──────────────────────────────────────────────────

// normalizeMcpError: 把 JSON-RPC error body / Error 实例分类到三桶。
// 不命中返回 null，调用方按各自 CLI 现状处理。
//
// 输入形态：
//   - JSON-RPC error 对象：{ code, message, data? }
//   - tool result.isError=true 的 content：{ content:[{type:"text",text:"..."}], isError:true }
//   - 抛出的 Error 实例
export function normalizeMcpError(errOrBody) {
  if (!errOrBody) return null;
  const message = extractMessage(errOrBody);
  const code = errOrBody.code;

  // tool_not_found
  if (
    code === -32601 ||
    /unknown tool|tool not found|no such tool|method not found/i.test(message)
  ) {
    return {
      kind: ERROR_KINDS.TOOL_NOT_FOUND,
      hint: "the tool may have been renamed or removed on the server; run list-tools --refresh to re-align",
      exitCode: EXIT_CODES.TOOL_NOT_FOUND,
      originalMessage: message,
    };
  }

  // auth
  if (
    code === 401 ||
    code === 403 ||
    /unauthorized|forbidden|invalid token|token expired|authentication failed/i.test(message)
  ) {
    return {
      kind: ERROR_KINDS.AUTH,
      hint: "credentials missing or rejected; rerun the auth subcommand and verify the token / URL",
      exitCode: EXIT_CODES.AUTH,
      originalMessage: message,
    };
  }

  // enum_invalid
  if (
    /illegal|invalid|not allowed|未找到|非法/i.test(message) &&
    /enum|value|状态|优先级|state|priority|target_state|allowed values/i.test(message)
  ) {
    return {
      kind: ERROR_KINDS.ENUM_INVALID,
      hint: "enum value rejected; the server's enum set may have changed — refresh schema or run the relevant introspection (e.g. --list_states / get_fields)",
      exitCode: EXIT_CODES.ENUM_INVALID,
      originalMessage: message,
    };
  }

  return null;
}

function extractMessage(errOrBody) {
  if (typeof errOrBody === "string") return errOrBody;
  if (errOrBody instanceof Error) return errOrBody.message || "";
  if (typeof errOrBody.message === "string") return errOrBody.message;
  if (Array.isArray(errOrBody.content)) {
    const texts = errOrBody.content
      .filter((c) => c?.type === "text")
      .map((c) => c.text || "");
    if (texts.length) return texts.join(" ");
  }
  return JSON.stringify(errOrBody);
}
