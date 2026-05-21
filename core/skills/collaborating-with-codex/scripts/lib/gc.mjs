// SPDX-License-Identifier: MIT
// Portions adapted from codex-plugin-cc (Apache-2.0). See ../../NOTICE.

import fs from "node:fs/promises";
import path from "node:path";
import { TERMINAL_STATES, jobJsonPath, jobLogPath, listJobIds, readJobJson } from "./state.mjs";

export const DEFAULT_COUNT_CAP = 20;
export const DEFAULT_AGE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

async function fileMtime(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

async function loadTerminalCandidates(bucket) {
  const ids = await listJobIds(bucket);
  const candidates = [];
  for (const id of ids) {
    let job;
    try {
      job = await readJobJson(bucket, id);
    } catch {
      continue;
    }
    if (!TERMINAL_STATES.has(job.status)) continue;
    const mtime = await fileMtime(jobJsonPath(bucket, id));
    candidates.push({ id, status: job.status, mtime });
  }
  return candidates;
}

export async function pruneBucket(bucket, options = {}) {
  const countCap = options.countCap ?? DEFAULT_COUNT_CAP;
  const ageMs = (options.ageDays ?? DEFAULT_AGE_DAYS) * MS_PER_DAY;
  const now = options.now ?? Date.now();

  let candidates;
  try {
    candidates = await loadTerminalCandidates(bucket);
  } catch (err) {
    if (err.code === "ENOENT") return { removed: [] };
    throw err;
  }

  candidates.sort((a, b) => b.mtime - a.mtime);

  const toDelete = new Set();
  candidates.forEach((c, idx) => {
    if (idx >= countCap) toDelete.add(c.id);
    if (now - c.mtime > ageMs) toDelete.add(c.id);
  });

  const removed = [];
  for (const id of toDelete) {
    const okJson = await safeUnlink(jobJsonPath(bucket, id));
    const okLog = await safeUnlink(jobLogPath(bucket, id));
    if (okJson || okLog) removed.push(id);
  }
  return { removed };
}
