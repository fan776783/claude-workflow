// node:test fixture for mcp-baseline.mjs
// run: node --test core/skills/_shared/mcp-baseline.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import {
  fingerprint,
  redact,
  coerce,
  parseToolArgs,
  serverFingerprint,
  McpToolsCache,
  dangerClass,
  normalizeMcpError,
  ERROR_KINDS,
  EXIT_CODES,
  DEFAULT_DANGEROUS_PREFIXES,
  rpcRaw,
  buildBaseline,
  toBaselineRecord,
  diffTools,
  diffHasChanges,
} from "./mcp-baseline.mjs";

// ── fingerprint ──────────────────────────────────────────────────────────

test("fingerprint short input → ***", () => {
  assert.equal(fingerprint(""), "***");
  assert.equal(fingerprint("short"), "***");
  assert.equal(fingerprint(null), "***");
});

test("fingerprint long input → first4...last4", () => {
  assert.equal(fingerprint("abcdefghijkl"), "abcd...ijkl");
  assert.equal(fingerprint("ak_2ecd9abcdef1234567890029fd"), "ak_2...29fd");
});

// ── redact ───────────────────────────────────────────────────────────────

test("redact URL query param key", () => {
  const got = redact("https://x.com/y?key=secret-token-value-here");
  assert.match(got, /key=secr\.\.\.here/);
});

test("redact JSON token field", () => {
  const got = redact('{"uploadToken":"sensitive-blob-here","other":"ok"}');
  assert.match(got, /"uploadToken":"sens\.\.\.here"/);
  assert.match(got, /"other":"ok"/);
});

test("redact passes through non-sensitive content", () => {
  assert.equal(redact("just some plain text"), "just some plain text");
});

// ── coerce ───────────────────────────────────────────────────────────────

test("coerce primitives", () => {
  assert.equal(coerce("true"), true);
  assert.equal(coerce("false"), false);
  assert.equal(coerce("null"), null);
  assert.equal(coerce("42"), 42);
  assert.equal(coerce("3.14"), 3.14);
  assert.equal(coerce("-5"), -5);
  assert.equal(coerce("hello"), "hello");
});

test("coerce JSON object / array", () => {
  assert.deepEqual(coerce('{"a":1}'), { a: 1 });
  assert.deepEqual(coerce("[1,2,3]"), [1, 2, 3]);
});

test("coerce malformed JSON stays string", () => {
  assert.equal(coerce("{not-json}"), "{not-json}");
});

// ── parseToolArgs ────────────────────────────────────────────────────────

test("parseToolArgs basic kv + coercion", () => {
  const { args, yes, rest } = parseToolArgs([
    "--name", "alice",
    "--count", "5",
    "--ok", "true",
  ]);
  assert.deepEqual(args, { name: "alice", count: 5, ok: true });
  assert.equal(yes, false);
  assert.deepEqual(rest, []);
});

test("parseToolArgs --json merges into args", () => {
  const { args } = parseToolArgs([
    "--json", '{"a":1,"b":"x"}',
    "--c", "z",
  ]);
  assert.deepEqual(args, { a: 1, b: "x", c: "z" });
});

test("parseToolArgs --yes captured", () => {
  const { yes } = parseToolArgs(["--yes"]);
  assert.equal(yes, true);
});

test("parseToolArgs --key=value form", () => {
  const { args } = parseToolArgs(["--name=alice", "--n=10"]);
  assert.deepEqual(args, { name: "alice", n: 10 });
});

test("parseToolArgs positional → rest", () => {
  const { args, rest } = parseToolArgs(["pos1", "--k", "v", "pos2"]);
  assert.deepEqual(args, { k: "v" });
  assert.deepEqual(rest, ["pos1", "pos2"]);
});

test("parseToolArgs --key without value throws", () => {
  assert.throws(() => parseToolArgs(["--missing"]));
});

// ── serverFingerprint ────────────────────────────────────────────────────

test("serverFingerprint stable across key changes", () => {
  const a = serverFingerprint("https://mcp.example.com/server/abc12345?key=xxx");
  const b = serverFingerprint("https://mcp.example.com/server/abc12345?key=yyy");
  assert.equal(a, b);
});

test("serverFingerprint differs on host", () => {
  const a = serverFingerprint("https://a.com/server/xxxxxxxx");
  const b = serverFingerprint("https://b.com/server/xxxxxxxx");
  assert.notEqual(a, b);
});

test("serverFingerprint differs on path-hash tail", () => {
  const a = serverFingerprint("https://x.com/server/aaaaaaaa");
  const b = serverFingerprint("https://x.com/server/bbbbbbbb");
  assert.notEqual(a, b);
});

