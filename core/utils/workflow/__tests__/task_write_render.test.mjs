import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// P2.1 集成：cmdTaskWrite 写 task.json v2 后自动从 task.json 渲染 task.md（planner 不手写 task.md）。
const PID = 'twrender01'
let tmpHome
let taskStore
let cli

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-twrender-'))
  process.env.HOME = tmpHome
  process.env.USERPROFILE = tmpHome
  for (const m of ['../path_utils.js', '../task_store.js', '../task_md_render.js', '../workflow_cli.js']) {
    delete require.cache[require.resolve(m)]
  }
  taskStore = require('../task_store.js')
  cli = require('../workflow_cli.js')
})

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
})

test('cmdTaskWrite: 写 task.json v2 + 自动渲染 task.md', () => {
  const jsonPath = path.join(tmpHome, 'tasks.json')
  fs.writeFileSync(jsonPath, JSON.stringify([{
    id: 'T1',
    name: '登录',
    task_text: '实现登录校验。',
    constraints: ['C-1 token 边界'],
    patterns: [{ file: 'src/login.ts', line: '42', note: '镜像错误' }],
    files: ['src/auth.ts'],
    acceptance: ['成功登录'],
  }]))

  const result = cli.cmdTaskWrite(jsonPath, PID, tmpHome)
  assert.equal(result.written, true)
  assert.deepEqual(result.task_ids, ['T1'])

  // task.json 落 v2 + rich 字段
  const rec = taskStore.readTask(PID, 'T1')
  assert.equal(rec.schema_version, 2)
  assert.deepEqual(rec.constraints, ['C-1 token 边界'])
  assert.deepEqual(rec.files, ['src/auth.ts'])

  // task.md 自动渲染（execute 逐字注入正文）
  const md = taskStore.readTaskMd(PID, 'T1')
  assert.match(md, /^# T1: 登录/)
  assert.match(md, /实现登录校验。/)
  assert.match(md, /## 关键约束\n- C-1 token 边界/)
  assert.match(md, /## Patterns to Mirror\n- `src\/login\.ts`:42 — 镜像错误/)
  assert.match(md, /## 写作用域\n- `src\/auth\.ts`/)
})
