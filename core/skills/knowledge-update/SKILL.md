---
name: knowledge-update
description: "显式捕获学到的内容并写入 .claude/knowledge/。触发条件：用户调用 /knowledge-update，或完成一次有沉淀价值的实现/调试/决策后。按 7 段 code-spec 合约或 thinking guide 形态交互式写入。"
---

# /knowledge-update

显式、用户驱动的 knowledge 沉淀入口。对齐 Trellis `update-spec` 的交互式模式。

## 适用时机

| 触发 | 示例 | 目标 |
|------|------|------|
| 实现了新特性 | "新加了 template 下载" | `{pkg}/{layer}/{topic}.md`（7 段 code-spec） |
| 跨层协作决策 | "前后端字段命名映射表" | 对应 code-spec 的 Contracts + guides 的指针 |
| 修复了 bug | "错误处理的微妙漏洞" | 对应 code-spec 的 Validation & Error Matrix + Wrong vs Correct |
| 发现了新模式 | "更好的组织方式" | `{pkg}/{layer}/{topic}.md`（7 段） |
| 碰到 gotcha | "X 必须先于 Y" | 若是"怎么写"→ code-spec；若是"写之前想什么"→ guides |
| 建立了约定 | "命名模式统一" | `{pkg}/{layer}/conventions.md`（7 段） |

## 决策规则（Code-Spec vs Guide）

| 类型 | 位置 | 内容形态 |
|------|------|----------|
| **Code-Spec** | `{pkg}/{layer}/*.md` | 7 段合约：Scope / Signatures / Contracts / Validation & Error Matrix / Good-Base-Bad Cases / Tests Required / Wrong vs Correct |
| **Guide** | `guides/*.md` | 思考清单 + 指向 code-spec 的指针，不重复具体规则 |

问自己：

- "这是**怎么写**代码" → code-spec（7 段）
- "这是**写代码前想什么**" → guide（thinking 清单）

不确定时优先 code-spec；guides 保持精简。

## 7 段 code-spec 结构

新增 `{pkg}/{layer}/*.md` 时基于 `core/specs/knowledge-templates/code-spec-template.md` 渲染，每段必填：

1. **Scope / Trigger** — 什么样的变更触发本 spec + 具体 file glob
2. **Signatures** — 具体**文件路径** + **命令名 / API 名 / 数据库表名**；占位符必须替换为真实值
3. **Contracts** — 字段级清单（字段名 + 类型 + 必需性），不要写"返回 JSON"之类笼统描述
4. **Validation & Error Matrix** — 输入条件 → 错误码 / 行为 / 错误消息
5. **Good / Base / Bad Cases** — 三案例（场景 + 代码片段）
6. **Tests Required** — 具体到**测试文件 + 测试名 + 断言内容**
7. **Wrong vs Correct** — 至少一对 bad → good 对比

任一段留为占位符或抽象描述 → `/knowledge-review` 的 7 段 lint 会标记为未完成。

## 流程

1. 询问用户：
   - 学到了什么？（一句话）

1.5. **分类（对齐 Trellis `$update-spec`）**：在进入 package/layer 决策前，先问一次类型——这决定落盘段落的语义标签，不改 7 段结构。

   | 类别 | 关键问题 | 常见落点 |
   |------|---------|---------|
   | Design Decision | 为什么选 X 而不是 Y？ | code-spec Section 1 Scope 的补充段落 |
   | Convention | 本项目怎么做 X？ | code-spec 对应段落 / `conventions.md` |
   | Pattern | 一种可复用方式 | 新建 code-spec 文件（走 7 段） |
   | Forbidden | 不应该这样做 | code-spec Section 7 Wrong vs Correct（Wrong 侧） |
   | Common Mistake | 容易犯的错 | code-spec Section 4 Validation & Error Matrix |
   | Gotcha | 非显然行为 | code-spec Section 1 Trigger 注释或 Section 4 |

   表格里的"常见落点"是**指引**，不是硬绑定；遇到不合适的放置时优先保持 code-spec 可读性，类别语义通过段落首行标注保留。

2. 询问：
   - 属于哪个 package / layer？（若 monorepo，列出可选 packages；若单包，默认 `{project-name}`）
   - 是 code-spec 还是 thinking guide？
2. 判断目标文件：
   - 已有同主题 code-spec → 追加到对应 section（例如 Validation & Error Matrix 新增一行）
   - 无 → 基于 `code-spec-template.md` 或 `guide-template.md` 新建
3. 写入前 Read 目标文件避免重复
4. 若为 code-spec → 逐段引导用户填入：
   - 强制追问"具体文件路径是什么"、"API 名是什么"、"字段名列表是什么"、"断言在哪个测试文件的哪个 test case"——拒绝只填抽象描述
5. 若为 guide → 填入 Thinking Triggers + Pre-Development Checklist + 指向的 code-spec 链接
6. **段落标注**：新增或追加的段落首行追加一行元数据：

   ```
   > Update type: {Design Decision|Convention|Pattern|Forbidden|Common Mistake|Gotcha}
   ```

   不改 7 段 lint（`/knowledge-review` 不依赖此标注），仅用于阅读时快速识别语义。

7. 写入后更新：
   - 对应 `{pkg}/{layer}/index.md` 的 Guidelines Index 表
   - 根 `index.md` 的更新记录
   - `local.md` 的 Changelog（含 `Type` 列）

## 质量检查（写入前）

- [ ] code-spec 的 7 段是否全部有具体内容（非占位符 / 非抽象描述）
- [ ] Signatures 含具体文件路径和名称
- [ ] Contracts 是字段级清单
- [ ] Tests Required 指向具体测试文件和 test case
- [ ] Wrong vs Correct 至少一对对比
- [ ] 位置正确（code-spec vs guide）
- [ ] 不重复已有内容

## 用法

```
/knowledge-update             # 交互式走完整流程
```

## 与其他命令的关系

- 执行前建议先 `/knowledge-bootstrap` 确保骨架存在
- 写入后建议 `/knowledge-review` 跑一次 7 段 lint，确认所有段都填充完整
- 不再有机读规则 / 硬卡口；约束靠 code-spec 的声明式内容 + review 阶段的人工对照
