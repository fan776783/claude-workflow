import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// task_store 解析路径走 path_utils.getWorkflowsDir(pid) = os.homedir()/.claude/workflows/{pid}。
// 用临时 HOME fixture override，避免污染真实 ~/.claude。须在 require task_store 前设置 HOME，
// 但 os.homedir 在 Linux/macOS 读 HOME 环境变量动态求值 → 每次调用都重新读，故运行期 override 即可。
let tmpHome
let taskStore
const PID = 'testpid01'

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-taskstore-'))
  process.env.HOME = tmpHome
  process.env.USERPROFILE = tmpHome
  // 清缓存确保 path_utils / task_store 在新 HOME 下重新求值（os.homedir 本身动态，但保险）。
  delete require.cache[require.resolve('../task_store.js')]
  delete require.cache[require.resolve('../path_utils.js')]
  taskStore = require('../task_store.js')
})

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
})

test('createTask + readTask: round-trip 字段集对齐 §5.2', () => {
  const written = taskStore.createTask(PID, {
    id: 'T1',
    phase: 'implement',
    package: 'claude-workflow',
    target_layer: 'backend',
    depends: ['T0'],
    status: 'pending',
    acceptance: ['AC-8'],
    interaction: 'AFK',
  })
  assert.equal(written.id, 'T1')
  const read = taskStore.readTask(PID, 'T1')
  assert.deepEqual(read, {
    schema_version: 2,
    id: 'T1',
    name: '',
    phase: 'implement',
    package: 'claude-workflow',
    target_layer: 'backend',
    depends: ['T0'],
    blocked_by: [],
    status: 'pending',
    acceptance: ['AC-8'],
    verification: null,
    interaction: 'AFK',
    files: [],
    constraints: [],
    patterns: [],
    mandatory_reading: [],
    task_text: '',
  })
})

test('createTask + readTask: 保留 name / verification / blocked_by 现写字段', () => {
  taskStore.createTask(PID, {
    id: 'T2',
    name: '实现登录',
    phase: 'implement',
    package: 'claude-workflow',
    depends: [],
    blocked_by: ['api_spec'],
    status: 'pending',
    acceptance: ['AC-1'],
    verification: { commands: ['npm test -- login'], expected_output: ['PASS'], notes: [] },
    interaction: 'HITL',
  })
  const read = taskStore.readTask(PID, 'T2')
  assert.equal(read.name, '实现登录')
  assert.deepEqual(read.blocked_by, ['api_spec'])
  assert.deepEqual(read.verification, { commands: ['npm test -- login'], expected_output: ['PASS'], notes: [] })
  assert.equal(read.interaction, 'HITL')
})

test('schema_version: 写侧盖章 2；normalizeTaskRecord 忠实回缺省 1（v1 探测）', () => {
  taskStore.createTask(PID, { id: 'T1' })
  assert.equal(taskStore.readTask(PID, 'T1').schema_version, 2, '写侧 createTask 盖章 v2')
  assert.equal(taskStore.normalizeTaskRecord({ id: 'T9' }).schema_version, 1, '读侧缺省忠实回 1')
  taskStore.createTask(PID, { id: 'T2', schema_version: 1 })
  assert.equal(taskStore.readTask(PID, 'T2').schema_version, 2, '显式 v1 也被写侧盖章覆盖为 v2')
  taskStore.replaceAllTasks(PID, [{ id: 'T3', schema_version: 1 }])
  assert.equal(taskStore.readTask(PID, 'T3').schema_version, 2, '整集写入同样强制盖章 v2')
})

test('normalize/read/update: unknown 字段透传保留', () => {
  const normalized = taskStore.normalizeTaskRecord({
    id: 'T9',
    planner_metadata: { owner: 'workflow-plan', score: 0.91 },
  })
  assert.deepEqual(normalized.planner_metadata, { owner: 'workflow-plan', score: 0.91 })

  taskStore.createTask(PID, {
    id: 'T1',
    planner_metadata: { owner: 'workflow-plan', score: 0.91 },
    delta_trace_id: 'CHG-001',
  })
  assert.deepEqual(taskStore.readTask(PID, 'T1').planner_metadata, { owner: 'workflow-plan', score: 0.91 })
  assert.equal(taskStore.readTask(PID, 'T1').delta_trace_id, 'CHG-001')

  taskStore.updateTaskStatus(PID, 'T1', 'completed')
  const updated = taskStore.readTask(PID, 'T1')
  assert.deepEqual(updated.planner_metadata, { owner: 'workflow-plan', score: 0.91 })
  assert.equal(updated.delta_trace_id, 'CHG-001')
})

