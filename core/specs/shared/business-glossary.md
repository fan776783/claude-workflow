# Business Glossary（协议文档）

> 本文件是**发行物模板 + 协议说明**，说明业务词表长什么样。
> 项目级词表写在 `.claude/code-specs/shared/business-glossary.md`（按需创建，不强制）。
> Inspired by mattpocock/skills 的 `CONTEXT.md` — 给**业务领域**也上一层 ubiquitous language，与 `glossary.md`（框架架构层）分开管理。

## Scope

- **本发行物文件**：协议定义，**不**参与 `scripts/validate.js` 的 glossary-drift lint
- **项目级同名文件** `.claude/code-specs/shared/business-glossary.md`：记录实际业务术语；通过 `/spec-update` 维护；`/spec-review` 扫一致性作为 advisory
- **消费者**：
  - `workflow-plan`：Spec § 1 Context / § 4 User-facing Behavior / § 5 Architecture 扩写时推荐使用 canonical 业务术语
  - `fix-bug`：Phase 1 检索时比对代码与词表，发现漂移 → 进入 `code_specs_advisory`
  - `spec-update`：写入 / 追加业务术语的入口（走现有 convention / contract 分流逻辑）

## 与 `glossary.md` 的职责划分

| 维度 | `glossary.md`（框架层） | `business-glossary.md`（业务层） |
|------|------------------------|--------------------------------|
| 内容 | `workflow` / `skill` / `layer` / `module` 等框架术语 | 项目自己的业务词（订单、投放、计费等） |
| 位置 | 发行物唯一文件 | 发行物协议 + 项目级产物双层 |
| 参与 lint | 是（强制 forbidden synonyms 校验） | 否（advisory） |
| 演化频率 | 极低 | 跟随业务需求演化 |

## 术语格式

每个术语块必须含：**Definition**（一句话 IS，不写 DOES）+ **Forbidden synonyms**（显式列禁用词）+ 可选 **Why** + 可选 **See**。

```md
### {Term}
**Definition**: <一句话说 IS，不写 DOES>
**Forbidden synonyms**: `同义词1`, `同义词2`
**Why**: <为什么这个词是 canonical，通常是歧义记录>
**See**: <指向相关 code-spec 或代码路径>
```

## 核心原则

- **Be opinionated**：同义词必须选一个主词，其它全部列为 Forbidden（不允许并列）
- **Flag ambiguities**：曾被歧义使用过的词，在文件末尾 `## Flagged ambiguities` 段写清 resolution
- **只收业务词**：通用编程概念（cache / timeout / retry / request）**不进**；入选判据是"这个词在业务会议上会被 domain expert 说出来"
- **就地落盘**：讨论 / grilling / bug 分析中出现新业务词 → 立即追加到项目级文件，**不批处理**
- **一句定义**：Definition 只说"是什么"，不写"做什么 / 如何用"——后者属于 code-spec 的 convention / contract

## 项目级文件推荐结构

项目级 `.claude/code-specs/shared/business-glossary.md` 至少包含：

```md
# {项目名} Business Glossary

{一两句描述项目领域、这份词表为什么存在}

## Terms

### {术语 1}
...

### {术语 2}
...

## Relationships

- A **{术语}** 产生 / 包含 / 引用 一个或多个 **{其它术语}**
- ...

## Flagged ambiguities

- "{曾有歧义的词}" 曾被用来指 **{术语 A}** 和 **{术语 B}** — resolved: 这是两个不同概念。
```

## 更新协议

- 在 Spec 讨论 / Phase 1 根因分析 / review 反馈中发现新业务词 → 立即通过 `/spec-update` 追加到项目级 `business-glossary.md`
- 发现代码 / 文档 / PR 正文使用了 Forbidden synonym → 在 advisory 里标记，不阻塞 workflow
- 更新模式遵循 `spec-update` 的"基础更新 / 深度更新"两档

## 与 ADR 的关系

业务术语是"词"，ADR 是"决策"。二者互补：
- 词被"命名"成这样 → 进 `business-glossary.md`
- 为什么这么命名有深层 trade-off → 如命中 [ADR 三重门槛](./adr-protocol.md) → 另立 ADR
