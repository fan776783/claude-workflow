---
name: knowledge-update
description: "显式捕获学到的内容并写入 .claude/knowledge/。触发条件：用户调用 /knowledge-update，或完成一次有沉淀价值的实现/调试/决策后。按 6 类片段模板（Design Decision / Convention / Pattern / Forbidden / Common Mistake / Gotcha）交互式写入 code-spec 或 guide。"
---

# /knowledge-update

显式、用户驱动的 knowledge 沉淀入口。对应 Trellis `update-spec` 的交互式模式。

## 适用时机

| 触发 | 示例 | 目标文件 |
|------|------|----------|
| 实现了特性 | "新加了 template 下载" | `{layer}/{topic}.md` |
| 做了设计决策 | "选 type 字段 + 映射表" | `{layer}/{topic}.md` 的 Design Decisions |
| 修复了 bug | "错误处理有微妙漏洞" | `{layer}/error-handling.md` |
| 发现了模式 | "更好的组织方式" | `{layer}/{topic}.md` |
| 碰到 gotcha | "X 必须先于 Y" | 对应 spec + Common Mistakes |
| 建立了约定 | "命名模式统一" | `{layer}/conventions.md` 或 guides |

## 决策规则（Code-Spec vs Guide）

| 类型 | 位置 | 内容形态 |
|------|------|----------|
| **Code-Spec** | `frontend/*.md`、`backend/*.md` | 签名、契约、错误矩阵、Good/Base/Bad、测试断言、Wrong vs Correct |
| **Guide** | `guides/*.md` | 检查清单 + 指向 code-spec，不重复具体规则 |

问自己：
- "这是**怎么写**代码" → 放 code-spec
- "这是**写代码前想什么**" → 放 guide

**强制 code-spec 深度**的场景（命中任一必须走 7 段契约）：
- 新增 / 变更命令或 API 签名
- 跨层请求/响应契约
- DB schema / migration
- Infra 集成（存储、队列、缓存、secrets、env）

## 6 类片段模板

### 1. Design Decision

```markdown
### Design Decision: {{name}}

**Context**: 当时要解决什么问题？

**Options Considered**:
1. Option A — 简述
2. Option B — 简述

**Decision**: 选择 Option X，因为……

**Example**:
\`\`\`{{lang}}
{{implementation}}
\`\`\`

**Extensibility**: 未来如何扩展。
```

### 2. Convention

```markdown
### Convention: {{name}}

**What**: 约定简述
**Why**: 本项目为何这样做
**Example**:
\`\`\`{{lang}}
{{example}}
\`\`\`
**Related**: 相关约定链接
```

### 3. Pattern

```markdown
### Pattern: {{name}}

**Problem**: 解决什么问题
**Solution**: 简述
**Example**:
\`\`\`{{lang}}
// Good
{{good}}

// Bad
{{bad}}
\`\`\`
**Why**: 为什么更好
```

### 4. Forbidden Pattern

```markdown
### Don't: {{name}}

**Problem**:
\`\`\`{{lang}}
{{bad_code}}
\`\`\`

**Why it's bad**: ……

**Instead**:
\`\`\`{{lang}}
{{good_code}}
\`\`\`
```

> 建议同时在本文件追加 `## Machine-checkable Rules` 小节，写入 `kind: forbid, severity: blocking` 的机读规则，硬卡口才能真正阻塞。

### 5. Common Mistake

```markdown
### Common Mistake: {{description}}

**Symptom**: 出现什么问题
**Cause**: 为什么发生
**Fix**: 如何纠正
**Prevention**: 如何避免
```

### 6. Gotcha

```markdown
> **Warning**: 非显然行为的简述。
>
> 详细：何时发生，如何处理。
```

## 流程

1. 询问用户：
   - 学到了什么？（一句话）
   - 属于哪一类？（6 选 1，或识别为 guide）
   - 属于哪一层？（frontend / backend / guides）
2. 判断目标文件：
   - 若已有相关 code-spec → 追加到对应 section
   - 若无 → 基于 `core/specs/knowledge-templates/code-spec-template.md` 或 `guideline-template.md` 新建
3. 写入前读取目标文件避免重复内容
4. 若涉及 Forbidden Pattern 或 Common Mistake，提示用户："是否同时写入 `## Machine-checkable Rules` 以启用硬卡口？"
5. 写入后更新：
   - 对应层 `index.md` 的文件表状态（Draft → Filled）
   - 根 `index.md` 的更新记录表
   - `local.md` 的 Changelog

## 质量检查（写入前）

- [ ] 内容具体可执行，而非抽象原则
- [ ] 包含代码示例
- [ ] 解释了 WHY（不只是 WHAT）
- [ ] 强制场景下包含 7 段中的所有 section（Signatures / Contracts / Validation / Cases / Tests / Wrong vs Correct）
- [ ] 位置正确（code-spec vs guide）
- [ ] 不重复已有内容

## 用法

```
/knowledge-update             # 交互式走完整流程
```

## 与其他命令的关系

- 执行前建议先 `/knowledge-bootstrap` 确保骨架存在
- 写入后建议 `/knowledge-check` 在当前 diff 上预演一下，看新规则是否生效
- `/knowledge-review` 定期汇总本次新增的 code-spec 是否存在重复或冲突
