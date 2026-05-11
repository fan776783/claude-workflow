---
name: handoff
description: "Compact the current conversation into a handoff document for another agent or session to continue. Use when user says 'handoff' / '交接' / '总结给下一个' / 'wrap up for next session' / 'session summary', or context is about to be lost and work needs continuation."
argument-hint: "下一个 session 的工作重点(可选)"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:handoff 不产出代码,只读 glossary 确保术语一致即可,code-specs 跳过。
</PRE-FLIGHT>

# Handoff

压缩当前会话为结构化交接文档,让下一个 session/agent 零成本接手。

## 与 workflow-execute 的关系

`workflow-execute` 有内置 `handoff-required` continuation artifact(context 压缩时自动触发)。本 skill 是**手动入口**,适用于:
- 无 workflow 的自由对话
- 跨工具交接(Claude Code → Cursor / Codex 等)
- 主动结束 session

有活跃 workflow 时提示用户:"当前有活跃 workflow,建议用 `/workflow-status` 查看续接信息。仍要生成 handoff 文档吗?"

## 文件位置

- 有活跃 workflow → `~/.claude/workflows/{pid}/handoff-{YYYYMMDD-HHmm}.md`
- 无 workflow → 写到 `/tmp/handoff-XXXXXX.md`(用 `mktemp`)

## 文档模板

```markdown
# Handoff — {日期} {一句话主题}

## 当前状态
<做到哪了,什么能跑什么不能>

## 关键决策
<已做的决策 + 原因,引用 ADR/commit/spec 路径>

## 未完成
<具体待做事项,按优先级>

## 推荐 skill
<下一个 session 建议用哪些 skill,为什么>

## 上下文指针
<相关文件/URL/issue 列表,不重复内容只给路径>
```

## 规则

- **不重复已有 artifact**。PRD / plan / commit / spec / ADR → 只引用路径或 URL
- **不创造新信息**。只压缩和组织已有上下文
- **如果用户传了参数**,作为下一个 session 的工作重点,tailored 文档内容
- **推荐 skill 时给理由**。不是列清单,是说"因为 X 未完成,建议用 /Y 因为 Z"