test("serverFingerprint with extras (e.g. serverInfo.version T13)", () => {
  const without = serverFingerprint("https://x.com/server/abcdefgh");
  const withV = serverFingerprint("https://x.com/server/abcdefgh", {
    extras: { version: "1.2.3" },
  });
  assert.notEqual(without, withV);
});

// ── McpToolsCache ────────────────────────────────────────────────────────

function tmpCache() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-baseline-test-"));
  return {
    cache: new McpToolsCache({ cacheDir: dir }),
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("McpToolsCache write/read roundtrip", () => {
  const { cache, cleanup } = tmpCache();
  try {
    const url = "https://mcp.example.com/server/abc12345?key=x";
    const tools = [{ name: "tool_a" }, { name: "tool_b" }];
    cache.write("test", url, tools);
    const hit = cache.read("test", serverFingerprint(url));
    assert.ok(hit);
    assert.equal(hit.toolCount, 2);
    assert.deepEqual(hit.tools, tools);
  } finally {
    cleanup();
  }
});

test("McpToolsCache miss on fingerprint mismatch", () => {
  const { cache, cleanup } = tmpCache();
  try {
    cache.write("test", "https://a.com/server/aaaaaaaa", [{ name: "x" }]);
    const hit = cache.read("test", serverFingerprint("https://b.com/server/bbbbbbbb"));
    assert.equal(hit, null);
  } finally {
    cleanup();
  }
});

test("McpToolsCache miss on TTL expiry", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-baseline-test-"));
  try {
    const cache = new McpToolsCache({ cacheDir: dir, ttlMs: -1 });
    const url = "https://a.com/server/aaaaaaaa";
    cache.write("test", url, [{ name: "x" }]);
    const hit = cache.read("test", serverFingerprint(url));
    assert.equal(hit, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("McpToolsCache.ensure: miss → fetch → hit → refresh", async () => {
  const { cache, cleanup } = tmpCache();
  try {
    const url = "https://x.com/server/xxxxxxxx";
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      return {
        ok: true,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [{ name: "tool_a" }, { name: "tool_b" }, { name: "tool_c" }] },
        }),
      };
    };

    const first = await cache.ensure({ key: "test", url, fetchImpl: mockFetch });
    assert.equal(first.cached, false);
    assert.equal(first.payload.toolCount, 3);
    assert.equal(fetchCount, 1);

    const second = await cache.ensure({ key: "test", url, fetchImpl: mockFetch });
    assert.equal(second.cached, true);
    assert.equal(fetchCount, 1, "cache hit should not re-fetch");

    const third = await cache.ensure({ key: "test", url, fetchImpl: mockFetch, refresh: true });
    assert.equal(third.cached, false);
    assert.equal(fetchCount, 2);
  } finally {
    cleanup();
  }
});

test("McpToolsCache.ensure: server returns error → throws with rpcError", async () => {
  const { cache, cleanup } = tmpCache();
  try {
    const url = "https://x.com/server/xxxxxxxx";
    const mockFetch = async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      }),
    });
    await assert.rejects(
      () => cache.ensure({ key: "test", url, fetchImpl: mockFetch }),
      (err) => err.rpcError?.code === -32601,
    );
  } finally {
    cleanup();
  }
});

// ── dangerClass ──────────────────────────────────────────────────────────

test("dangerClass: explicit registry hit (flat)", () => {
  const r = dangerClass("delete_xxx", {
    registry: { "delete_xxx": { type: "destroy", note: "custom note" } },
  });
  assert.equal(r.type, "destroy");
  assert.equal(r.note, "custom note");
});

test("dangerClass: explicit registry hit (kinded)", () => {
  const r = dangerClass("delete_base", {
    registry: { "aitable:delete_base": { type: "destroy", note: "del Base" } },
    registryKey: "aitable",
  });
  assert.equal(r.type, "destroy");
  assert.equal(r.note, "del Base");
});

test("dangerClass: prefix fallback for unknown tool", () => {
  const r = dangerClass("delete_some_new_thing");
  assert.equal(r.type, "pattern-match");
  assert.match(r.note, /starts with "delete_"/);
});

test("dangerClass: all 5 default prefixes covered", () => {
  for (const p of DEFAULT_DANGEROUS_PREFIXES) {
    const r = dangerClass(`${p}fake`);
    assert.ok(r, `${p}fake should match`);
    assert.equal(r.type, "pattern-match");
  }
});

test("dangerClass: safe tool returns null", () => {
  assert.equal(dangerClass("get_issue"), null);
  assert.equal(dangerClass("list_tables"), null);
  assert.equal(dangerClass("add_comment"), null);
});