test('createTask + readTask: v2 rich 字段 round-trip + 归一化', () => {
  taskStore.createTask(PID, {
    id: 'T1',
    files: ['src/auth.ts', 'src/types.ts'],
    constraints: ['C-1: 保持 token 过期边界', ''],
    patterns: [{ file: 'src/login.ts', line: '42', note: '镜像错误处理' }, { note: '无 file 丢弃' }],
    mandatory_reading: [{ path: 'docs/auth.md', reason: '契约', symbols: ['verify', ' '], line_hint: '10-20' }, { reason: '无 path 丢弃' }],
    task_text: '实现登录校验。\n步骤：...',
  })
  const read = taskStore.readTask(PID, 'T1')
  assert.deepEqual(read.files, ['src/auth.ts', 'src/types.ts'])
  assert.deepEqual(read.constraints, ['C-1: 保持 token 过期边界'])
  assert.deepEqual(read.patterns, [{ file: 'src/login.ts', note: '镜像错误处理', line: '42' }])
  assert.deepEqual(read.mandatory_reading, [{ path: 'docs/auth.md', reason: '契约', symbols: ['verify'], line_hint: '10-20' }])
  assert.equal(read.task_text, '实现登录校验。\n步骤：...')
})

test('task.md 读写: round-trip + 缺失返回空串 + 非法 id 抛错', () => {
  taskStore.createTask(PID, { id: 'T1' })
  assert.equal(taskStore.readTaskMd(PID, 'T1'), '', '未写时返回空串')
  taskStore.writeTaskMd(PID, 'T1', '# T1\n实现登录。')
  assert.equal(taskStore.readTaskMd(PID, 'T1'), '# T1\n实现登录。')
  assert.throws(() => taskStore.writeTaskMd(PID, '../evil', 'x'), /invalid task id/)
})

test('replaceAllTasks: 存活 id 不保留旧 task.md（避免旧渲染覆盖新 task.json）', () => {
  taskStore.createTask(PID, { id: 'T1' })
  taskStore.writeTaskMd(PID, 'T1', 'T1 正文')
  taskStore.replaceAllTasks(PID, [{ id: 'T1', package: 'p' }, { id: 'T2' }])
  assert.equal(taskStore.readTaskMd(PID, 'T1'), '', '整集替换后旧 task.md 应丢弃，由 task-write 按新 task.json 重渲染')
})

test('getTaskDirExecutionIssue: v2 metadata 壳不可执行，含 task_text 才可执行', () => {
  taskStore.createTask(PID, { id: 'T1' })
  assert.deepEqual(taskStore.getTaskDirExecutionIssue(PID), {
    code: 'task_dir_not_executable',
    task_ids: ['T1'],
    message: '检测到 v2 task-dir 仍是 metadata 壳（缺 task_text）：T1。请先通过 /workflow-plan 用 task-write 写入最终 task-dir，再执行。',
  })
  taskStore.replaceAllTasks(PID, [{ id: 'T1', task_text: '执行正文' }])
  assert.equal(taskStore.getTaskDirExecutionIssue(PID), null)
})

test('createTask: 非法 taskId 抛错', () => {
  assert.throws(() => taskStore.createTask(PID, { id: '../evil' }), /invalid task id/)
  assert.throws(() => taskStore.createTask(PID, { id: 'foo' }), /invalid task id/)
})

test('createTask: 归一化 target_layer / interaction 非法值', () => {
  const rec = taskStore.createTask(PID, { id: 'T2', target_layer: 'WAT', interaction: 'nope' })
  assert.equal(rec.target_layer, '')
  assert.equal(rec.interaction, 'AFK')
})

test('readTask: 缺失返回 null', () => {
  assert.equal(taskStore.readTask(PID, 'T99'), null)
})

test('listTasks: 空目录返回 []', () => {
  assert.deepEqual(taskStore.listTasks(PID), [])
})

test('listTasks: 按 taskId 数字序稳定排序（C-1 resume 确定性）', () => {
  taskStore.createTask(PID, { id: 'T10' })
  taskStore.createTask(PID, { id: 'T2' })
  taskStore.createTask(PID, { id: 'T1' })
  const ids = taskStore.listTasks(PID).map((t) => t.id)
  assert.deepEqual(ids, ['T1', 'T2', 'T10'])
})

