# Implementer Subagent Prompt Template

> workflow-execute Step 4.1 派发 implementer subagent 时使用本模板。**task 正文单通道 = `pre-execute-inject` hook 注入 `<current-task>`**（task.md 渲染：task_text + acceptance + constraints + patterns/mandatory-reading + files + 验证），task 若声明 `constraints_global` / `interfaces`，hook 另注入 `<global-constraints>`（workflow 级全局约束）/ `<task-interfaces>`（跨 task 接口契约）。controller 只装配编排骨架。subagent 只能看到被派发的 prompt + hook 注入内容，看不到主会话历史。

## Required structure

```
[MODEL: <model-hint>]
Active task: <task_id>
Spec: <spec-relative-path>
Plan: <plan-relative-path>

（`<current-task>` / `<global-constraints>`（如有）/ `<task-interfaces>`（如有）由 hook 在派发时注入，不在 controller 装配范围内）

<write-scope>
预期改动文件（取自 plan task 的修改/创建文件清单）：
${expected_files}

软约束：尽量只动上面这些文件。如需改 scope 外的文件，先返回 DONE_WITH_CONCERNS（concern.type="scope"）说明要动哪些文件 + 原因，交由 reviewer 复核裁定，不要静默扩大改动面。这是软边界，不是机器 hard-block——目的是让越界改动可见、可复核。
</write-scope>

<protocols>
- TDD: { 仅当入口 `tdd_enabled: true` 且任务满足 TDD 手动开启条件时引用 ../tdd/SKILL.md;否则 "本任务不强制 TDD"。默认不走 TDD 路径 }
- HITL 强制反问(仅 interaction:HITL):
  Before any code change, you MUST emit NEEDS_CONTEXT with the questions the human needs to answer.
- 输出协议: 完成后必须返回 4 种状态之一: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
</protocols>

<your-mandate>
1. 读 <current-task> 中给出的 patterns / mandatory-reading 路径文件,自行定位相关代码段,确认你理解上下文(行号若给了是辅助锚点,没给就自己读定位,不要因缺行号去搜整库)
2. 尽量只在 <write-scope> 预期文件清单内实现代码;不要超额(不要做 task 没要求的事)
3. 如必须改 write-scope 外的文件,先返回 DONE_WITH_CONCERNS 且 concern.type="scope"(说明要动哪些文件 + 原因),由 reviewer 复核;不要静默越界
4. 按 <current-task> 的 acceptance-criteria 实现代码,按 critical-constraints 守住边界;**若注入了 `<global-constraints>` 逐字遵守(workflow 级全局约束:版本下限/依赖限制/命名文案/精确值,勿违反);若注入了 `<task-interfaces>` 按 `consumes` 契约对接邻居 task(不读其源码即知形态)、`produces` 实现须与声明契约一致**
5. 按 <current-task> 给出的验证命令跑验证,确认通过
6. 自查代码质量(命名 / 类型 / 测试)
7. 提交一份 status report,见下方 output schema
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
  "concerns": [
    {
      "type": "correctness" | "scope" | "verification" | "observation",
      "severity": "blocking" | "non_blocking",
      "message": "<DONE_WITH_CONCERNS 时，每条简短>"
    }
  ],
  "questions": ["<NEEDS_CONTEXT 时，每条简短>"],
  "blocker": "<BLOCKED 时，一句话根因 + 建议>"
}

可选字段（concerns/questions/blocker）按 status 出现；不适用时省略或空数组。

**禁止**：在 JSON 前后输出散文 / "Let me start" / "我会先 Read..." 等过程叙述 / markdown 标题。
推理留在你自己上下文里，回传 controller 的只能是 JSON。
</output-schema>
```

## Controller 责任

- **task 正文单通道 = hook 注入**：`pre-execute-inject` hook 在 Task 派发时自动把当前 task 的 task.md 渲染正文注入 `<current-task>`；controller **不重复粘贴 task 正文**、不调 bundle CLI、不回头读 plan.md。hook 注入不可用（平台无 PreToolUse hook / `WORKFLOW_HOOKS=0`）→ controller 兜底把 Step 1 内存切片的 task 正文以 `<current-task>` 块粘进 prompt,内容等价;task 若声明 `constraints_global` / `interfaces`,同理兜底粘 `<global-constraints>` / `<task-interfaces>` 两段
- **controller 不 Read 源码补行号**：patterns / mandatory-reading 的行号可选,重读取留给 implementer 在它的抛弃式上下文里做，不污染 controller。粘指令、不粘代码
- **`${expected_files}`**：渲染该 task 在 plan 中声明的修改/创建文件清单（每条一行 `- ` bullet）；plan 未声明 → 写 "未声明 — 按 task 描述的创建/修改/测试文件推断,尽量不扩大"
- **第一行 `Active task:` 必须**：hook 失效时的锚定兜底，详见 [`../../dispatching-parallel-agents/SKILL.md#dispatch-prompt-contract`](../../dispatching-parallel-agents/SKILL.md)
- **TDD 手动开启命中**：仅当入口 `tdd_enabled: true` 且任务满足 workflow-execute 的 TDD 条件时,在 `<protocols>` 中引用 `../tdd/SKILL.md` 而非粘贴 TDD 全文;默认写 "本任务不强制 TDD"
- **HITL task**：在 `<protocols>` 中加入强制反问条款，不依赖 implementer 自觉
- **[MODEL] 分级提示**（参照 superpowers 6.0，强制指定防静默继承会话最贵模型）：
  - **机械实现**（1-2 文件、完整规格、转录+测试）→ 廉价/快速模型（如 haiku-class）
  - **集成/判断**（跨文件、需理解 contract、有边界条件）→ 标准模型（如 sonnet-class）
  - **架构/设计**（新模块、复杂算法、跨服务 contract 设计）→ 最强模型（如 opus-class）
  - **「Turn count beats token price」**：廉价模型常需 2-3 倍轮次修正，反而更贵。implementer 写散文描述/多步推理时至少用中档模型。plan 文本含完整代码（转录+测试）时可用最廉价模型。
  - 平台不支持指定模型时忽略此占位符（degraded 平台 controller 主会话即 implementer）

> Degraded 平台（无 subagent）：controller 主会话扮 implementer——无 Task 派发即无 hook 注入,直接以 Step 1 内存切片为 task 上下文（自渲染自执行）。

## 4 种返回状态处理

DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED → controller 动作分流以 [`../references/subagent-driven.md`](../references/subagent-driven.md) § Implementer 状态分流为**唯一权威**,此处不复表。NEEDS_CONTEXT 的答案塞回 prompt `<your-mandate>` 末尾后重派。

禁止项（implementer 读 plan/spec、controller 自读源码补行号、整 codebase 塞 prompt 等）见同文件「不允许的行为」。