test("dangerClass: registry takes precedence over prefix", () => {
  const r = dangerClass("delete_xxx", {
    registry: { "delete_xxx": { type: "destroy", note: "explicit" } },
  });
  assert.equal(r.note, "explicit");
});

// ── normalizeMcpError ────────────────────────────────────────────────────

test("normalizeMcpError: tool_not_found by JSON-RPC code -32601", () => {
  const r = normalizeMcpError({ code: -32601, message: "Method not found" });
  assert.equal(r.kind, ERROR_KINDS.TOOL_NOT_FOUND);
  assert.equal(r.exitCode, EXIT_CODES.TOOL_NOT_FOUND);
  assert.match(r.hint, /list-tools/);
});

test("normalizeMcpError: tool_not_found by message", () => {
  const r = normalizeMcpError({ code: -32603, message: "unknown tool: get_xxx" });
  assert.equal(r.kind, ERROR_KINDS.TOOL_NOT_FOUND);
});

test("normalizeMcpError: auth by HTTP 401", () => {
  const r = normalizeMcpError({ code: 401, message: "Unauthorized" });
  assert.equal(r.kind, ERROR_KINDS.AUTH);
  assert.equal(r.exitCode, EXIT_CODES.AUTH);
});

test("normalizeMcpError: auth by HTTP 403", () => {
  const r = normalizeMcpError({ code: 403, message: "Forbidden" });
  assert.equal(r.kind, ERROR_KINDS.AUTH);
});

test("normalizeMcpError: auth by message variants", () => {
  assert.equal(normalizeMcpError({ message: "invalid token" })?.kind, ERROR_KINDS.AUTH);
  assert.equal(normalizeMcpError({ message: "token expired" })?.kind, ERROR_KINDS.AUTH);
  assert.equal(normalizeMcpError({ message: "authentication failed" })?.kind, ERROR_KINDS.AUTH);
});

test("normalizeMcpError: enum_invalid for Chinese status messages", () => {
  const r = normalizeMcpError({
    code: 400,
    message: "未找到目标状态「不存在的状态」",
  });
  assert.equal(r.kind, ERROR_KINDS.ENUM_INVALID);
  assert.equal(r.exitCode, EXIT_CODES.ENUM_INVALID);
});

test("normalizeMcpError: enum_invalid for English priority", () => {
  const r = normalizeMcpError({
    code: 400,
    message: "invalid priority value: SUPER_HIGH",
  });
  assert.equal(r.kind, ERROR_KINDS.ENUM_INVALID);
});

test("normalizeMcpError: tool result.isError content", () => {
  const r = normalizeMcpError({
    isError: true,
    content: [{ type: "text", text: "tool not found: foo" }],
  });
  assert.equal(r?.kind, ERROR_KINDS.TOOL_NOT_FOUND);
});

test("normalizeMcpError: unknown error → null", () => {
  assert.equal(normalizeMcpError({ code: 500, message: "internal hiccup" }), null);
  assert.equal(normalizeMcpError(null), null);
  assert.equal(normalizeMcpError(undefined), null);
});

test("normalizeMcpError: Error instance", () => {
  const r = normalizeMcpError(new Error("method not found"));
  assert.equal(r.kind, ERROR_KINDS.TOOL_NOT_FOUND);
});

// ── rpcRaw ───────────────────────────────────────────────────────────────

test("rpcRaw: returns body + sessionId from response header", async () => {
  const mockFetch = async (url, init) => ({
    ok: true,
    headers: {
      get: (k) => (k === "content-type" ? "application/json" : k === "mcp-session-id" ? "sess-abc" : null),
    },
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
  });
  const { body, sessionId } = await rpcRaw("https://x/", { jsonrpc: "2.0", id: 1, method: "ping" }, { fetchImpl: mockFetch });
  assert.equal(sessionId, "sess-abc");
  assert.deepEqual(body.result, { ok: true });
});

test("rpcRaw: injects custom headers (Bearer + session)", async () => {
  let capturedHeaders;
  const mockFetch = async (url, init) => {
    capturedHeaders = init.headers;
    return {
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
    };
  };
  await rpcRaw("https://x/", { jsonrpc: "2.0", id: 1, method: "test" }, {
    fetchImpl: mockFetch,
    headers: { authorization: "Bearer secret", "mcp-session-id": "abc" },
  });
  assert.equal(capturedHeaders.authorization, "Bearer secret");
  assert.equal(capturedHeaders["mcp-session-id"], "abc");
  assert.equal(capturedHeaders["content-type"], "application/json");
});

// ── baseline + diff ──────────────────────────────────────────────────────

