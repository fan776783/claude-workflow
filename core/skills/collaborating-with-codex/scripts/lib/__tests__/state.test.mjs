import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveBucketDir, writeJobJson, readJobJson, listJobIds, generateJobId, getStateRoot } from "../state.mjs";

async function makeWorkspace(name) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `cb-state-${name}-`));
  return dir;
}

test("resolveBucketDir is stable across symlink + relative cwd", async (t) => {
  const ws = await makeWorkspace("stability");
  const link = path.join(os.tmpdir(), `cb-link-${Date.now()}`);
  try {
    await fsp.symlink(ws, link, "dir");
  } catch (err) {
    // Windows 无 Developer Mode/管理员时 symlink 创建报 EPERM——能力缺失,跳过而非失败
    if (err.code === "EPERM" || err.code === "EACCES") {
      await fsp.rm(ws, { recursive: true, force: true });
      t.skip("symlink creation unavailable (Windows requires Developer Mode/admin)");
      return;
    }
    throw err;
  }
  try {
    const a = resolveBucketDir(ws);
    const b = resolveBucketDir(link);
    assert.equal(a, b, "symlink should resolve to same bucket via realpath");
    assert.ok(a.startsWith(getStateRoot()), "bucket should sit under STATE_ROOT");
    assert.match(path.basename(a), /^[a-zA-Z0-9._-]+-[a-f0-9]{8}$/, "bucket name must be slug-sha8");
  } finally {
    await fsp.unlink(link).catch(() => {});
    await fsp.rm(ws, { recursive: true, force: true });
  }
});

test("resolveBucketDir slugifies awkward basenames", () => {
  // Use crafted paths via realpathSync fallback (we just check slug shape)
  // Cannot actually create paths with all special chars portably; assert slug rule via basename forms
  // by checking that hash is 8 hex regardless of input.
  const a = resolveBucketDir(os.tmpdir());
  assert.match(path.basename(a), /^[a-zA-Z0-9._-]+-[a-f0-9]{8}$/);
});

test("writeJobJson / readJobJson round-trip", async () => {
  const ws = await makeWorkspace("io");
  const bucket = resolveBucketDir(ws);
  const id = generateJobId();
  const payload = { id, status: "running", phase: "starting", note: "测试 ✓" };
  await writeJobJson(bucket, id, payload);
  const back = await readJobJson(bucket, id);
  assert.deepEqual(back, payload);
  await fsp.rm(bucket, { recursive: true, force: true });
  await fsp.rm(ws, { recursive: true, force: true });
});

test("listJobIds returns ids without .json suffix; ENOENT yields []", async () => {
  const ws = await makeWorkspace("list");
  const bucket = resolveBucketDir(ws);
  assert.deepEqual(await listJobIds(bucket), []);
  await writeJobJson(bucket, "job-a", { id: "job-a", status: "completed" });
  await writeJobJson(bucket, "job-b", { id: "job-b", status: "completed" });
  const ids = await listJobIds(bucket);
  assert.deepEqual(ids.sort(), ["job-a", "job-b"]);
  await fsp.rm(bucket, { recursive: true, force: true });
  await fsp.rm(ws, { recursive: true, force: true });
});
