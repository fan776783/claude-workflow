import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 路径自定位:不依赖 process.cwd()(用户从子目录跑也能找到 .env.smoke)
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env.smoke');

function stripInlineComment(raw) {
  let quote = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if ((ch === '"' || ch === "'") && raw[i - 1] !== '\\') {
      quote = quote === ch ? '' : quote || ch;
      continue;
    }
    if (ch === '#' && !quote) return raw.slice(0, i);
  }
  return raw;
}

function parseEnvValue(raw) {
  const trimmed = stripInlineComment(raw).trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = parseEnvValue(m[2]);
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

function headerNameFromEnvKey(key) {
  return key
    .slice('SMOKE_HEADER_'.length)
    .split('_')
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join('-');
}

function parseExtraHeaders(cookie) {
  const extraHeaders = {};
  const sensitiveHeaders = [];
  for (const key of Object.keys(process.env).filter(k => k.startsWith('SMOKE_HEADER_')).sort()) {
    const header = headerNameFromEnvKey(key);
    const lower = header.toLowerCase();
    if (lower === 'host' || lower === 'cookie') {
      console.warn(`[api-smoke] ${key} 被忽略: Host 由 SMOKE_HOST 控制,Cookie 由 SMOKE_COOKIE 控制`);
      continue;
    }

    const raw = process.env[key] || '';
    if (raw === '') continue;
    if (raw.startsWith('@cookie:')) {
      const cookieKey = raw.slice('@cookie:'.length).trim();
      extraHeaders[header] = extractCookieValue(cookie, cookieKey);
      sensitiveHeaders.push(header);
      continue;
    }
    if (raw.startsWith('@secret:')) {
      extraHeaders[header] = raw.slice('@secret:'.length);
      sensitiveHeaders.push(header);
      continue;
    }
    extraHeaders[header] = raw;
  }
  return { extraHeaders, sensitiveHeaders };
}

const protocol = (process.env.SMOKE_PROTOCOL || 'https').toLowerCase();
const host = req('SMOKE_HOST');
const cookie = req('SMOKE_COOKIE');
const { extraHeaders, sensitiveHeaders } = parseExtraHeaders(cookie);

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
  extraHeaders,
  sensitiveHeaders,
};
