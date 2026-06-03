import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// P2.2：getTaskBlock 对 v2 task-dir 记录返回 task.md 渲染正文（含 rich 字段），
// 不再退化为 renderTaskBlockFromRecord 的薄 metadata —— 这是 implementer 拿到护栏的关键。
const PID = 'taskblockv2'
let tmpHome
let taskStore
let taskRuntime

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-taskblock-'))
  process.env.HOME = tmpHome
  process.env.USERPROFILE = tmpHome
  for (const m of ['../task_store.js', '../path_utils.js', '../task_md_render.js', '../task_runtime.js']) {
    delete require.cache[require.resolve(m)]
  }
  taskStore = require('../task_store.js')
  taskRuntime = require('../task_runtime.js')
})

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
})

test('getTaskBlock: v2 记录 → 渲染 rich 切片（task_text/constraints/patterns），不退化为薄 metadata', () => {
  const runtime = {
    projectId: PID,
    currentTaskId: 'T1',
    currentTask: {
      id: 'T1', name: '登录', schema_version: 2,
      task_text: '实现登录校验。',
      constraints: ['C-1 token 边界'],
      patterns: [{ file: 'src/login.ts', note: '镜像' }],
    },
    tasksContent: '',
  }
  const block = taskRuntime.getTaskBlock(runtime)
  assert.match(block, /实现登录校验。/)
  assert.match(block, /## 关键约束[\s\S]*C-1 token 边界/)
  assert.match(block, /## Patterns to Mirror[\s\S]*src\/login\.ts/)
})

test('getTaskBlock: v2 优先读已落盘 task.md', () => {
  taskStore.createTask(PID, { id: 'T1', task_text: 'x' }) // createTask 盖章 schema_version=2
  taskStore.writeTaskMd(PID, 'T1', '# T1 自定义 task.md 正文')
  const runtime = { projectId: PID, currentTaskId: 'T1', currentTask: taskStore.readTask(PID, 'T1'), tasksContent: '' }
  const block = taskRuntime.getTaskBlock(runtime)
  assert.match(block, /自定义 task\.md 正文/)
})

test('getTaskBlock: replaceAllTasks 后不使用旧 task.md', () => {
  taskStore.createTask(PID, { id: 'T1', name: 'old', task_text: 'OLD body' })
  taskStore.writeTaskMd(PID, 'T1', '# T1: old\nOLD body\n')
  taskStore.replaceAllTasks(PID, [{ id: 'T1', name: 'new', task_text: 'NEW body' }])
  const runtime = { projectId: PID, currentTaskId: 'T1', currentTask: taskStore.readTask(PID, 'T1'), tasksContent: '' }
  const block = taskRuntime.getTaskBlock(runtime)
  assert.match(block, /^# T1: new/)
  assert.match(block, /NEW body/)
  assert.doesNotMatch(block, /OLD body/)
})

test('getTaskBlock: legacy（无 schema_version）→ plan.md 叙述 block 优先', () => {
  const runtime = {
    projectId: PID,
    currentTaskId: 'T1',
    currentTask: { id: 'T1' }, // v1（无 schema_version）
    tasksContent: '## T1: legacy 块\n- **Package**: p\n',
  }
  const block = taskRuntime.getTaskBlock(runtime)
  assert.match(block, /legacy 块/)
})
