# Project Knowledge Base

> 项目级编码规范与架构决策。AI 在规划和执行任务前会自动读取。
>
> 权威链：planning 阶段作为参考输入 → 执行阶段以 approved spec/plan 为准 → review 阶段检查实现与知识库的偏差。

## 目录结构

- `{package}/{layer}/index.md` — 某 package 某 layer（frontend / backend）的入口，含 4 段：Overview / Guidelines Index / Pre-Development Checklist / Quality Check
- `{package}/{layer}/*.md` — 具体 code-spec，采用 7 段合约：Scope / Signatures / Contracts / Validation & Error Matrix / Good-Base-Bad Cases / Tests Required / Wrong vs Correct
- `guides/index.md` — 共享思考清单入口（跨 package / 跨 layer 通用）
- `guides/*.md` — 具体 thinking guide
- `local.md` — 项目对 canonical 模板的基线与裁剪记录

## 知识文件索引

| 知识领域 | 文件 | 状态 |
|---------|------|------|
| (To be filled) | `{package}/{layer}/{file}.md` | Draft |

## 使用方式

- `/workflow-plan` 在 Spec 生成时读取本目录下的约定作为 Constraints 输入
- `/workflow-execute` 在任务执行时以 advisory 形式注入项目知识
- `/workflow-review` Stage 1 以人工对照方式检查实现与 code-spec 的一致性

## 更新记录

| 日期 | 变更 | 触发原因 |
|------|------|---------|
