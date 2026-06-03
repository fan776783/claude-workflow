import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { renderTaskMd } = require('../task_md_render.js')

test('renderTaskMd: 全字段分段渲染', () => {
  const md = renderTaskMd({
    id: 'T1',
    name: '实现登录',
    task_text: '实现登录校验。',
    acceptance: ['AC-1 成功登录'],
    constraints: ['C-1 保持 token 边界'],
    patterns: [{ file: 'src/login.ts', line: '42', note: '镜像错误处理' }],
    mandatory_reading: [{ path: 'docs/auth.md', reason: '契约', symbols: ['verify'], line_hint: '10-20' }],
    files: ['src/auth.ts'],
    verification: { commands: ['npm test'], expected_output: [], notes: [] },
  })
  assert.match(md, /^# T1: 实现登录/)
  assert.match(md, /实现登录校验。/)
  assert.match(md, /## 验收项\n- AC-1 成功登录/)
  assert.match(md, /## 关键约束\n- C-1 保持 token 边界/)
  assert.match(md, /## Patterns to Mirror\n- `src\/login\.ts`:42 — 镜像错误处理/)
  assert.match(md, /## Mandatory Reading\n- `docs\/auth\.md` \(lines 10-20\) — symbols: verify; 契约/)
  assert.match(md, /## 写作用域\n- `src\/auth\.ts`/)
  assert.match(md, /## 验证命令\n```bash\nnpm test\n```/)
})

test('renderTaskMd: 空 rich 字段只渲染标题（不 emit 空段）', () => {
  const md = renderTaskMd({
    id: 'T1', name: '壳', task_text: '', acceptance: [], constraints: [], patterns: [], mandatory_reading: [], files: [],
  })
  assert.equal(md.trim(), '# T1: 壳')
})

test('renderTaskMd: 无 name 用 id 作标题；patterns 无 line 省略冒号', () => {
  const md = renderTaskMd({ id: 'T2', patterns: [{ file: 'a.ts', note: 'n' }] })
  assert.match(md, /^# T2/)
  assert.match(md, /- `a\.ts` — n/)
})
