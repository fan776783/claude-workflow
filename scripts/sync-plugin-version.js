#!/usr/bin/env node
/**
 * 同步 core/.claude-plugin/plugin.json 的 version 字段。
 * 由 scripts/release.sh 在 `npm version` 之后调用，保证 Plugin manifest
 * 与 package.json 版本一致。
 *
 * 用法：node scripts/sync-plugin-version.js <new-version>
 */

'use strict';

const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
if (!newVersion) {
  console.error('usage: sync-plugin-version.js <version>');
  process.exit(1);
}

const manifestPath = path.join(__dirname, '..', 'core', '.claude-plugin', 'plugin.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`plugin manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const oldVersion = manifest.version;
manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[sync-plugin-version] plugin.json: ${oldVersion} -> ${newVersion}`);
