#!/usr/bin/env node
/**
 * 把 NDJSON 日志加工成排查友好的 report.md。run-all 结束后自动跑一次。
 * 用法:
 *   node _shared/report.mjs                         # 读最新 logs/run-*.ndjson
 *   node _shared/report.mjs <ndjson-path>
 *   node _shared/report.mjs <ndjson-path> --out=<md-path>
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ── 读 NDJSON ──
const entries = readFileSync(ndjsonPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const suites = [...new Set(entries.map(e => e.suite).filter(Boolean))];

// ── 工具 ──
function urlKey(url) {
  return url.split('?')[0].replace(/^https?:\/\/[^/]+/, '')
    .replace(/\/element\/[^/]+\/download$/, '/element/:id/download')
    .replace(/\/\d{5,}/g, '/:id');
}
function parseJsonMaybe(s) { try { return JSON.parse(s); } catch { return null; } }
function isSuccess(e) { return e.responseStatus >= 200 && e.responseStatus < 300; }
function isBizOk(e) {
  const b = parseJsonMaybe(e.responseBody);
  return b?.code === undefined || b.code === 0;
}

// ── 摘要数据 ──
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
  const avg = Math.round(arr.reduce((a, e) => a + (e.elapsedMs || 0), 0) / arr.length);
  const bizNon0 = arr.filter(e => {
    const b = parseJsonMaybe(e.responseBody);
    return b?.code !== undefined && b.code !== 0;
  }).length;
  return { suite: s, tests: tests.size, reqs: arr.length, pass: succ, fail: arr.length - succ, bizNon0, avg };
});

// ── 链路关键数据(按响应形态挖 id / url) ──
const linkageRows = [];
const seen = new Set();
for (const e of entries) {
  if (!isSuccess(e) || !isBizOk(e)) continue;
  const body = parseJsonMaybe(e.responseBody);
  const data = body?.data?.data || body?.data || body;
  if (!data) continue;
  const picks = [];
  if (Array.isArray(data.list) && data.list[0]) {
    const first = data.list[0];
    picks.push(['list[0].id', first.id, first.slug]);
    if (Array.isArray(first.children) && first.children[0]?.id)
      picks.push(['list[0].children[0].id', first.children[0].id, first.children[0].slug]);
  }
  if (Array.isArray(data.element_list) && data.element_list[0]?.download_url)
    picks.push(['element_list[0].download_url', data.element_list[0].download_url, '']);
  for (const [path, val, slug] of picks) {
    const key = `${e.test}::${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    linkageRows.push({ ts: e.ts, suite: e.suite, test: e.test, url: urlKey(e.url), path, val, slug });
  }
}

// ── 按接口汇总 code ──
const codeSummary = [];
for (const [url, arr] of byUrl) {
  const s200 = arr.filter(e => e.responseStatus >= 200 && e.responseStatus < 300).length;
  const s4xx = arr.filter(e => e.responseStatus >= 400 && e.responseStatus < 500).length;
  const s5xx = arr.filter(e => e.responseStatus >= 500).length;
  const codes = new Map();
  for (const e of arr) {
    const b = parseJsonMaybe(e.responseBody);
    const key = b?.code !== undefined ? `code=${b.code}` : `status=${e.responseStatus}`;
    const msg = b?.msg || '';
    if (!codes.has(key)) codes.set(key, { n: 0, msg });
    codes.get(key).n++;
  }
  const codeStr = [...codes].map(([k, v]) => `${k} × ${v.n}${v.msg ? ` "${v.msg}"` : ''}`).join(', ');
  codeSummary.push({ url, s200, s4xx, s5xx, codeStr });
}

// ── 渲染 ──
const startTs = new Date(entries[0].ts);
const endTs = new Date(entries[entries.length - 1].ts);
const totalMs = endTs - startTs + (entries[entries.length - 1].elapsedMs || 0);
const totalReq = entries.length;
const totalPass = entries.filter(isSuccess).length;
const totalFail = totalReq - totalPass;
const bizNon0All = entries.filter(e => {
  const b = parseJsonMaybe(e.responseBody);
  return b?.code !== undefined && b.code !== 0;
}).length;
const avgAll = Math.round(entries.reduce((a, e) => a + (e.elapsedMs || 0), 0) / entries.length);

const lines = [];
const sep = '<!-- ═══════════════════════════════════════════════════════════════ -->';
lines.push(sep);
lines.push('<!--                    🔍 本次冒烟运行摘要                          -->');
lines.push(sep);
lines.push('');
lines.push(`> **⏱ 运行时间** ${startTs.toISOString().replace('T', ' ').slice(0, 19)} · **耗时** ${(totalMs / 1000).toFixed(1)}s`);
lines.push(`> **📁 日志** ${basename(ndjsonPath)} (${(statSync(ndjsonPath).size / 1024).toFixed(0)} KB · ${totalReq} 条)`);
lines.push('');
lines.push('### 🎯 一眼结果');
lines.push('');
lines.push('| 套件 | 用例 | 请求 | PASS | FAIL | 业务 code 非 0 | 平均耗时 |');
lines.push('|---|---:|---:|---:|---:|---:|---:|');
for (const s of suiteStats) {
  lines.push(`| **${s.suite}** | ${s.tests} | ${s.reqs} | ✅ ${s.pass} | ${s.fail ? `❌ ${s.fail}` : '❌ 0'} | ${s.bizNon0 || '—'} | ${s.avg}ms |`);
}
lines.push(`| **合计** | ${suiteStats.reduce((a, s) => a + s.tests, 0)} | ${totalReq} | ✅ ${totalPass} | ${totalFail ? `❌ ${totalFail}` : '❌ 0'} | ${bizNon0All || '—'} | ${avgAll}ms |`);
lines.push('');

lines.push('### 🔑 链路关键数据(下游入参溯源)');
lines.push('');
if (linkageRows.length === 0) {
  lines.push('_本次运行未提取到可溯源的链路关键数据。_');
} else {
  lines.push('| 数据 | 值 | 来源 |');
  lines.push('|---|---|---|');
  for (const r of linkageRows.slice(0, 20)) {
    const val = typeof r.val === 'string' && r.val.length > 80 ? `${r.val.slice(0, 77)}...` : String(r.val);
    lines.push(`| \`${r.path}\`${r.slug ? ` (${r.slug})` : ''} | **${val}** | \`${r.suite} / ${r.test}\` → \`${r.url}\` |`);
  }
}
lines.push('');

lines.push('### 📬 接口业务 code 汇总');
lines.push('');
lines.push('| 接口 | 200 | 4xx | 5xx | code 分布 |');
lines.push('|---|---:|---:|---:|---|');
for (const c of codeSummary) lines.push(`| \`${c.url}\` | ${c.s200} | ${c.s4xx} | ${c.s5xx} | ${c.codeStr} |`);
lines.push('');

lines.push('### ⚠️ 需要关注');
lines.push('');
const alerts = [];
if (totalFail === 0 && bizNon0All === 0) alerts.push('✅ **全部用例通过** — 无 contract-drift / script-bug / env-issue');
if (totalFail > 0) alerts.push(`❌ **${totalFail} 次请求失败**,详见下方时间轴`);
for (const e of entries) {
  const b = parseJsonMaybe(e.responseBody);
  if (b?.msg && /Service Not Found/i.test(b.msg))
    alerts.push(`🟡 \`${urlKey(e.url)}\` → **Service Not Found**(env-issue: 路由可能未部署)`);
  if (b?.msg && /invalid json/i.test(b.msg) && e.requestBody && parseJsonMaybe(e.requestBody))
    alerts.push(`🟡 \`${urlKey(e.url)}\` 合法 JSON 但后端返回 **"invalid json body"** — 错误码映射不准,建议反馈`);
}
const dedupAlerts = [...new Set(alerts)];
for (const a of dedupAlerts) lines.push(`- ${a}`);
lines.push('');

// 详细段:时间轴 / 链路依赖溯源 / 首样例
lines.push(sep);
lines.push('<!--                        详细数据(按需查阅)                      -->');
lines.push(sep);
lines.push('');
lines.push('## 时间轴');
lines.push('');
lines.push('| # | ts | 用例 | 接口 | method | status | 耗时 | 关键出入参 |');
lines.push('|---|---|---|---|---|---|---|---|');
entries.forEach((e, i) => {
  const b = parseJsonMaybe(e.responseBody);
  const rb = parseJsonMaybe(e.requestBody);
  const inDesc = [];
  const qs = e.url.split('?')[1];
  if (qs) inDesc.push(`?${qs.slice(0, 60)}`);
  if (rb) inDesc.push(`body=${JSON.stringify(rb).slice(0, 80)}`);
  const outDesc = b ? (b.code !== undefined ? `code=${b.code} msg=${b.msg || ''}`.slice(0, 80) : '2xx') : '';
  const caseLabel = e.test ? `${(e.suite || '').slice(0, 14)}<br>${e.test.slice(0, 40)}` : (e.suite || '-');
  const t = e.ts.split('T')[1]?.replace('Z', '') || '';
  lines.push(`| ${i + 1} | ${t} | ${caseLabel.replaceAll('|', '\\|')} | \`${urlKey(e.url)}\` | ${e.method} | ${e.responseStatus} | ${e.elapsedMs}ms | ${`${inDesc.join(' · ')} → ${outDesc}`.replaceAll('|', '\\|')} |`);
});
lines.push('');

// 链路依赖溯源
lines.push('## 链路依赖溯源');
lines.push('');
if (linkageRows.length === 0) {
  lines.push('_无链路依赖。_');
} else {
  for (const r of linkageRows) {
    const val = typeof r.val === 'string' && r.val.length > 60 ? `${r.val.slice(0, 57)}...` : String(r.val);
    lines.push(`- ✅ \`${r.path}\` = **${val}** 由 \`${r.suite} / ${r.test}\`(\`${r.url}\`)产出`);
  }
}
lines.push('');

// 每接口首个成功样例
lines.push('## 每接口首个成功完整样例');
lines.push('');
for (const [url, arr] of byUrl) {
  const sample = arr.find(isSuccess);
  if (!sample) continue;
  lines.push(`### \`${url}\``);
  lines.push('');
  lines.push('**请求**');
  lines.push('```json');
  lines.push(JSON.stringify({ method: sample.method, url: sample.url, headers: sample.requestHeaders, body: parseJsonMaybe(sample.requestBody) || sample.requestBody }, null, 2).slice(0, 2000));
  lines.push('```');
  lines.push('');
  lines.push('**响应**');
  lines.push('```json');
  const respPretty = JSON.stringify(parseJsonMaybe(sample.responseBody) || sample.responseBody, null, 2);
  lines.push(respPretty.length > 2000 ? `${respPretty.slice(0, 2000)}\n...(+${respPretty.length - 2000}B truncated,看完整版请查 NDJSON)` : respPretty);
  lines.push('```');
  lines.push('');
}

writeFileSync(outPath, lines.join('\n'));
console.log(`报告已写入 ${outPath}`);
