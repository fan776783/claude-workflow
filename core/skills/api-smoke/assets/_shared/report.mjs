#!/usr/bin/env node
/**
 * Turn NDJSON request logs into a human-readable report.md.
 * Usage:
 *   node _shared/report.mjs
 *   node _shared/report.mjs <ndjson-path>
 *   node _shared/report.mjs <ndjson-path> --out=<md-path>
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = {
  fixtureKeys: ['id', 'teamId', 'projectId', 'spaceId', 'resourceId', 'categoryId', 'fileId'],
  linkFields: ['download_url', 'preview_url', 'file_url', 'thumbnail_url', 'cover_url', 'url'],
  urlNormalizeRules: [
    { pattern: /\/[0-9]{5,}(?=\/|$)/g, replacement: '/:id' },
    { pattern: /\/[0-9a-f]{16,}(?=\/|$)/gi, replacement: '/:hash' },
  ],
  noteworthyPatterns: [
    { pattern: /Service Not Found/i, label: 'Service Not Found', hint: 'env-issue: target route may not be deployed' },
    { pattern: /invalid json/i, label: 'invalid json body', hint: 'contract-drift: error mapping may not match the request contract' },
  ],
};

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '..');

const argv = process.argv.slice(2);
const outArg = argv.find(a => a.startsWith('--out='));
const outPath = outArg ? outArg.slice(6) : resolve(dir, 'report.md');
const explicit = argv.filter(a => !a.startsWith('--'))[0];

function latestNdjson() {
  const logsDir = resolve(dir, 'logs');
  try {
    const files = readdirSync(logsDir)
      .filter(f => /^run-.*\.ndjson$/.test(f))
      .map(f => ({ f, t: statSync(resolve(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return files[0] ? resolve(logsDir, files[0].f) : null;
  } catch { return null; }
}

const ndjsonPath = explicit ? resolve(process.cwd(), explicit) : latestNdjson();
if (!ndjsonPath) { console.error('找不到 logs/run-*.ndjson'); process.exit(1); }

const rawLines = readFileSync(ndjsonPath, 'utf8').trim().split('\n').filter(Boolean);
const entries = rawLines.map(l => JSON.parse(l));
if (!entries.length) { console.error('NDJSON 为空'); process.exit(1); }

const suites = [...new Set(entries.map(e => e.suite).filter(Boolean))];

function urlKey(url) {
  let key = String(url || '').split('?')[0].replace(/^https?:\/\/[^/]+/, '');
  for (const rule of CONFIG.urlNormalizeRules) key = key.replace(rule.pattern, rule.replacement);
  return key || '/';
}

// Escape pipes so response/url-derived values cannot break Markdown table rows.
function cell(s) { return String(s ?? '').replaceAll('|', '\\|'); }

function parseJsonMaybe(s) {
  if (s == null || s === '') return null;
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
}

function isSuccess(e) { return e.responseStatus >= 200 && e.responseStatus < 300; }

function isBizOk(e) {
  const b = parseJsonMaybe(e.responseBody);
  return b?.code === undefined || b.code === 0;
}

function dataRoot(body) {
  return body?.data?.data ?? body?.data ?? body;
}

function scalar(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function walk(value, visit, path = '', depth = 0, seen = new Set()) {
  if (value == null || depth > 6) return;
  if (typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
  }
  if (Array.isArray(value)) {
    value.slice(0, 3).forEach((item, index) => walk(item, visit, `${path}[${index}]`, depth + 1, seen));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      visit(key, child, childPath);
      walk(child, visit, childPath, depth + 1, seen);
    }
  }
}

function collectLinkagePicks(body) {
  const data = dataRoot(body);
  const picks = [];
  const fixtureKeys = new Set(CONFIG.fixtureKeys);
  const linkFields = new Set(CONFIG.linkFields);
  walk(data, (key, value, path) => {
    if (!scalar(value)) return;
    if (fixtureKeys.has(key) || linkFields.has(key)) picks.push([path, value]);
  });
  return picks;
}

const byUrl = new Map();
for (const e of entries) {
  const k = urlKey(e.url);
  if (!byUrl.has(k)) byUrl.set(k, []);
  byUrl.get(k).push(e);
}

const suiteStats = suites.map(s => {
  const arr = entries.filter(e => e.suite === s);
  const tests = new Set(arr.map(e => e.test).filter(Boolean));
  const succ = arr.filter(isSuccess).length;
  const avg = Math.round(arr.reduce((a, e) => a + (e.elapsedMs || 0), 0) / Math.max(arr.length, 1));
  const bizNon0 = arr.filter(e => {
    const b = parseJsonMaybe(e.responseBody);
    return b?.code !== undefined && b.code !== 0;
  }).length;
  return { suite: s, tests: tests.size, reqs: arr.length, pass: succ, fail: arr.length - succ, bizNon0, avg };
});

if (!suiteStats.length) {
  suiteStats.push({
    suite: 'unnamed',
    tests: new Set(entries.map(e => e.test).filter(Boolean)).size,
    reqs: entries.length,
    pass: entries.filter(isSuccess).length,
    fail: entries.filter(e => !isSuccess(e)).length,
    bizNon0: entries.filter(e => {
      const b = parseJsonMaybe(e.responseBody);
      return b?.code !== undefined && b.code !== 0;
    }).length,
    avg: Math.round(entries.reduce((a, e) => a + (e.elapsedMs || 0), 0) / entries.length),
  });
}

const linkageRows = [];
const seenLinkage = new Set();
for (const e of entries) {
  if (!isSuccess(e) || !isBizOk(e)) continue;
  const body = parseJsonMaybe(e.responseBody);
  if (!body) continue;
  for (const [path, val] of collectLinkagePicks(body)) {
    const key = `${e.test}::${path}::${String(val)}`;
    if (seenLinkage.has(key)) continue;
    seenLinkage.add(key);
    linkageRows.push({ ts: e.ts, suite: e.suite, test: e.test, url: urlKey(e.url), path, val });
  }
}

const codeSummary = [];
for (const [url, arr] of byUrl) {
  const s200 = arr.filter(e => e.responseStatus >= 200 && e.responseStatus < 300).length;
  const s4xx = arr.filter(e => e.responseStatus >= 400 && e.responseStatus < 500).length;
  const s5xx = arr.filter(e => e.responseStatus >= 500).length;
  const codes = new Map();
  for (const e of arr) {
    const b = parseJsonMaybe(e.responseBody);
    const key = b?.code !== undefined ? `code=${b.code}` : `status=${e.responseStatus}`;
    const msg = b?.msg || b?.message || '';
    if (!codes.has(key)) codes.set(key, { n: 0, msg });
    codes.get(key).n += 1;
  }
  const codeStr = [...codes].map(([k, v]) => `${k} x ${v.n}${v.msg ? ` "${v.msg}"` : ''}`).join(', ');
  codeSummary.push({ url, s200, s4xx, s5xx, codeStr });
}

const startTs = new Date(entries[0].ts);
const lastEntry = entries[entries.length - 1];
const endTs = new Date(lastEntry.ts);
const totalMs = endTs - startTs + (lastEntry.elapsedMs || 0);
const totalReq = entries.length;
const totalPass = entries.filter(isSuccess).length;
const totalFail = totalReq - totalPass;
const bizNon0All = entries.filter(e => {
  const b = parseJsonMaybe(e.responseBody);
  return b?.code !== undefined && b.code !== 0;
}).length;
const avgAll = Math.round(entries.reduce((a, e) => a + (e.elapsedMs || 0), 0) / entries.length);

const lines = [];
const sep = '<!-- =============================================================== -->';
lines.push(sep);
lines.push('<!--                    API Smoke Run Summary                       -->');
lines.push(sep);
lines.push('');
lines.push(`> **Run time** ${startTs.toISOString().replace('T', ' ').slice(0, 19)} | **Duration** ${(totalMs / 1000).toFixed(1)}s`);
lines.push(`> **Log** ${basename(ndjsonPath)} (${(statSync(ndjsonPath).size / 1024).toFixed(0)} KB | ${totalReq} rows)`);
lines.push('');
lines.push('### One-Look Result');
lines.push('');
lines.push('| Suite | Tests | Requests | PASS | FAIL | Business code non-zero | Avg |');
lines.push('|---|---:|---:|---:|---:|---:|---:|');
for (const s of suiteStats) {
  lines.push(`| **${cell(s.suite)}** | ${s.tests} | ${s.reqs} | ${s.pass} | ${s.fail} | ${s.bizNon0 || '-'} | ${s.avg}ms |`);
}
lines.push(`| **Total** | ${suiteStats.reduce((a, s) => a + s.tests, 0)} | ${totalReq} | ${totalPass} | ${totalFail} | ${bizNon0All || '-'} | ${avgAll}ms |`);
lines.push('');

lines.push('### Linkage Key Data');
lines.push('');
if (linkageRows.length === 0) {
  lines.push('_No configured linkage keys found in this run._');
} else {
  lines.push('| Data | Value | Source |');
  lines.push('|---|---|---|');
  for (const r of linkageRows.slice(0, 30)) {
    const val = typeof r.val === 'string' && r.val.length > 80 ? `${r.val.slice(0, 77)}...` : String(r.val);
    lines.push(`| \`${cell(r.path)}\` | **${cell(val)}** | \`${cell(r.suite || '-')} / ${cell(r.test || '-')}\` -> \`${cell(r.url)}\` |`);
  }
}
lines.push('');

lines.push('### Endpoint Status And Code Summary');
lines.push('');
lines.push('| Endpoint | 2xx | 4xx | 5xx | Code distribution |');
lines.push('|---|---:|---:|---:|---|');
for (const c of codeSummary) lines.push(`| \`${cell(c.url)}\` | ${c.s200} | ${c.s4xx} | ${c.s5xx} | ${cell(c.codeStr)} |`);
lines.push('');

lines.push('### Attention');
lines.push('');
const alerts = [];
if (totalFail === 0 && bizNon0All === 0) alerts.push('All requests passed with no contract-drift / script-bug / env-issue.');
if (totalFail > 0) alerts.push(`${totalFail} request(s) failed; inspect the timeline below.`);
for (const e of entries) {
  const bodyText = String(e.responseBody || '');
  for (const rule of CONFIG.noteworthyPatterns) {
    if (rule.pattern.test(bodyText)) alerts.push(`\`${urlKey(e.url)}\` -> ${rule.label} (${rule.hint})`);
  }
}
for (const a of [...new Set(alerts)]) lines.push(`- ${a}`);
lines.push('');

lines.push(sep);
lines.push('<!--                           Details                             -->');
lines.push(sep);
lines.push('');
lines.push('## Timeline');
lines.push('');
lines.push('| # | ts | Case | Endpoint | method | status | elapsed | Key IO |');
lines.push('|---|---|---|---|---|---:|---:|---|');
entries.forEach((e, i) => {
  const b = parseJsonMaybe(e.responseBody);
  const rb = parseJsonMaybe(e.requestBody);
  const inDesc = [];
  const qs = String(e.url || '').split('?')[1];
  if (qs) inDesc.push(`?${qs.slice(0, 60)}`);
  if (rb) inDesc.push(`body=${JSON.stringify(rb).slice(0, 80)}`);
  const outDesc = b ? (b.code !== undefined ? `code=${b.code} msg=${b.msg || b.message || ''}`.slice(0, 80) : '2xx') : (e.error || '');
  const caseLabel = e.test ? `${(e.suite || '').slice(0, 14)}<br>${e.test.slice(0, 40)}` : (e.suite || '-');
  const t = String(e.ts || '').split('T')[1]?.replace('Z', '') || '';
  lines.push(`| ${i + 1} | ${t} | ${cell(caseLabel)} | \`${cell(urlKey(e.url))}\` | ${e.method || ''} | ${e.responseStatus ?? 0} | ${e.elapsedMs || 0}ms | ${cell(`${inDesc.join(' | ')} -> ${outDesc}`)} |`);
});
lines.push('');

lines.push('## Linkage Trace');
lines.push('');
if (linkageRows.length === 0) {
  lines.push('_No linkage trace extracted._');
} else {
  for (const r of linkageRows) {
    const val = typeof r.val === 'string' && r.val.length > 60 ? `${r.val.slice(0, 57)}...` : String(r.val);
    lines.push(`- \`${r.path}\` = **${String(val).replaceAll('|', '\\|')}** from \`${r.suite || '-'} / ${r.test || '-'}\` (\`${r.url}\`)`);
  }
}
lines.push('');

lines.push('## First Successful Sample Per Endpoint');
lines.push('');
for (const [url, arr] of byUrl) {
  const sample = arr.find(isSuccess);
  if (!sample) continue;
  lines.push(`### \`${url}\``);
  lines.push('');
  lines.push('**Request**');
  lines.push('```json');
  lines.push(JSON.stringify({
    method: sample.method,
    url: sample.url,
    headers: sample.requestHeaders,
    body: parseJsonMaybe(sample.requestBody) || sample.requestBody,
  }, null, 2).slice(0, 2000));
  lines.push('```');
  lines.push('');
  lines.push('**Response**');
  lines.push('```json');
  const respPretty = JSON.stringify(parseJsonMaybe(sample.responseBody) || sample.responseBody, null, 2);
  lines.push(respPretty.length > 2000 ? `${respPretty.slice(0, 2000)}\n...(+${respPretty.length - 2000}B truncated; inspect NDJSON for full body)` : respPretty);
  lines.push('```');
  lines.push('');
}

writeFileSync(outPath, lines.join('\n'));
console.log(`报告已写入 ${outPath}`);
