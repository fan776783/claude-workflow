#!/usr/bin/env node
/**
 * 顺序跑所有 NN-*.smoke.mjs。子进程隔离,跨进程 fixture 走 .smoke-fixture.json。
 * 自动设置 SMOKE_LOG_FILE = logs/run-<ts>.ndjson,结束后调用 _shared/report.mjs 产出 report.md。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearFixture } from './_shared/fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(here, 'logs'), { recursive: true });

const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const runLog = resolve(here, 'logs', `run-${stamp}.ndjson`);
process.env.SMOKE_RUN_ID = `${stamp}_${Math.random().toString(36).slice(2, 8)}`;
process.env.SMOKE_LOG_FILE = runLog;
if (!process.env.SMOKE_VERBOSE) process.env.SMOKE_VERBOSE = '1';

clearFixture();
console.log(`本次运行日志: ${runLog}`);

const files = readdirSync(here).filter(f => /^\d{2}-.*\.smoke\.mjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  console.log(`\n── ${f} ──`);
  const r = spawnSync('node', [resolve(here, f)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log(`\n✓ ${files.length - failed} / ${files.length} passed`);

// 生成人类可读报告
const reportScript = resolve(here, '_shared', 'report.mjs');
const reportOut = resolve(here, 'report.md');
const reportResult = spawnSync('node', [reportScript, runLog, `--out=${reportOut}`], { stdio: 'inherit' });
if (reportResult.status === 0) console.log(`📊 链路报告: ${reportOut}`);
else console.warn(`生成报告失败,可手动跑: node ${reportScript} ${runLog}`);

process.exit(failed ? 1 : 0);