test("toBaselineRecord: extracts name + required + static enums", () => {
  const tool = {
    name: "transition_issue",
    inputSchema: {
      required: ["issue_number", "target_state"],
      properties: {
        issue_number: { type: "string" },
        target_state: { type: "string", enum: ["待处理", "处理中", "已完成"] },
        comment: { type: "string" },
      },
    },
  };
  const rec = toBaselineRecord(tool);
  assert.equal(rec.name, "transition_issue");
  assert.deepEqual(rec.required, ["issue_number", "target_state"]);
  assert.deepEqual(rec.enums, { target_state: ["待处理", "处理中", "已完成"] });
});

test("buildBaseline: full shape", () => {
  const tools = [
    { name: "a", inputSchema: { required: ["x"], properties: { x: { type: "string" } } } },
    { name: "b", inputSchema: { required: [], properties: {} } },
  ];
  const baseline = buildBaseline(tools, { extras: { version: "1.0" } });
  assert.equal(baseline.schemaVersion, "1");
  assert.equal(baseline.toolCount, 2);
  assert.deepEqual(baseline.extras, { version: "1.0" });
  assert.equal(baseline.tools.length, 2);
});

test("diffTools: added tool detected", () => {
  const baseline = buildBaseline([{ name: "a", inputSchema: { required: [], properties: {} } }]);
  const current = [
    { name: "a", inputSchema: { required: [], properties: {} } },
    { name: "b", inputSchema: { required: [], properties: {} } },
  ];
  const d = diffTools(baseline, current);
  assert.deepEqual(d.added, [{ tool: "b" }]);
  assert.equal(d.removed.length, 0);
});

test("diffTools: removed tool detected", () => {
  const baseline = buildBaseline([
    { name: "a", inputSchema: { required: [], properties: {} } },
    { name: "b", inputSchema: { required: [], properties: {} } },
  ]);
  const current = [{ name: "a", inputSchema: { required: [], properties: {} } }];
  const d = diffTools(baseline, current);
  assert.deepEqual(d.removed, [{ tool: "b" }]);
});

test("diffTools: required changed detected", () => {
  const baseline = buildBaseline([
    { name: "a", inputSchema: { required: ["x"], properties: { x: {}, y: {} } } },
  ]);
  const current = [
    { name: "a", inputSchema: { required: ["x", "y"], properties: { x: {}, y: {} } } },
  ];
  const d = diffTools(baseline, current);
  assert.equal(d.requiredChanged.length, 1);
  assert.deepEqual(d.requiredChanged[0].addedRequired, ["y"]);
  assert.deepEqual(d.requiredChanged[0].removedRequired, []);
});

test("diffTools: enum value drift detected (the main failure mode)", () => {
  const baseline = buildBaseline([
    {
      name: "transition_issue",
      inputSchema: {
        required: ["state"],
        properties: { state: { type: "string", enum: ["pending", "in_progress"] } },
      },
    },
  ]);
  const current = [
    {
      name: "transition_issue",
      inputSchema: {
        required: ["state"],
        properties: { state: { type: "string", enum: ["pending", "in_progress", "blocked"] } },
      },
    },
  ];
  const d = diffTools(baseline, current);
  assert.equal(d.enumChanged.length, 1);
  assert.equal(d.enumChanged[0].tool, "transition_issue");
  assert.equal(d.enumChanged[0].props[0].change, "enum_value_changed");
  assert.deepEqual(d.enumChanged[0].props[0].added, ["blocked"]);
  assert.deepEqual(d.enumChanged[0].props[0].removed, []);
});

test("diffTools: enum order-insensitive equality", () => {
  const baseline = buildBaseline([
    { name: "a", inputSchema: { required: [], properties: { x: { enum: ["b", "a", "c"] } } } },
  ]);
  const current = [
    { name: "a", inputSchema: { required: [], properties: { x: { enum: ["c", "a", "b"] } } } },
  ];
  const d = diffTools(baseline, current);
  assert.equal(d.enumChanged.length, 0);
});

test("diffHasChanges: false when all empty", () => {
  assert.equal(diffHasChanges({ added: [], removed: [], requiredChanged: [], enumChanged: [] }), false);
});

test("diffHasChanges: true on any change", () => {
  assert.equal(diffHasChanges({ added: [{ tool: "x" }], removed: [], requiredChanged: [], enumChanged: [] }), true);
  assert.equal(diffHasChanges({ added: [], removed: [{ tool: "x" }], requiredChanged: [], enumChanged: [] }), true);
  assert.equal(diffHasChanges({ added: [], removed: [], requiredChanged: [{}], enumChanged: [] }), true);
  assert.equal(diffHasChanges({ added: [], removed: [], requiredChanged: [], enumChanged: [{}] }), true);
});
