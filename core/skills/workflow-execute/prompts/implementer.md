# Implementer Subagent Prompt Template

> workflow-execute Step 4.1 派发 implementer subagent 时使用本模板。Controller 从 Step 1 持有的当前 task 切片构造本 prompt，subagent 只能看到自己被派发的 prompt，看不到主会话历史。

## Required structure

```
Active task: <task_id>
Spec: <spec-relative-path>
Plan: <plan-relative-path>

<task-slice>
${task_slice}
</task-slice>

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
1. 读 <task-slice> 中给出的 patterns / mandatory-reading 路径文件,自行定位相关代码段,确认你理解上下文(行号若给了是辅助锚点,没给就自己读定位,不要因缺行号去搜整库)
2. 尽量只在 <write-scope> 预期文件清单内实现代码;不要超额(不要做 task 没要求的事)
3. 如必须改 write-scope 外的文件,先返回 DONE_WITH_CONCERNS 且 concern.type="scope"(说明要动哪些文件 + 原因),由 reviewer 复核;不要静默越界
4. 按 <task-slice> 的 acceptance-criteria 实现代码,按 critical-constraints 守住边界
5. 按 <task-slice> 给出的验证命令跑验证,确认通过
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

- **从 Step 1 持有的当前 task 切片构造**：取该 task 的 task block 全文 + acceptance + constraints + patterns/mandatory-reading + files，组装成 `${task_slice}`；不再调 bundle CLI、不回头读 plan.md（对齐 controller-持全-plan 范式）
- **`${task_slice}` 内容**：原文粘 task block（含 acceptance-criteria / critical-constraints / patterns-to-mirror / mandatory-reading）。Patterns / Mandatory Reading 只给路径 + 一句意图（plan 里有行号顺带渲染，没有就只给路径）；**controller 自己不 Read 源码去补行号**——重读取留给 implementer 在它的抛弃式上下文里做，不污染 controller。粘指令、不粘代码
- **`${expected_files}`**：渲染该 task 在 plan 中声明的修改/创建文件清单（每条一行 `- ` bullet）；plan 未声明 → 写 "未声明 — 按 task 描述的创建/修改/测试文件推断,尽量不扩大"
- **第一行 `Active task:` 必须**：详见 [`../../dispatching-parallel-agents/SKILL.md#dispatch-prompt-contract`](../../dispatching-parallel-agents/SKILL.md)
- **TDD 手动开启命中**：仅当入口 `tdd_enabled: true` 且任务满足 workflow-execute 的 TDD 条件时,在 `<protocols>` 中引用 `../tdd/SKILL.md` 而非粘贴 TDD 全文;默认写 "本任务不强制 TDD"
- **HITL task**：在 `<protocols>` 中加入强制反问条款，不依赖 implementer 自觉

> Degraded 平台（无 subagent）：controller 主会话扮 implementer，本构造规则照样适用（自渲染自执行）。

## 4 种返回状态处理

| 状态 | controller 动作 |
|------|---------|
| `DONE` | 进入 Step 4.2 reviewer 派发（合并 AC+质量，见 `reviewer.md`） |
| `DONE_WITH_CONCERNS` | 读取结构化 `concerns[]`;`type=correctness/scope/verification` 或 `severity=blocking` → implementer 修 / 补 context 后再 review;`type=observation` 且 `severity=non_blocking` → 记录 journal 后进 4.2(与 `references/subagent-driven.md § Implementer 状态分流` 保持一致) |
| `NEEDS_CONTEXT` | 调 `AskUserQuestion` 收集用户回答 → 把答案塞回 prompt `<your-mandate>` 末尾 → 重派 |
| `BLOCKED` | 评估根因:context 缺失 → 补 context 重派;reasoning 不足 → 升级 model;task 过大 → 拆 task;plan 错 → escalate user |

**Never** 让 implementer 自己读 plan.md / spec.md(他们不该需要)，**Never** 把整个 codebase 塞给 implementer(只塞 `${task_slice}` 里的 mandatory-reading 路径)，**Never** controller 为补 patterns/mandatory 行号去 Read 源码文件(行号可选,让 implementer 自读定位)。
