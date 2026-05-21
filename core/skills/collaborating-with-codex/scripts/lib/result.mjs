// SPDX-License-Identifier: MIT
// Portions adapted from codex-plugin-cc (Apache-2.0). See ../../NOTICE.

import fs from "node:fs";
import { TERMINAL_STATES, jobJsonPath, jobLogPath, listJobIds, readJobJson } from "./state.mjs";

const PROGRESS_PREVIEW_LINES = 8;

export function formatElapsedDuration(startValue, endValue = null) {
  const start = Date.parse(startValue ?? "");
  if (!Number.isFinite(start)) return null;
  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(end) || end < start) return null;
  const total = Math.max(0, Math.round((end - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function readLogTail(logFile, maxLines = PROGRESS_PREVIEW_LINES) {
  try {
    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function stripLogPrefix(line) {
  return line.replace(/^\[[^\]]+\]\s*/, "").trim();
}

export async function resolveJobId(bucket, ref) {
  const ids = await listJobIds(bucket);
  if (!ref) {
    if (ids.length === 0) throw new Error("No jobs found in this bucket.");
    throw new Error("Job id is required. Use --status <id> with a specific job id.");
  }
  if (ids.includes(ref)) return ref;
  const prefixMatches = ids.filter((id) => id.startsWith(ref));
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) {
    throw new Error(`Job id "${ref}" is ambiguous (matches ${prefixMatches.length}). Use a longer prefix.`);
  }
  throw new Error(`No job found for "${ref}" in this bucket.`);
}

export function renderBrief(job) {
  const logFile = job.logFile ?? null;
  const lastEvent = (() => {
    if (!logFile) return null;
    const tail = readLogTail(logFile, 1);
    return tail[0] ? stripLogPrefix(tail[0]) : null;
  })();
  return {
    id: job.id,
    status: job.status,
    phase: job.phase ?? null,
    elapsed: formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? null),
    lastEvent,
    logFile,
  };
}

export function renderDetail(job) {
  const logFile = job.logFile ?? null;
  return {
    ...job,
    elapsed: formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? null),
    progressPreview: logFile ? readLogTail(logFile, PROGRESS_PREVIEW_LINES) : [],
  };
}

export function renderResult(job) {
  if (!TERMINAL_STATES.has(job.status)) {
    const phase = job.phase ?? job.status;
    throw new Error(`Job ${job.id} is still ${job.status} (phase: ${phase}). Use --status --wait to block until terminal.`);
  }
  return {
    success: job.status === "completed",
    id: job.id,
    status: job.status,
    command: job.command ?? null,
    sessionId: job.sessionId ?? null,
    threadId: job.threadId ?? null,
    turnId: job.turnId ?? null,
    agentMessages: job.agentMessages ?? job.lastAgentMessage ?? null,
    reviewText: job.reviewText ?? null,
    reasoningSummary: job.reasoningSummary ?? [],
    touchedFiles: job.touchedFiles ?? [],
    fileChanges: job.fileChanges ?? [],
    commandExecutions: job.commandExecutions ?? [],
    error: job.error ?? null,
    elapsed: formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? null),
  };
}

export async function loadJob(bucket, id) {
  const resolvedId = await resolveJobId(bucket, id);
  const job = await readJobJson(bucket, resolvedId);
  if (!job.logFile) job.logFile = jobLogPath(bucket, resolvedId);
  return job;
}

export async function waitForTerminal(bucket, id, options = {}) {
  const tickMs = Math.max(5000, Math.min(120000, (options.tickSeconds ?? 30) * 1000));
  const onTick = options.onTick;
  for (;;) {
    const job = await loadJob(bucket, id);
    if (TERMINAL_STATES.has(job.status)) return job;
    onTick?.(renderBrief(job));
    await new Promise((r) => setTimeout(r, tickMs));
  }
}
