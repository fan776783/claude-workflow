---
name: dispatching-parallel-agents
description: "Use when 同阶段存在 2+ 可证明独立的问题域：独立 bug 调查、多个失败测试文件、独立子系统的 trace/diagnose/research/analysis（只读 fan-out），或无共享状态、文件不重叠的独立写任务（writable fan-out）。每域一个 subagent，主会话汇总 + conflict check。禁止多 agent 编辑同一文件，或并行执行有依赖的 plan task（plan 执行仍走 workflow-execute 顺序路径）。"
---

<CONTEXT>
分派给 subagent 的任务上下文须包含 `core/specs/shared/glossary.md` 引用。纯独立性判断阶段可跳过。
</CONTEXT>

# Dispatching Parallel Agents

将**可证明独立的问题域**并行分派给多个 subagent，主会话负责汇总。两种 fan-out：

- **只读 fan-out**：独立分析/调查（debug / diagnose / research / multi-bug），subagent 不写代码。
- **writable fan-out**：独立写任务，前提是**文件不重叠 + 无共享状态**。每 agent 改自己 scope 内的文件，主会话回收后做 conflict check + 跑全量验证。

> 本 skill 把"并行"严格限定在天然无写竞争的场景。判定主权在主会话：拿不准是否独立 → 退回顺序执行。
>
> **不在本 skill 范围**：有依赖关系的 plan task 并行（走 workflow-execute 顺序路径，每 task fresh-subagent-per-task）；多 agent 编辑同一文件/共享状态。

## 何时使用

| ✅ 用 | ❌ 不用 |
|---|---|
| 3+ 个失败测试文件，根因互不相干，需要并行调研（只读） | 多个写任务但**文件重叠 / 有共享状态 / 有依赖**（退回顺序） |
| 多个独立 bug 调查（diagnose，只读） | workflow-execute 的 plan task 执行（默认每 task 起 implementer subagent，顺序） |
| 多个子系统现状分析 / 架构调研（research，只读） | 单个 subagent 派发或单 reviewer 派发（直接 `Task(...)` 即可） |
| 多 module 同时跑只读 codebase 检索 | quality_review 单 task review |
| 多个**文件不重叠**的独立写任务（如各修一个独立失败测试文件 / 各改一个独立 module，writable fan-out） | 拿不准是否真独立时（写竞争代价 > 并行收益，退回顺序） |

## 不可违反的约束

> 这一段在改之前请重读一次。

1. **文件不重叠是 writable fan-out 的硬前提** — 多个写 agent 的 `allowed_write_paths` 必须两两不相交；任何重叠或共享状态 → 退回顺序执行。**绝不让两个 agent 编辑同一文件**
2. **可证明独立**：每个 subagent 的输出/改动彼此不依赖，不构成对方的前置
3. **主会话保留汇总主权**：所有 subagent 返回后由主会话审视、**对 writable fan-out 做 conflict check + 跑全量验证**、决定下一步
4. **不允许 fan-out 中嵌套 fan-out**：每层最多一次 parallel dispatch
5. **每个 subagent 只接收最小必要上下文**，不继承主会话历史
6. **有依赖的 plan task 不在此并行** — 那走 workflow-execute 顺序路径（fresh-subagent-per-task）。本 skill 只接无依赖、文件不重叠的独立域

## 平台路由（fan-out 视角）

| 平台 | 分派 | 等待 | 清理 |
|------|------|------|------|
| Claude Code / Cursor | `Task` | `TaskOutput` | 无需显式清理 |
| Codex | `spawn_agent` | `wait` | `close_agent` |
| OpenCode / Droid | `Task`（`subagent_type`） | 自动 | 无需显式清理 |
| Antigravity / Qoder | subagent（自动编排 / `~/.qoder/agents`） | 平台原生 | 自动 |
| 无 subagent 平台（如 github-copilot / 受限环境） | direct | direct | 主会话顺序执行，无 fan-out |

> 本表覆盖两种 fan-out（只读 + writable）的分派。workflow-execute plan 执行的 fresh-subagent-per-task 主路径（implementer + reviewer subagent，顺序）平台支持矩阵见 [`../workflow-execute/references/subagent-driven.md#平台-fallback-矩阵canonical`](../workflow-execute/references/subagent-driven.md)。

## 标准 workflow

### Step 1：确认场景

回答以下问题，任一为 No → 不该用本 skill：

- 是否存在 ≥2 个独立问题域？
- 各 subagent 输出/改动可否独立汇总，互不构成前置？
- **若是 writable fan-out**：各域的写文件集是否两两不相交、无共享状态？

判定走向：
- 全只读 → **只读 fan-out**，subagent 不写代码。
- 含写动作且**文件不重叠 + 无共享状态** → **writable fan-out**，每 agent 改自己 scope。
- 写文件重叠 / 有共享状态 / 有依赖 → 退回 workflow-execute **顺序执行**，不用本 skill。

### Step 2：识别独立问题域

按**上下文边界**而非角色拆分；writable fan-out 额外按**写文件集**切分：

| ✅ 合法边界 | ❌ 非法拆分 |
|---|---|
| 失败测试文件 A vs B vs C | "测试 agent" / "review agent" 同时碰同一文件 |
| auth module bug vs payment module bug | "架构师 agent" + "安全专家 agent" 同看同一段代码 |
| user-domain trace vs api-domain trace | "前端 agent" + "后端 agent" 改同一组件 |
| 各改独立 module/文件、写集不相交（writable） | 多 agent 写同一文件 / 共享 locales / 共享类型定义 |

