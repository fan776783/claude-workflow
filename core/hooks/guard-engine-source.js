#!/usr/bin/env node
/**
 * @file Engine Source Guard — PreToolUse(Read|Grep|Bash|Write|Edit|MultiEdit) deny 逆向 workflow 引擎源码 / 写 .cjs 绕过 CLI。
 *
 * 背景：planner 在 workflow 执行期反复 Read/grep `core/utils/workflow/*.js`、手写 `.cjs` 直 require 内部模块
 * 绕过 CLI（实测 context 峰值 238K，~31% 是逆向引擎）。根因是写正路缺失，已由 task-write/context-curate 补齐。
 * 本 hook 物理堵死兽径：命中即 deny + 引导改用公开 CLI（`--help` 查签名），缺能力则 halt 报错，不许自行逆向。
 *
 * 作用域：仅 canonical/mounted 安装的引擎命名空间——
 *   - agent-workflow/core/utils/workflow/   （canonical ~/.agents/... 及任何安装副本）
 *   - .agent-workflow/utils/workflow/        （各工具逐 skill mount 的内部资源）
 * 不匹配开发仓 `claude-workflow/core/utils/workflow/` → 维护者在本仓读改引擎不受影响。
 * 关：环境变量 WORKFLOW_ENGINE_GUARD=0。
 */

require('./_utf8')

const fs = require('fs')
const path = require('path')

// 引擎源码目录标记（dir 或其下文件）。两种安装形态。
const ENGINE_MARKER = '(?:agent-workflow/core/utils/workflow|\\.agent-workflow/utils/workflow)'
const ENGINE_PATH_RE = new RegExp(`${ENGINE_MARKER}(?:/|$)`)
const ENGINE_MARKER_RE = new RegExp(ENGINE_MARKER)
const READ_TOOLS = 'cat|bat|sed|head|tail|less|more|nl|grep|egrep|fgrep|rg|ack|awk|strings|xxd|od|cp|wc|diff|vim|vi|nano|open|code'
// Bash 里"读类工具的参数段直接指向引擎源码"（管道后的 grep 作用于 stdout，不含 marker → 不误伤 `node cli | grep`）。
const READ_UTIL_RE = new RegExp(`(?:^|[|&;]|\\s)(?:${READ_TOOLS})\\s+[^|&;]*?${ENGINE_MARKER}/`)
// 读类工具 token（不要求参数紧跟 marker）：配合 bashReadsEngineIndirectly 抓 cd/变量间接读。
const READ_TOKEN_RE = new RegExp(`(?:^|[|&;]|\\s)(?:${READ_TOOLS})\\b`)
// node -e/-p/--eval/--print 引用引擎内部（= materialize 式 inline 绕过）。
const NODE_EVAL_RE = new RegExp(`\\bnode\\b[^|&;]*\\s(?:-e|--eval|-p|--print)\\b[^|&;]*${ENGINE_MARKER}`)
// require('<engine>') —— 任何形态的直接 require 内部模块。
const REQUIRE_ENGINE_RE = new RegExp(`require\\(\\s*['"\`][^'"\`]*${ENGINE_MARKER}`)

const REDIRECT = [
  '逆向 workflow 引擎源码 / 写 .cjs 绕过 CLI 已被禁止。',
  '写 task-dir 用 `workflow_cli.js task-write --from-file <tasks.json|->`（原子整集，字段见 SKILL）；',
  '写 per-task 背包用 `context-curate --id <Tn> --from-file <jsonl|->`；查命令签名用 `<cmd> --help`。',
  'CLI 不满足需求时 halt 报错让用户介入，禁止读 task_store.js/plan_composer.js 等引擎源码自写脚本。',
].join(' ')

function allow() {
  process.stdout.write(JSON.stringify({ continue: true }))
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }))
}

// 写 .cjs 到 workflow 状态目录（.claude/workflows/...）= materialize 式绕过产物。
function isCjsIntoWorkflows(p) {
  const s = String(p || '')
  return /\.cjs$/.test(s) && /\/workflows\//.test(s)
}

