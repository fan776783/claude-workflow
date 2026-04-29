import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '..', '.smoke-fixture.json');
const TTL_MS = 60 * 60 * 1000;

export function loadFixture() {
  if (!existsSync(fixturePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const created = raw.createdAt ? new Date(raw.createdAt).getTime() : 0;
    if (Date.now() - created > (raw.ttlMs || TTL_MS)) return {};
    return raw.data || {};
  } catch { return {}; }
}

export function saveFixture(patch) {
  const current = loadFixture();
  const runId = process.env.SMOKE_RUN_ID || `${new Date().toISOString()}_${Math.random().toString(36).slice(2, 8)}`;
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, JSON.stringify({
    runId,
    createdAt: new Date().toISOString(),
    ttlMs: TTL_MS,
    data: { ...current, ...patch },
  }, null, 2));
}

export function clearFixture() {
  if (existsSync(fixturePath)) unlinkSync(fixturePath);
}