### Step 3：构造每个 subagent 的最小 prompt

每个 subagent 接收：

```
Active task: <task_id-or-sub-id>
Domain: <边界名，如 auth-failure-test>
Scope: <一句话说要做什么，禁止扩散>

<context>
{ 该域的最小上下文片段：相关文件路径、错误信息、限定范围 }
</context>

<your-mandate>
1. 只看/只改 scope 内的文件，不发散
2. 【只读 fan-out】不动代码，返回结构化报告
   【writable fan-out】只改 allowed_write_paths 内文件，绝不碰其他 agent 的文件；自测通过；**不要 commit**（commit 由主会话汇总后统一做）
3. 返回结构化报告
</your-mandate>

<output-schema>
# 只读 fan-out
findings: [<观察事实>]
root_cause: <一句话>
recommendation: <一句话建议下一步>

# writable fan-out（额外）
files_changed: [<本 agent 改过的文件；主会话以 git 真值复核，此清单仅作定位辅助>]
verification: <自测命令 + 结果>
</output-schema>
```

writable fan-out 的 prompt 必须显式给出 `allowed_write_paths` + `禁止编辑其他 agent 文件` 约束。

**`Active task:` 第一行强制**（hook 失效兜底，见下方 Dispatch Prompt Contract）。

### Step 4：并行派发

Claude Code / Cursor：

```typescript
// 只读 fan-out
Task("Investigate failing test: auth-token-expiry.test.ts")
Task("Investigate failing test: payment-refund-flow.test.ts")
Task("Investigate failing test: ui-modal-leak.test.ts")
// 三个并行运行

// writable fan-out（文件不重叠）
Task("Fix auth-token-expiry.test.ts，allowed_write_paths: src/auth/**，不碰其他文件")
Task("Fix payment-refund-flow.test.ts，allowed_write_paths: src/payment/**，不碰其他文件")
```

Codex：先 `spawn_agent` × N → `wait` 回收 → `close_agent` 释放槽位。

### Step 5：主会话汇总

每个 subagent 返回后：

1. 读每份 `<output-schema>`
2. 判断 root_cause / 改动是否真的独立（若发现 A 和 B 实际同根因 → 合并）
3. **writable fan-out 必做**（Review & Integrate）：
   - **conflict check 用 git 真值**：以 `git status --porcelain` 实际改动文件集对照各 agent 声明的写 scope（自报 `files_changed` 可能少报，仅作定位辅助）—— 实际改动出现跨 scope 交集即视为前置违规，人工核对
   - **跑全量验证**（测试套件 / 构建），确认各 agent 改动合在一起仍 green
   - 主会话**统一 commit**（subagent 不自行 commit）；交付代码由主会话审视后落盘（代码主权）
4. 决定下一步：可能是再起 fix-bug / workflow-spec / 直接修

## Dispatch Prompt Contract（必须遵守）

通过 `Task` / `spawn_agent` 派发任意 subagent 时，**dispatch prompt 的第一行必须是**：

```
Active task: <task_id>
```

可选第二、三行：

```
Spec: <spec_file 路径>
Plan: <plan_file 路径>
```

**为什么强制**：这一行在 prompt 出生时就有，不依赖任何 hook。`PreToolUse(Task)` hook 因任何原因失效（`hooks.json` 被改、Windows 平台 skip、`--continue` 恢复信号丢失、`CLAUDE_PLUGIN_ROOT` 未注入）时，subagent 仍能从 prompt 第一行准确识别 active task；正常情况下 hook 注入的 `<current-task>` block 与该 header 互为冗余。

**与 hook 的关系**：`pre-execute-inject.js` 在 PreToolUse(Task) 做幂等 normalize：dispatcher 已写则不重复，未写则补一份。

## 推荐输出（主会话给用户）

```markdown
## Subagent Fan-out Summary
- routing: <platform/tool>
- domains:
  - <domain-1>: <一句话结论>
  - <domain-2>: <一句话结论>
  - <domain-3>: <一句话结论>
- merged_findings: <如有跨域重叠，列出>
- next_action: <下一步建议，通常是 /diagnose / /fix-bug / /workflow-spec 路由>
```

## 失败时的默认行为

- 平台不支持 → 主会话顺序跑各 domain，逐个返回结果
- subagent 输出格式不合规 → 该 domain 标 invalid，不阻塞其他 domain
- 只读 fan-out 的 subagent 擅自改了代码 → 主会话拒绝采纳，提示走 fix-bug / workflow-execute
- writable fan-out 回收后 git 真值改动集出现跨 scope 交集 → 视为独立性误判，**回退到顺序重做**该组，不强行 merge
- 全量验证失败 → 不 commit，定位是哪个 agent 的改动 → 顺序修复

## 与其他 skill 的边界

| 场景 | skill |
|------|---|
| 多 bug 并行调研（只读） | 本 skill |
| 多 test 并行 root cause（只读） | 本 skill |
| 多个文件不重叠的独立写任务（writable fan-out） | 本 skill |
| 多 feature 实现但**有依赖 / 文件重叠 / 共享状态** | ❌ 走 workflow-execute 顺序 |
| 单 task workflow 执行 | workflow-execute（默认 fresh-subagent-per-task） |
| 有依赖的 plan 执行 / 跨会话执行 plan | workflow-execute（顺序，plan task 不在本 skill 并行） |
| 批量 bug 修复 | bug-batch（内部 FixUnit 顺序执行） |
