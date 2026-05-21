# Implementer Subagent Prompt Template

> workflow-execute Step 5.1 派发 implementer subagent 时使用本模板。Controller 负责注入变量，subagent 只能看到自己被派发的 prompt，看不到主会话历史。

## Required structure

```
Active task: <task_id>
Spec: <spec-relative-path>
Plan: <plan-relative-path>

<task-text>
${bundle.task_text}
</task-text>

<acceptance-criteria>
${bundle.acceptance_criteria}
</acceptance-criteria>

<critical-constraints>
${bundle.critical_constraints}
</critical-constraints>

<patterns-to-mirror>
${bundle.patterns_to_mirror}
</patterns-to-mirror>

<mandatory-reading>
${bundle.mandatory_reading}
</mandatory-reading>

<verification>
${bundle.verification}
</verification>

<protocols>
- TDD: { 仅当入口 `tdd_enabled: true` 且任务满足 TDD 手动开启条件时引用 ../tdd/SKILL.md;否则 "本任务不强制 TDD"。默认不走 TDD 路径 }
- HITL 强制反问(仅 interaction:HITL):
  Before any code change, you MUST emit NEEDS_CONTEXT with the questions the human needs to answer.
- 输出协议: 完成后必须返回 4 种状态之一: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
</protocols>

<your-mandate>
1. 读 mandatory-reading 中的文件,确认你理解上下文
2. 按 acceptance-criteria 实现代码;不要超额(不要做 task 没要求的事)
3. 按 critical-constraints 守住边界
4. 按 <verification> 跑验证命令,确认通过
5. 自查代码质量(命名 / 类型 / 测试)
6. 提交一份 status report,见下方 output schema
</your-mandate>

<output-schema>
**严格 JSON-only**（禁散文段、禁 markdown 标题、禁推理过程）。

输出一行 JSON，schema 如下：

{
  "status": "DONE" | "DONE_WITH_CONCERNS" | "NEEDS_CONTEXT" | "BLOCKED",
  "summary": "<一句话总结改了什么>",
  "files_changed": ["<文件路径列表>"],
  "verification": {
    "command": "<跑的验证命令>",
    "result": "pass" | "fail",
    "output_summary": "<关键输出，≤200 字>"
  },
  "concerns": ["<DONE_WITH_CONCERNS 时，每条简短>"],
  "questions": ["<NEEDS_CONTEXT 时，每条简短>"],
  "blocker": "<BLOCKED 时，一句话根因 + 建议>"
}

可选字段（concerns/questions/blocker）按 status 出现；不适用时省略或空数组。

**禁止**：在 JSON 前后输出散文 / "Let me start" / "我会先 Read..." 等过程叙述 / markdown 标题。
推理留在你自己上下文里，回传 controller 的只能是 JSON。
</output-schema>
```

## Controller 责任

- **先调 `workflow_cli.js task-bundle <task-id>` 获取 bundle JSON**，按 Required structure 的 ${bundle.*} 占位填充 prompt；不要直接 Read plan.md 切片
- **第一行 `Active task:` 必须**：详见 [`../../dispatching-parallel-agents/SKILL.md#dispatch-prompt-contract`](../../dispatching-parallel-agents/SKILL.md)
- **TDD 手动开启命中**：仅当入口 `tdd_enabled: true` 且任务满足 workflow-execute 的 TDD 条件时,在 `<protocols>` 中引用 `../tdd/SKILL.md` 而非粘贴 TDD 全文;默认写 "本任务不强制 TDD"
- **HITL task**：在 `<protocols>` 中加入强制反问条款，不依赖 implementer 自觉
- **不让 implementer 读 plan.md**：把 task block 完整粘进 `<task-text>`，省一次文件读
- **Patterns to Mirror**：必须给 `file_path:line_number`，让 implementer 直接 jump，不让它去搜

## bundle 字段 → prompt 占位映射

| 占位 | bundle JSON 字段 | 渲染规则 |
|------|------------------|----------|
| `${bundle.task_text}` | task_text | 原文粘贴 |
| `${bundle.acceptance_criteria}` | acceptance_criteria[] | 每条一行 `- ` bullet |
| `${bundle.critical_constraints}` | critical_constraints[] | 每条一行 `- ` bullet |
| `${bundle.patterns_to_mirror}` | patterns_to_mirror[] | 每条：`line` 在 → `- file:line — note`；`line` 缺失 → `- file — note`；空数组 → "无 — 参考 mandatory-reading 推断" |
| `${bundle.mandatory_reading}` | mandatory_reading[] | 每条一行路径；bundle 只含路径，如需一句话作用由 controller 另补 |
| `${bundle.verification}` | verification.{command, require_files, expected} | "运行 `<command>`；期望 `<expected>`；require_files: `<list 或 none>`"（require_files 一期恒空） |

> Degraded 平台（无 subagent）：controller 主会话扮 implementer，本占位映射照样适用（自渲染自执行）。

## 4 种返回状态处理

| 状态 | controller 动作 |
|------|---------|
| `DONE` | 进入 Step 5.2 reviewer 派发（合并 AC+质量，见 `reviewer.md`） |
| `DONE_WITH_CONCERNS` | 读 concerns;correctness 类先派 implementer 修;observation 类记录后进 5.2 |
| `NEEDS_CONTEXT` | 调 `AskUserQuestion` 收集用户回答 → 把答案塞回 prompt `<your-mandate>` 末尾 → 重派 |
| `BLOCKED` | 评估根因:context 缺失 → 补 context 重派;reasoning 不足 → 升级 model;task 过大 → 拆 task;plan 错 → escalate user |

**Never** 让 implementer 自己读 plan.md / spec.md(他们不该需要)，**Never** 把整个 codebase 塞给 implementer(只塞 mandatory-reading)。
