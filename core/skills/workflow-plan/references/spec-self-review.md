# Spec Self-Review 检查项

> 生成 Spec 后立即执行。发现问题直接修复，无需重审。
> 此 Self-Review 与执行阶段的「Spec 合规审查（子 Agent）」不同：Self-Review 为内联自检，聚焦 Spec 文档本身的完整性和一致性。

## 必检项

### 1. PRD 原文回溯扫描

将 PRD 原文按标题层级 + 列表项拆为语义段落，逐段检查 Spec 是否覆盖。

**重点关注的高风险段落**：
- 包含**精确值**的段落（数字、公式、枚举、"最多N个"）— 数字必须在 Spec 中原样保留
- 包含**否定约束**的段落（"不支持"、"禁用"、"不可"）— 否定语义不得被遗漏
- 包含**联动关系**的段落（"根据...拉取"、"条件展示"）— 联动逻辑不得被简化
- 包含**改造指令**的段落（"改名为"、"替换"、"重命名"）— 改造细节不得被概括

**覆盖率目标 ≥ 90%**。低于阈值时，将 partial/uncovered 段落追加到 §9 Open Questions。

### 2. Placeholder 扫描

搜索以下占位符并替换为实际内容：
- "TBD"、"TODO"、"待补充"、"待确认"
- 空的章节或未填写的模板变量

### 3. 内部一致性

- Architecture 章节中的模块划分是否与 User-facing Behavior 的操作路径一致
- File Structure 是否与 Architecture 的模块对应

### 4. 约束完整性

- 需求中的硬约束（字段名、数量限制、条件分支等）是否都在 §3 Constraints 出现
- 讨论阶段确认的技术决策是否体现在 Architecture 中

### 5. UX 一致性（仅当有 UX 设计工件时）

- 流程图中的每个步骤是否在 §4 User-facing Behavior 有对应描述
- 页面分层中单个页面不超过 4 个独立功能模块

### 6. 首次使用体验

- 涉及工作区/初始化/应用安装等概念时，是否有首次使用引导描述

## 持久化

覆盖率报告写入 `prd-spec-coverage.json`，供 Step 6 User Spec Review 展示。

> 工件结构参见 [`artifact-schemas.md`](artifact-schemas.md) § prd-spec-coverage.json
