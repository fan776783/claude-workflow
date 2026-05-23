/** @file UTF-8 stdio helper —— Windows 上强制 stdin/stdout/stderr 为 UTF-8，规避 cp936/cp1252 codepage 把中文 task 名 / spec 片段炸成 UnicodeError */

'use strict'

function ensureUtf8Stdio() {
  if (process.platform !== 'win32') return
  try { process.stdout.setDefaultEncoding('utf8') } catch {}
  try { process.stderr.setDefaultEncoding('utf8') } catch {}
  try { process.stdin.setEncoding('utf8') } catch {}
}

ensureUtf8Stdio()

module.exports = { ensureUtf8Stdio }
