// 共享测试环境 helper（非测试文件：test:workflow glob 只取 *.test.mjs）。
// HOME 隔离：把 HOME/USERPROFILE 指到临时目录，防测试写真实 ~/.claude/workflows；
// cleanup() 删除临时目录并恢复原环境变量。per-file 用一次（module 顶层 + after），
// per-test 用法在 beforeEach 调用、afterEach cleanup。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function isolateHome(prefix = 'wf-test-home-') {
  const original = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  process.env.HOME = tmpHome
  process.env.USERPROFILE = tmpHome
  return {
    tmpHome,
    cleanup() {
      try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
      if (original.HOME === undefined) delete process.env.HOME
      else process.env.HOME = original.HOME
      if (original.USERPROFILE === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = original.USERPROFILE
    },
  }
}
