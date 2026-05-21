---
name: dispatching-parallel-agents
description: "Use when 同阶段存在 2+ 可证明独立的只读问题域（独立 bug 调查、多个失败测试文件、独立子系统的 trace/diagnose/research/analysis）。仅用于只读 fan-out，禁止用于并行写代码。"
---

<CONTEXT>
分派给 subagent 的任务上下文须包含 `core/specs/shared/glossary.md` 引用。纯独立性判断阶段可跳过。
</CONTEXT>

# Dispatching Parallel Agents（只读 fan-out 专用）

将**独立的只读分析/调查任务**并行分派给多个 subagent，主会话负责汇总。写代码的任务一律顺序执行（每 task 走 workflow-execute 的 fresh-subagent-per-task 主路径），不在本 skill 范围。

> 本 skill 把"并行"严格限定在天然无写竞争的场景。

## 何时使用

| ✅ 用 | ❌ 不用 |
|---|---|
| 3+ 个失败测试文件，根因互不相干，需要并行调研 | 多个任务都要改代码（无论是否独立） |
| 多个独立 bug 调查（diagnose） | workflow-execute 的常规 task 执行（默认每 task 起 implementer subagent，顺序） |
| 多个子系统现状分析 / 架构调研（research） | 单个 subagent 派发或单 reviewer 派发（直接 `Task(...)` 即可） |
| 多 module 同时跑只读 codebase 检索 | quality_review 单 task review |
| 多 package 同时跑文档生成 / 内部对照 | 任何含 `create_file` / `edit_file` / `git_commit` action 的批次 |

## 不可违反的约束

> 这一段在改之前请重读一次。

1. **Never dispatch multiple implementation subagents in parallel** — 写竞争代价 > 并行收益
2. **只读 fan-out 也必须可证明独立**：每个 subagent 的输出彼此不依赖
3. **主会话保留汇总主权**：所有 subagent 返回后由主会话审视、整合、决定下一步
4. **不允许 fan-out 中嵌套 fan-out**：每层最多一次 parallel dispatch
5. **每个 subagent 只接收最小必要上下文**，不继承主会话历史

## 平台路由（只读 fan-out 视角）

| 平台 | 分派 | 等待 | 清理 |
|------|------|------|------|
| Claude Code / Cursor | `Task` | `TaskOutput` | 无需显式清理 |
| Codex | `spawn_agent` | `wait` | `close_agent` |
| 其他（opencode / antigravity / droid / gemini） | direct | direct | 主会话顺序执行，无 fan-out |

> 本表只覆盖只读 fan-out（debug / research / multi-bug 调查）的分派。fresh-subagent-per-task 主路径（implementer + reviewer subagent）的平台支持矩阵见 [`../workflow-execute/references/subagent-driven.md#平台-fallback-矩阵canonical`](../workflow-execute/references/subagent-driven.md)。

## 标准 workflow

### Step 1：确认场景

回答以下问题，任一为 No → 不该用本 skill：

- 是否存在 ≥2 个独立问题域？
- 每个域的输出是不是**只读**（分析报告 / 诊断结论 / 检索结果 / 文档摘要）？
- 各 subagent 输出可否独立汇总成最终结论？

如果有任一域需要写代码 → 走 workflow-execute fresh-subagent-per-task，**顺序执行**。

### Step 2：识别独立问题域

按**上下文边界**而非角色拆分：

| ✅ 合法边界 | ❌ 非法拆分 |
|---|---|
| 失败测试文件 A vs B vs C | "测试 agent" / "review agent" 同时碰同一文件 |
| auth module bug vs payment module bug | "架构师 agent" + "安全专家 agent" 同看同一段代码 |
| user-domain trace vs api-domain trace | "前端 agent" + "后端 agent" 改同一组件 |

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
1. 只看 scope 内的文件，不发散
2. 不动代码（本 skill 是只读 fan-out）
3. 返回结构化报告：findings / root_cause / recommendation
</your-mandate>

<output-schema>
findings: [<观察事实>]
root_cause: <一句话>
recommendation: <一句话建议下一步>
</output-schema>
```

**`Active task:` 第一行强制**（hook 失效兜底，见下方 Dispatch Prompt Contract）。

### Step 4：并行派发

Claude Code / Cursor：

```typescript
Task("Investigate failing test: auth-token-expiry.test.ts")
Task("Investigate failing test: payment-refund-flow.test.ts")
Task("Investigate failing test: ui-modal-leak.test.ts")
// 三个并行运行
```

Codex：先 `spawn_agent` × N → `wait` 回收 → `close_agent` 释放槽位。

### Step 5：主会话汇总

每个 subagent 返回后：

1. 读每份 `<output-schema>`
2. 判断 root_cause 是否真的独立（若发现 A 和 B 实际同根因 → 合并）
3. 决定下一步：可能是再起 fix-bug / workflow-spec / 直接修
4. **不要让 subagent 自己 commit 任何修复**——本 skill 是只读的

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
- subagent 报告含改代码动作 → 主会话拒绝采纳，提示用户走 fix-bug / workflow-execute

## 与其他 skill 的边界

| 场景 | skill |
|------|---|
| 多 bug 并行调研 | 本 skill |
| 多 test 并行 root cause | 本 skill |
| 多 feature 并行实现 | ❌ 写动作禁止并行，走 workflow-execute 顺序 |
| 单 task workflow 执行 | workflow-execute（默认 fresh-subagent-per-task） |
| 跨会话执行 plan | workflow-execute |
| 批量 bug 修复 | bug-batch（内部 FixUnit 顺序执行） |