test('updateTaskStatus: 改 status 保留其余字段', () => {
  taskStore.createTask(PID, { id: 'T1', package: 'pkg-a', acceptance: ['AC-1'] })
  const updated = taskStore.updateTaskStatus(PID, 'T1', 'completed')
  assert.equal(updated.status, 'completed')
  assert.equal(updated.package, 'pkg-a')
  assert.deepEqual(updated.acceptance, ['AC-1'])
  assert.equal(taskStore.readTask(PID, 'T1').status, 'completed')
})

test('updateTaskStatus: task 不存在抛错', () => {
  assert.throws(() => taskStore.updateTaskStatus(PID, 'T99', 'completed'), /task not found/)
})

test('replaceAllTasks: 整体替换 + 移除孤儿壳 (F-03)', () => {
  taskStore.createTask(PID, { id: 'T1', status: 'pending' })
  taskStore.createTask(PID, { id: 'T2', status: 'pending' })
  taskStore.createTask(PID, { id: 'T3', status: 'pending' })
  // 用更少的壳替换 → T3 孤儿被移除，且按数字序返回
  const written = taskStore.replaceAllTasks(PID, [
    { id: 'T1', status: 'pending', package: 'pkg-x' },
    { id: 'T2', status: 'pending' },
  ])
  assert.deepEqual(written, ['T1', 'T2'])
  assert.deepEqual(taskStore.listTasks(PID).map((t) => t.id), ['T1', 'T2'])
  assert.equal(taskStore.readTask(PID, 'T3'), null, '孤儿壳 T3 应被移除')
  assert.equal(taskStore.readTask(PID, 'T1').package, 'pkg-x')
})

test('replaceAllTasks: 中途非法 id 抛错且保留既有 task-dir (F-03 crash-safe)', () => {
  taskStore.createTask(PID, { id: 'T1', status: 'pending', package: 'orig' })
  taskStore.createTask(PID, { id: 'T2', status: 'pending' })
  assert.throws(() => taskStore.replaceAllTasks(PID, [
    { id: 'T1', status: 'pending' },
    { id: 'BAD', status: 'pending' }, // 非法 taskId → 临时目录阶段抛错，绝不在替代就绪前删旧源
  ]), /invalid task id/)
  // 旧 task-dir 完好：替换失败发生在临时目录，未触碰 tasks/
  assert.deepEqual(taskStore.listTasks(PID).map((t) => t.id), ['T1', 'T2'])
  assert.equal(taskStore.readTask(PID, 'T1').package, 'orig')
})

test('curateContext: 写 context.jsonl + readContext round-trip', () => {
  taskStore.createTask(PID, { id: 'T1' })
  const count = taskStore.curateContext(PID, 'T1', [
    { file: 'docs/spec.md', reason: 'requirement' },
    { file: 'docs/research.txt', reason: 'background' },
  ])
  assert.equal(count, 2)
  const jsonlPath = taskStore.getContextJsonlPath(PID, 'T1')
  const raw = fs.readFileSync(jsonlPath, 'utf8')
  // 每行一个合法 JSON 对象
  const lines = raw.trim().split('\n')
  assert.equal(lines.length, 2)
  assert.deepEqual(JSON.parse(lines[0]), { file: 'docs/spec.md', reason: 'requirement' })
  const back = taskStore.readContext(PID, 'T1')
  assert.deepEqual(back, [
    { file: 'docs/spec.md', reason: 'requirement' },
    { file: 'docs/research.txt', reason: 'background' },
  ])
})

test('curateContext: 禁 code 路径（启发式按扩展名丢弃）', () => {
  taskStore.createTask(PID, { id: 'T1' })
  const count = taskStore.curateContext(PID, 'T1', [
    { file: 'docs/spec.md', reason: 'spec' },
    { file: 'src/foo.ts', reason: 'code — 应被丢弃' },
    { file: 'lib/bar.js', reason: 'code — 应被丢弃' },
  ])
  assert.equal(count, 1)
  assert.deepEqual(taskStore.readContext(PID, 'T1'), [{ file: 'docs/spec.md', reason: 'spec' }])
})

test('readContext: 缺失返回 []', () => {
  assert.deepEqual(taskStore.readContext(PID, 'T1'), [])
})
