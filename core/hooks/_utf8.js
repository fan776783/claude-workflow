/** @file UTF-8 stdio helper —— side-effect-only require. Windows 上强制 stdin/stdout/stderr 为 UTF-8，规避 cp936/cp1252 codepage 把中文 task 名 / spec 片段炸成 UnicodeError。所有 hook 入口顶部 `require('./_utf8')` 即生效，不需调函数。 */

'use strict'

if (process.platform === 'win32') {
  try { process.stdout.setDefaultEncoding('utf8') } catch {}
  try { process.stderr.setDefaultEncoding('utf8') } catch {}
  try { process.stdin.setEncoding('utf8') } catch {}
}
