import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeReasoningSections, collectTouchedFiles, truncateForLog, emitLogLine } from "../capture.mjs";

test("mergeReasoningSections dedupes and merges in order", () => {
  const a = ["first thought", "second thought"];
  const b = ["second thought", "  first thought  ", "third"];
  assert.deepEqual(mergeReasoningSections(a, b), ["first thought", "second thought", "third"]);
});

test("mergeReasoningSections normalizes whitespace before compare", () => {
  const merged = mergeReasoningSections(["abc def"], ["abc   def\n", "abc\tdef"]);
  assert.deepEqual(merged, ["abc def"]);
});

test("collectTouchedFiles dedupes across multiple fileChange items", () => {
  const changes = [
    { changes: [{ path: "src/a.ts" }, { path: "src/b.ts" }] },
    { changes: [{ path: "src/a.ts" }] },
    { changes: [{ path: "src/c.ts" }, { other: "noop" }] },
  ];
  assert.deepEqual(collectTouchedFiles(changes).sort(), ["src/a.ts", "src/b.ts", "src/c.ts"]);
});

test("truncateForLog keeps short text intact", () => {
  assert.equal(truncateForLog("short message"), "short message");
});

test("truncateForLog truncates with full-N-chars annotation", () => {
  const long = "x".repeat(500);
  const out = truncateForLog(long);
  assert.ok(out.length <= 200, `truncated length ${out.length} must be <= 200`);
  assert.match(out, /\(full 500 chars in snapshot\)$/);
});

test("emitLogLine appends timestamped line with truncation", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cb-cap-"));
  const file = path.join(dir, "test.log");
  emitLogLine(file, "hello");
  emitLogLine(file, "x".repeat(400));
  const content = await fsp.readFile(file, "utf8");
  const lines = content.split("\n").filter(Boolean);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\[\d{4}-\d{2}-\d{2}T[\d:.Z-]+\] hello$/);
  assert.match(lines[1], /\(full 400 chars in snapshot\)$/);
  await fsp.rm(dir, { recursive: true, force: true });
});
