const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const hooksDir = path.join(repoRoot, 'core', 'hooks')

const { cmdTaskWrite, cmdContextCurate } = require(path.join(workflowDir, 'workflow_cli.js'))
const taskStore = require(path.join(workflowDir, 'task_store.js'))
const { lintTaskSchema, taskSourceEmptyIssue } = require(path.join(workflowDir, 'plan_composer.js'))
const { evaluate, isCjsIntoWorkflows } = require(path.join(hooksDir, 'guard-engine-source.js'))

function freshPid() {
  return `twg${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
}
function cleanup(pid) {
  try {
    const root = path.join(os.homedir(), '.claude', 'workflows', pid)
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true })
  } catch {}
}
function writeTmp(name, content) {
  const p = path.join(os.tmpdir(), `${name}-${Math.random().toString(36).slice(2, 8)}`)
  fs.writeFileSync(p, content)
  return p
}

test('task-write 整集写 + 全字段保真', () => {
  const pid = freshPid()
  try {
    const file = writeTmp('tw.json', JSON.stringify([
      { id: 'T1', name: 'a', package: 'pkg', target_layer: 'frontend', acceptance: ['x'], verification: { commands: ['lint'] } },
      { id: 'T2', name: 'b', depends: ['T1'], blocked_by: ['backend:y'], status: 'blocked' },
    ]))
    const r = cmdTaskWrite(file, pid, null)
    assert.equal(r.written, true)
    assert.deepEqual(r.task_ids, ['T1', 'T2'])
    const t2 = taskStore.readTask(pid, 'T2')
    assert.deepEqual(t2.depends, ['T1'])
    assert.deepEqual(t2.blocked_by, ['backend:y'])
    assert.equal(t2.status, 'blocked')
  } finally {
    cleanup(pid)
  }
})

test('task-write 孤儿清理：重写更小集合移除旧 task', () => {
  const pid = freshPid()
  try {
    cmdTaskWrite(writeTmp('a.json', JSON.stringify([{ id: 'T1', name: 'a' }, { id: 'T2', name: 'b' }, { id: 'T3', name: 'c' }])), pid, null)
    cmdTaskWrite(writeTmp('b.json', JSON.stringify([{ id: 'T1', name: 'only' }])), pid, null)
    assert.deepEqual(taskStore.listTasks(pid).map((t) => t.id), ['T1'])
  } finally {
    cleanup(pid)
  }
})

test('task-write 拒非法 id / 空数组 / 坏 JSON', () => {
  const pid = freshPid()
  try {
    assert.match(cmdTaskWrite(writeTmp('x.json', JSON.stringify([{ id: 'nope', name: 'a' }])), pid, null).error, /非法 task id/)
    assert.match(cmdTaskWrite(writeTmp('e.json', '[]'), pid, null).error, /为空/)
    assert.match(cmdTaskWrite(writeTmp('j.json', 'not json'), pid, null).error, /JSON 解析失败/)
    assert.match(cmdTaskWrite(null, pid, null).error, /--from-file 必填/)
  } finally {
    cleanup(pid)
  }
})

test('context-curate 写 jsonl + 丢 code 路径', () => {
  const pid = freshPid()
  try {
    cmdTaskWrite(writeTmp('t.json', JSON.stringify([{ id: 'T1', name: 'a' }])), pid, null)
    const jsonl = ['{"file":"docs/spec.md","reason":"需求"}', '{"file":"src/x.ts","reason":"码"}', '{"file":"research/a.md","reason":"调研"}'].join('\n')
    const r = cmdContextCurate('T1', writeTmp('c.jsonl', jsonl), pid, null)
    assert.equal(r.written, true)
    assert.equal(r.entries_written, 2)        // src/x.ts 被丢
    assert.equal(r.input_entries, 3)
    const back = taskStore.readContext(pid, 'T1')
    assert.deepEqual(back.map((e) => e.file), ['docs/spec.md', 'research/a.md'])
  } finally {
    cleanup(pid)
  }
})

test('context-curate 拒非法 id', () => {
  const pid = freshPid()
  try {
    assert.match(cmdContextCurate('bad', writeTmp('c.jsonl', '{}'), pid, null).error, /合法 task id/)
  } finally {
    cleanup(pid)
  }
})

test('lintTaskSchema：hard 抓 corruption，warning 抓空字段', () => {
  const pid = freshPid()
  try {
    cmdTaskWrite(writeTmp('s.json', JSON.stringify([
      { id: 'T1', name: 'ok', acceptance: ['x'] },
      { id: 'T2', name: '', acceptance: [] },                  // warnings
      { id: 'T3', name: 'bad', status: 'bogus', acceptance: ['y'] }, // hard
    ])), pid, null)
    const root = taskStore.getTasksRoot(pid)
    fs.mkdirSync(path.join(root, 'notatask'), { recursive: true })
    fs.mkdirSync(path.join(root, 'T4'), { recursive: true })
    fs.writeFileSync(path.join(root, 'T4', 'task.json'), '{ broken')
    const r = lintTaskSchema(pid)
    const hard = r.issues.map((i) => i.problem).sort()
    assert.deepEqual(hard, ['invalid_status:bogus', 'invalid_task_id_dir', 'task_json_missing_or_unparseable'].sort())
    assert.deepEqual(r.warnings.map((w) => w.problem).sort(), ['empty_acceptance', 'empty_name'].sort())
  } finally {
    cleanup(pid)
  }
})

test('guard hook: deny 读引擎源码 / 写 .cjs，allow 运行 CLI 与项目文件', () => {
  const CANON = '/Users/x/.agents/agent-workflow/core/utils/workflow'
  const MOUNT = '/p/.agent-workflow/utils/workflow'
  const DEV = '/Users/x/dev/claude-workflow/core/utils/workflow'
  // deny
  assert.ok(evaluate('Read', { file_path: `${CANON}/task_store.js` }))
  assert.ok(evaluate('Grep', { pattern: 'x', path: CANON }))
  assert.ok(evaluate('Bash', { command: `cat ${MOUNT}/plan_composer.js` }))
  assert.ok(evaluate('Bash', { command: `grep -n scoreConfidence ${CANON}/plan_composer.js` }))
  assert.ok(evaluate('Bash', { command: `node -e "require('${CANON}/task_store')"` }))
  assert.ok(evaluate('Write', { file_path: '/Users/x/.claude/workflows/p/.m.cjs' }))
  assert.ok(evaluate('Bash', { command: 'node /Users/x/.claude/workflows/p/.u.cjs' }))
  // allow
  assert.equal(evaluate('Read', { file_path: '/proj/src/a.ts' }), null)
  assert.equal(evaluate('Read', { file_path: `${DEV}/task_store.js` }), null) // dev repo 不匹配
  assert.equal(evaluate('Bash', { command: `node ${CANON}/workflow_cli.js status` }), null)
  assert.equal(evaluate('Bash', { command: `node ${CANON}/workflow_cli.js plan-review | grep ready` }), null)
  assert.equal(evaluate('Write', { file_path: '/proj/src/a.ts' }), null)
  assert.equal(isCjsIntoWorkflows('/x/.claude/workflows/p/a.cjs'), true)
  assert.equal(isCjsIntoWorkflows('/proj/build/a.cjs'), false)
})

test('F-05 guard hardening: Edit/MultiEdit 覆盖 + dot-segment + cd/变量间接 deny；正路 allow', () => {
  const CANON = '/Users/x/.agents/agent-workflow/core/utils/workflow'
  const MOUNT = '/p/.agent-workflow/utils/workflow'
  const DEV = '/Users/x/dev/claude-workflow/core/utils/workflow'
  // Edit/MultiEdit 改引擎源码（原先只守 Write，留等价口子）
  assert.ok(evaluate('Edit', { file_path: `${CANON}/task_store.js` }))
  assert.ok(evaluate('MultiEdit', { file_path: `${MOUNT}/plan_composer.js` }))
  // dot-segment 归一后命中
  assert.ok(evaluate('Read', { file_path: '/p/.agent-workflow/utils/../utils/workflow/task_store.js' }))
  // Bash cd / 变量间接读
  assert.ok(evaluate('Bash', { command: `cd ${CANON} && cat task_store.js` }))
  assert.ok(evaluate('Bash', { command: `p=${CANON}/task_store.js; cat "$p"` }))
  // allow：dev 仓 Edit、项目文件 Edit、正路 CLI（含管道 grep / cat 临时文件喂 stdin）
  assert.equal(evaluate('Edit', { file_path: `${DEV}/task_store.js` }), null)
  assert.equal(evaluate('Edit', { file_path: '/proj/src/a.ts' }), null)
  assert.equal(evaluate('Bash', { command: `node ${CANON}/workflow_cli.js plan-review | grep ready` }), null)
  assert.equal(evaluate('Bash', { command: `cat /tmp/wf-tasks.json | node ${CANON}/workflow_cli.js task-write --from-file -` }), null)
})

test('F-01 task-write 重跑保留存活 id 的 context.jsonl，移除 id 的背包随之清除', () => {
  const pid = freshPid()
  try {
    cmdTaskWrite(writeTmp('t.json', JSON.stringify([{ id: 'T1', name: 'a' }, { id: 'T2', name: 'b' }])), pid, null)
    cmdContextCurate('T1', writeTmp('c.jsonl', '{"file":"docs/spec.md","reason":"req"}'), pid, null)
    cmdContextCurate('T2', writeTmp('c2.jsonl', '{"file":"docs/t2.md","reason":"r2"}'), pid, null)
    // 重跑：T1 仍在（改名）、T2 被移除
    cmdTaskWrite(writeTmp('t2.json', JSON.stringify([{ id: 'T1', name: 'a-fixed' }])), pid, null)
    assert.deepEqual(taskStore.readContext(pid, 'T1').map((e) => e.file), ['docs/spec.md']) // 存活 → 背包保留
    assert.deepEqual(taskStore.readContext(pid, 'T2'), [])                                   // 移除 → 背包消失
    assert.equal(taskStore.readTask(pid, 'T1').name, 'a-fixed')
  } finally {
    cleanup(pid)
  }
})

test('F-02 context-curate 拒不存在的 task id，不造孤儿目录', () => {
  const pid = freshPid()
  try {
    cmdTaskWrite(writeTmp('t.json', JSON.stringify([{ id: 'T1', name: 'a' }])), pid, null)
    const r = cmdContextCurate('T2', writeTmp('c.jsonl', '{"file":"docs/s.md","reason":"r"}'), pid, null)
    assert.match(r.error, /不存在/)
    assert.equal(fs.existsSync(path.join(taskStore.getTasksRoot(pid), 'T2')), false)
  } finally {
    cleanup(pid)
  }
})

test('F-03 task-write 拒整集内重复 id', () => {
  const pid = freshPid()
  try {
    const r = cmdTaskWrite(writeTmp('d.json', JSON.stringify([{ id: 'T1', name: 'a' }, { id: 'T1', name: 'b' }])), pid, null)
    assert.match(r.error, /重复 task id/)
    assert.equal(taskStore.listTasks(pid).length, 0) // 破坏性替换未执行
  } finally {
    cleanup(pid)
  }
})

test('F-04 taskSourceEmptyIssue：空 task 源报 hard，有 task 不报', () => {
  const pid = freshPid()
  try {
    assert.deepEqual(taskSourceEmptyIssue({ project_id: pid }, pid, null), { problem: 'empty_task_source' })
    cmdTaskWrite(writeTmp('t.json', JSON.stringify([{ id: 'T1', name: 'a' }])), pid, null)
    assert.equal(taskSourceEmptyIssue({ project_id: pid }, pid, null), null)
  } finally {
    cleanup(pid)
  }
})
