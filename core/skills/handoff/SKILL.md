---
name: handoff
description: "Compact the current conversation into a handoff document for another agent or session to continue. Use when user says 'handoff' / '交接' / '总结给下一个' / 'wrap up for next session' / 'session summary', or context is about to be lost and work needs continuation."
argument-hint: "下一个 session 的工作重点(可选)"
---

<CONTEXT>
Read `core/specs/shared/glossary.md`（确保交接文档术语一致）。
</CONTEXT>

# Handoff

压缩当前会话为结构化交接文档,让下一个 session/agent 零成本接手。

## 文件位置

写到 `~/.claude/tmp/handoff-{YYYYMMDD-HHmm}.md`(目录不存在则先创建)。

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
- **敏感信息脱敏**。API key / token / 密码 / PII / 内网完整 URL → `***REDACTED***`
- **最终输出粘贴提示词**。文档落盘后,在对话里追加一段可直接复制到新窗口的 prompt,形如:
  ```
  接手上个 session,请先读 `~/.claude/tmp/handoff-XXX.md` 了解上下文,然后{一句话工作重点}。
  ```
  路径用实际生成的文件名,工作重点取自用户参数或文档「未完成」首项。
