import http from 'node:http';
import https from 'node:https';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.mjs';
import { runnerContext } from './assertions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const traceLogPath = resolve(here, '..', 'trace.log');
const ndjsonPath = env.logFile ? resolve(process.cwd(), env.logFile) : '';
if (ndjsonPath) mkdirSync(dirname(ndjsonPath), { recursive: true });

function truncate(s, max = 800) {
  if (typeof s !== 'string') return s;
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max}B)` : s;
}

function redactHeaders(h) {
  const c = { ...h };
  if (c.Cookie) c.Cookie = `<redacted ${c.Cookie.length}B>`;
  return c;
}

function writeTrace(line) {
  if (!env.verbose) return;
  console.log(line);
  try { appendFileSync(traceLogPath, line + '\n'); } catch {}
}

function appendNdjson(entry) {
  if (!ndjsonPath) return;
  try { appendFileSync(ndjsonPath, JSON.stringify(entry) + '\n'); }
  catch (err) { console.error(`[api-smoke] 写日志失败: ${err.message}`); }
}

function buildOptions(method, path, opts) {
  const cookie = opts.cookie !== undefined ? opts.cookie : env.cookie;
  const origin = `${env.protocol}://${env.host}`;
  const defFetchHeaders = {};
  if (env.modelVer) defFetchHeaders['X-Model-Ver'] = env.modelVer;
  if (env.lang) defFetchHeaders['X-Lang'] = env.lang;
  if (env.prodId) defFetchHeaders['X-Prod-Id'] = env.prodId;
  if (env.prodVer) defFetchHeaders['X-Prod-Ver'] = env.prodVer;
  if (env.spaceId) defFetchHeaders['X-Space-Id'] = env.spaceId;
  if (env.clientSn) defFetchHeaders['X-Client-Sn'] = env.clientSn;

  return {
    method,
    host: env.resolveIp || env.host,      // TCP 连 IP
    port: env.port,
    path,
    servername: env.host,                 // SNI 用域名
    rejectUnauthorized: env.tlsRejectUnauthorized,
    timeout: env.timeoutMs,
    headers: {
      Host: env.host,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Origin: origin,
      Referer: `${origin}/`,
      ...defFetchHeaders,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  };
}

function shouldRetry(resp) {
  if (!env.retry) return false;
  for (const rule of env.retryStatuses) {
    if (rule === '5xx' && resp.status >= 500) return true;
    if (/^\d+$/.test(rule) && (resp.status === Number(rule) || String(resp.data?.code) === rule)) return true;
  }
  return false;
}

async function callOnce(method, path, body, opts, attempt) {
  const isJson = body !== undefined && body !== null && typeof body !== 'string';
  const payload = body === undefined || body === null ? undefined : isJson ? JSON.stringify(body) : String(body);
  const options = buildOptions(method, path, opts);
  if (payload !== undefined) {
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
    options.headers['Content-Length'] = String(Buffer.byteLength(payload));
  }

  const started = Date.now();
  const startedIso = new Date(started).toISOString();
  const reqHeadersRedacted = redactHeaders(options.headers);
  const transport = env.protocol === 'https' ? https : http;

  writeTrace(`\n>>> ${method} ${env.protocol}://${env.host}${path}${attempt > 1 ? ` [retry ${attempt - 1}]` : ''}`);
  writeTrace(`    tcp=${options.host}:${options.port} sni=${options.servername}`);
  writeTrace(`    headers=${JSON.stringify(reqHeadersRedacted)}`);
  if (payload !== undefined) writeTrace(`    body=${truncate(payload)}`);

  return new Promise((done) => {
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = raw;
        try { data = raw ? JSON.parse(raw) : null; } catch {}
        const headers = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        const elapsedMs = Date.now() - started;
        writeTrace(`<<< ${res.statusCode} ${elapsedMs}ms`);
        writeTrace(`    resp-body=${truncate(raw)}`);

        // NDJSON 完整落盘 — body 不 truncate(保留 contract-drift 排查证据)
        appendNdjson({
          ts: startedIso,
          elapsedMs,
          suite: runnerContext.suite || '',
          test: runnerContext.test || '',
          attempt,
          method,
          url: `${env.protocol}://${env.host}${path}`,
          tcp: `${options.host}:${options.port}`,
          sni: options.servername || null,
          requestHeaders: reqHeadersRedacted,
          requestBody: payload === undefined ? null : payload,
          responseStatus: res.statusCode || 0,
          responseHeaders: headers,
          responseBody: raw,
        });

        done({ status: res.statusCode || 0, data, headers, raw, elapsedMs });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`请求超时 ${env.timeoutMs}ms`)));
    req.on('error', (err) => {
      writeTrace(`<<< ERROR ${err.message}`);
      const elapsedMs = Date.now() - started;
      appendNdjson({
        ts: startedIso, elapsedMs, suite: runnerContext.suite || '', test: runnerContext.test || '',
        attempt, method, url: `${env.protocol}://${env.host}${path}`,
        tcp: `${options.host}:${options.port}`, sni: options.servername || null,
        requestHeaders: reqHeadersRedacted,
        requestBody: payload === undefined ? null : payload,
        error: err.message,
      });
      done({ status: 0, data: null, headers: {}, raw: '', error: err, elapsedMs });
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function call(method, path, body, opts = {}) {
  let resp = await callOnce(method, path, body, opts, 1);
  if (shouldRetry(resp)) {
    await new Promise(r => setTimeout(r, 1000));
    resp = await callOnce(method, path, body, opts, 2);
  }
  return resp;
}

export const client = {
  get: (p, o) => call('GET', p, undefined, o),
  post: (p, b, o) => call('POST', p, b, o),
  put: (p, b, o) => call('PUT', p, b, o),
  patch: (p, b, o) => call('PATCH', p, b, o),
  delete: (p, o) => call('DELETE', p, undefined, o),
};
