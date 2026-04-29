#!/usr/bin/env node
/**
 * 调一次接口把完整响应落到 dump/<endpoint>-<ts>.json。
 * 用法:
 *   node _shared/dump.mjs POST /api/xxx '{"id":"1"}'
 *   node _shared/dump.mjs GET /api/xxx
 */
import { client } from './client.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dumpDir = resolve(here, '..', 'dump');
mkdirSync(dumpDir, { recursive: true });

const [, , method = 'GET', path = '/', bodyStr = ''] = process.argv;
const body = bodyStr ? JSON.parse(bodyStr) : undefined;
const r = method.toUpperCase() === 'GET'
  ? await client.get(path)
  : await client[method.toLowerCase()](path, body);

const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const slug = path.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const out = resolve(dumpDir, `${slug}-${stamp}.json`);
writeFileSync(out, JSON.stringify({ request: { method, path, body }, response: r }, null, 2));
console.log(`dump → ${out}`);
console.log(`status=${r.status} elapsed=${r.elapsedMs}ms bodyBytes=${r.raw?.length || 0}`);
