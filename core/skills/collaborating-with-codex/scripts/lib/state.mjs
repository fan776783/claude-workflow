// SPDX-License-Identifier: MIT
// Portions adapted from codex-plugin-cc (Apache-2.0). See ../../NOTICE.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const STATE_ROOT = path.join(os.homedir(), ".claude", "tmp", "codex-jobs");

export const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

function slugify(basename) {
  const slug = String(basename || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

function canonicalize(cwd) {
  try {
    return fs.realpathSync.native(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

export function resolveBucketDir(cwd) {
  const target = canonicalize(cwd);
  const slug = slugify(path.basename(target));
  const hash = createHash("sha256").update(target).digest("hex").slice(0, 8);
  return path.join(STATE_ROOT, `${slug}-${hash}`);
}

export async function ensureBucketDir(bucket) {
  await fsp.mkdir(bucket, { recursive: true });
}

export function jobJsonPath(bucket, jobId) {
  return path.join(bucket, `${jobId}.json`);
}

export function jobLogPath(bucket, jobId) {
  return path.join(bucket, `${jobId}.log`);
}

export async function readJobJson(bucket, jobId) {
  const raw = await fsp.readFile(jobJsonPath(bucket, jobId), "utf8");
  return JSON.parse(raw);
}

export function readJobJsonSync(bucket, jobId) {
  return JSON.parse(fs.readFileSync(jobJsonPath(bucket, jobId), "utf8"));
}

export async function writeJobJson(bucket, jobId, data) {
  await ensureBucketDir(bucket);
  await fsp.writeFile(jobJsonPath(bucket, jobId), JSON.stringify(data, null, 2));
}

export async function patchJobJson(bucket, jobId, patch) {
  let existing = {};
  try {
    existing = await readJobJson(bucket, jobId);
  } catch {}
  if (TERMINAL_STATES.has(existing.status)) return existing;
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await writeJobJson(bucket, jobId, next);
  return next;
}

export async function listJobIds(bucket) {
  try {
    const entries = await fsp.readdir(bucket);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export function generateJobId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `job-${ts}-${rand}`;
}

export function getStateRoot() {
  return STATE_ROOT;
}
