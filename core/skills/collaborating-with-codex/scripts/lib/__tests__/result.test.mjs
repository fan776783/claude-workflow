import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveBucketDir, writeJobJson, jobLogPath } from "../state.mjs";
import { resolveJobId, renderBrief, renderDetail, renderResult, formatElapsedDuration, classifyTurnOutcome } from "../result.mjs";

async function makeBucket(name) {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), `cb-res-${name}-`));
  return { ws, bucket: resolveBucketDir(ws) };
}

test("resolveJobId: exact match wins", async () => {
  const { ws, bucket } = await makeBucket("exact");
  await writeJobJson(bucket, "job-abc-1", { id: "job-abc-1" });
  await writeJobJson(bucket, "job-abc-12", { id: "job-abc-12" });
  assert.equal(await resolveJobId(bucket, "job-abc-1"), "job-abc-1");
  await fsp.rm(ws, { recursive: true, force: true });
});

test("resolveJobId: unique prefix matches", async () => {
  const { ws, bucket } = await makeBucket("prefix");
  await writeJobJson(bucket, "job-uniq-xyz", { id: "job-uniq-xyz" });
  assert.equal(await resolveJobId(bucket, "job-uniq"), "job-uniq-xyz");
  await fsp.rm(ws, { recursive: true, force: true });
});

test("resolveJobId: ambiguous prefix throws", async () => {
  const { ws, bucket } = await makeBucket("ambig");
  await writeJobJson(bucket, "job-amb-1", { id: "job-amb-1" });
  await writeJobJson(bucket, "job-amb-2", { id: "job-amb-2" });
  await assert.rejects(() => resolveJobId(bucket, "job-amb"), /ambiguous/);
  await fsp.rm(ws, { recursive: true, force: true });
});

test("resolveJobId: zero match throws", async () => {
  const { ws, bucket } = await makeBucket("zero");
  await writeJobJson(bucket, "job-x", { id: "job-x" });
  await assert.rejects(() => resolveJobId(bucket, "job-y"), /No job found/);
  await fsp.rm(ws, { recursive: true, force: true });
});

test("renderBrief returns minimal observability schema", () => {
  const job = {
    id: "job-1", status: "running", phase: "verifying",
    startedAt: new Date(Date.now() - 90000).toISOString(),
    logFile: null,
  };
  const brief = renderBrief(job);
  assert.deepEqual(Object.keys(brief).sort(), ["elapsed", "id", "lastEvent", "logFile", "phase", "status"]);
  assert.equal(brief.id, "job-1");
  assert.match(brief.elapsed, /\d+m \d+s|\d+s/);
});

test("renderDetail includes progressPreview from log", async () => {
  const { ws, bucket } = await makeBucket("detail");
  const id = "job-d";
  const logFile = jobLogPath(bucket, id);
  await fsp.mkdir(bucket, { recursive: true });
  await fsp.writeFile(logFile, "[t1] one\n[t2] two\n[t3] three\n");
  const job = { id, status: "running", phase: "investigating", startedAt: new Date().toISOString(), logFile };
  const detail = renderDetail(job);
  assert.equal(detail.progressPreview.length, 3);
  assert.match(detail.progressPreview[2], /three/);
  await fsp.rm(ws, { recursive: true, force: true });
});

test("renderResult throws when job is still active", () => {
  const job = { id: "job-r", status: "running", phase: "verifying" };
  assert.throws(() => renderResult(job), /still running/);
});

test("renderResult aggregates terminal fields", () => {
  const job = {
    id: "job-done", status: "completed", command: "task",
    sessionId: "sess-1", threadId: "thr-1", turnId: "turn-1",
    agentMessages: "all good", touchedFiles: ["src/x.ts"], fileChanges: [{ changes: [{ path: "src/x.ts" }] }],
    commandExecutions: [], reasoningSummary: ["thought a"],
    startedAt: new Date(Date.now() - 5000).toISOString(),
    completedAt: new Date().toISOString(),
  };
  const out = renderResult(job);
  assert.equal(out.success, true);
  assert.equal(out.agentMessages, "all good");
  assert.deepEqual(out.touchedFiles, ["src/x.ts"]);
  assert.match(out.elapsed, /\ds/);
});

test("formatElapsedDuration handles invalid input gracefully", () => {
  assert.equal(formatElapsedDuration(null), null);
  assert.equal(formatElapsedDuration("not-a-date"), null);
});

test("classifyTurnOutcome: clean completion is success", () => {
  const out = classifyTurnOutcome({ completed: true, error: null });
  assert.deepEqual(out, { success: true, fatalError: null, recovered: null });
});

test("classifyTurnOutcome: recovered stream disconnect is success, not failure", () => {
  // Real shape: codex reconnected and the turn reached completion despite the drop.
  const error = {
    message: "Reconnecting... 5/5",
    codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } },
    additionalDetails: "request timed out",
  };
  const out = classifyTurnOutcome({ completed: true, error });
  assert.equal(out.success, true);
  assert.equal(out.fatalError, null);
  assert.equal(out.recovered, error);
});

test("classifyTurnOutcome: auth/unauthorized stays fatal even when turn completed", () => {
  // Real shape: codexErrorInfo is the string "unauthorized"; turn/completed still fired.
  const error = {
    message: "Your access token could not be refreshed because your refresh token was revoked.",
    codexErrorInfo: "unauthorized",
  };
  const out = classifyTurnOutcome({ completed: true, error });
  assert.equal(out.success, false);
  assert.equal(out.fatalError, error);
  assert.equal(out.recovered, null);
});

test("classifyTurnOutcome: a stream disconnect that never completed is a failure", () => {
  const error = { message: "Reconnecting... 5/5", codexErrorInfo: { responseStreamDisconnected: {} } };
  const out = classifyTurnOutcome({ completed: false, error });
  assert.equal(out.success, false);
  assert.equal(out.fatalError, error);
  assert.equal(out.recovered, null);
});