// 命中引擎源码路径：归一折叠 ../ 等 dot-segment 后再匹配，堵 `.agent-workflow/utils/../utils/workflow` 式绕过。
// 用 path.posix.normalize（先把 \ 换成 /）而非 path.normalize：后者在 win32 会把分隔符翻成 \，
// 令 / 写法的 deny pattern 漏匹配（dot-segment 绕过在 Windows 上逃逸）。统一归一到 / 让两平台行为一致。
function hitsEnginePath(p) {
  const s = String(p || '')
  if (!s) return false
  return ENGINE_PATH_RE.test(s) || ENGINE_PATH_RE.test(path.posix.normalize(s.replace(/\\/g, '/')))
}

// Bash 间接读引擎源码：命令含读类工具 token，且剥掉 workflow_cli.js 调用路径后仍残留 engine marker。
// 抓 `cd <engine-dir> && cat task_store.js`、`p=<engine>; cat "$p"` 这类把 marker 与读工具拆开的绕法。
// 剥 workflow_cli.js 是为放行正路 `node <CLI> ... | grep` —— 其 marker 仅来自 CLI 自身路径，剥后无残留。
function bashReadsEngineIndirectly(cmd) {
  if (!READ_TOKEN_RE.test(cmd)) return false
  const stripped = cmd.replace(/[^\s'"`|&;]*workflow_cli\.js/g, '')
  return ENGINE_MARKER_RE.test(stripped)
}

function evaluate(toolName, ti) {
  if (toolName === 'Read') {
    if (hitsEnginePath(ti.file_path)) {
      return `读取 workflow 引擎源码被禁止（${ti.file_path}）。${REDIRECT}`
    }
  } else if (toolName === 'Grep') {
    const target = String(ti.path || ti.glob || '')
    if (hitsEnginePath(target)) {
      return `grep workflow 引擎源码被禁止（${target}）。${REDIRECT}`
    }
  } else if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    if (isCjsIntoWorkflows(ti.file_path)) {
      return `向 workflow 状态目录写 .cjs 脚本被禁止（${ti.file_path}）。${REDIRECT}`
    }
    if (hitsEnginePath(ti.file_path)) {
      return `改写 workflow 引擎源码被禁止（${ti.file_path}）。${REDIRECT}`
    }
  } else if (toolName === 'Bash') {
    const cmd = String(ti.command || '')
    if (READ_UTIL_RE.test(cmd) || NODE_EVAL_RE.test(cmd) || REQUIRE_ENGINE_RE.test(cmd) || bashReadsEngineIndirectly(cmd)) {
      return `命令读取/require workflow 引擎源码被禁止。${REDIRECT}`
    }
    if (cmd.includes('.cjs') && /\/workflows\//.test(cmd)) {
      return `命令涉及 workflow 状态目录下的 .cjs 脚本（写或运行）被禁止。${REDIRECT}`
    }
  }
  return null
}

function main() {
  if (process.env.WORKFLOW_ENGINE_GUARD === '0') {
    allow()
    return
  }
  let input = {}
  try {
    const raw = fs.readFileSync(0, 'utf8')
    input = raw.trim() ? JSON.parse(raw) : {}
  } catch (e) {
    process.stderr.write(`[guard-engine-source] input parse failed: ${e.message}\n`)
    allow()
    return
  }
  if ((input.hook_event_name || input.hookEventName) !== 'PreToolUse') {
    allow()
    return
  }
  const reason = evaluate(input.tool_name, input.tool_input || {})
  if (reason) deny(reason)
  else allow()
}

if (require.main === module) {
  try {
    main()
  } catch (e) {
    process.stderr.write(`[guard-engine-source] crash: ${e.message}\n`)
    allow()
  }
}

module.exports = { evaluate, ENGINE_PATH_RE, isCjsIntoWorkflows, hitsEnginePath, bashReadsEngineIndirectly }
