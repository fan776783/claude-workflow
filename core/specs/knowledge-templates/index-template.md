# Project Knowledge Base

> 项目级编码规范与架构决策。AI 在规划和执行任务前会自动读取。
>
> 权威链：planning 阶段作为参考输入 → 执行阶段以 approved spec/plan 为准 → review 阶段检查实现与知识库的偏差。

## 知识文件索引

| 知识领域 | 文件 | 状态 |
|---------|------|------|
| (To be filled) | | Draft |

## 使用方式

- `/workflow-plan` 在 Spec 生成时读取本目录下的约定作为 Constraints 输入
- `/workflow-execute` 在任务执行时以 advisory 形式注入项目知识
- `/workflow-review` Stage 1 检查实现与本目录约定的一致性

## 更新记录

| 日期 | 变更 | 触发原因 |
|------|------|---------|
