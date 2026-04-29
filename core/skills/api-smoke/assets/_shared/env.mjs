import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 路径自定位:不依赖 process.cwd()(用户从子目录跑也能找到 .env.smoke)
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env.smoke');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function req(name) {
  const v = process.env[name];
  if (!v) { console.error(`[api-smoke] ${name} 未设置,请填 .env.smoke`); process.exit(2); }
  return v;
}

export function extractCookieValue(cookieStr, name) {
  for (const part of (cookieStr || '').split(';')) {
    const item = part.trim();
    const idx = item.indexOf('=');
    if (idx > 0 && item.slice(0, idx).trim() === name) return item.slice(idx + 1).trim();
  }
  return '';
}

const protocol = (process.env.SMOKE_PROTOCOL || 'https').toLowerCase();
const host = req('SMOKE_HOST');
const cookie = req('SMOKE_COOKIE');

export const env = {
  protocol,
  host,
  port: Number(process.env.SMOKE_PORT || (protocol === 'https' ? 443 : 80)),
  resolveIp: process.env.SMOKE_RESOLVE_IP || '',
  cookie,
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS || 15000),
  tlsRejectUnauthorized: process.env.SMOKE_TLS_REJECT_UNAUTHORIZED !== '0',
  verbose: process.env.SMOKE_VERBOSE === '1',
  logFile: process.env.SMOKE_LOG_FILE || '',
  retry: process.env.SMOKE_RETRY === '1',
  retryStatuses: (process.env.SMOKE_RETRY_STATUSES || '5xx').split(',').map(s => s.trim()).filter(Boolean),

  // 拦截器 header — 按 SKILL.md Step 3 探测规则填 / 按项目调整
  prodId: process.env.SMOKE_PROD_ID || '',
  prodVer: process.env.SMOKE_PROD_VER || '',
  modelVer: process.env.SMOKE_MODEL_VER || '',
  lang: process.env.SMOKE_LANG || 'zh-cn',
  clientSn: process.env.SMOKE_CLIENT_SN || extractCookieValue(cookie, 'driveweb_identity'),
  spaceId: process.env.SMOKE_SPACE_ID || '0',
};
