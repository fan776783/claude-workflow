import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveBucketDir, writeJobJson, jobJsonPath, jobLogPath, listJobIds } from "../state.mjs";
import { pruneBucket } from "../gc.mjs";

async function makeBucket(name) {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), `cb-gc-${name}-`));
  return { ws, bucket: resolveBucketDir(ws) };
}

async function makeJob(bucket, id, status, mtimeOffsetMs = 0) {
  await writeJobJson(bucket, id, { id, status });
  await fsp.writeFile(jobLogPath(bucket, id), `[t] ${id}\n`);
  if (mtimeOffsetMs !== 0) {
    const ts = new Date(Date.now() + mtimeOffsetMs);
    await fsp.utimes(jobJsonPath(bucket, id), ts, ts);
    await fsp.utimes(jobLogPath(bucket, id), ts, ts);
  }
}

test("pruneBucket: count cap removes oldest terminal jobs", async () => {
  const { ws, bucket } = await makeBucket("count");
  for (let i = 0; i < 25; i++) {
    await makeJob(bucket, `job-${String(i).padStart(2, "0")}`, "completed", -i * 1000);
  }
  const { removed } = await pruneBucket(bucket, { countCap: 20, ageDays: 365 });
  assert.equal(removed.length, 5, "should remove 5 oldest");
  const remaining = await listJobIds(bucket);
  assert.equal(remaining.length, 20);
  await fsp.rm(ws, { recursive: true, force: true });
});

test("pruneBucket: age cap removes terminal jobs older than threshold", async () => {
  const { ws, bucket } = await makeBucket("age");
  const oldMs = -15 * 24 * 60 * 60 * 1000;
  await makeJob(bucket, "fresh", "completed", -1000);
  await makeJob(bucket, "stale", "completed", oldMs);
  const { removed } = await pruneBucket(bucket, { countCap: 100, ageDays: 14 });
  assert.deepEqual(removed, ["stale"]);
  await fsp.rm(ws, { recursive: true, force: true });
});

test("pruneBucket: never removes running / launching jobs", async () => {
  const { ws, bucket } = await makeBucket("active");
  const oldMs = -30 * 24 * 60 * 60 * 1000;
  await makeJob(bucket, "running-old", "running", oldMs);
  await makeJob(bucket, "launching-old", "launching", oldMs);
  await makeJob(bucket, "done-old", "completed", oldMs);
  const { removed } = await pruneBucket(bucket, { countCap: 100, ageDays: 14 });
  assert.deepEqual(removed, ["done-old"]);
  await fsp.rm(ws, { recursive: true, force: true });
});

test("pruneBucket: ENOENT bucket returns empty removal, no throw", async () => {
  const bucket = path.join(os.tmpdir(), `cb-gc-missing-${Date.now()}`);
  const out = await pruneBucket(bucket);
  assert.deepEqual(out.removed, []);
});

test("pruneBucket: concurrent prune is idempotent (ENOENT tolerated)", async () => {
  const { ws, bucket } = await makeBucket("concurrent");
  for (let i = 0; i < 30; i++) {
    await makeJob(bucket, `j-${i}`, "completed", -(30 - i) * 1000);
  }
  const [r1, r2] = await Promise.all([
    pruneBucket(bucket, { countCap: 20, ageDays: 365 }),
    pruneBucket(bucket, { countCap: 20, ageDays: 365 }),
  ]);
  const total = r1.removed.length + r2.removed.length;
  assert.ok(total >= 10, `combined removals should cover the 10 surplus, got ${total}`);
  const remaining = await listJobIds(bucket);
  assert.ok(remaining.length <= 20, `remaining ${remaining.length} should be <= cap`);
  await fsp.rm(ws, { recursive: true, force: true });
});
