# Delta 安全检查清单

> 在变更确认（Hard Stop）前，逐项检查以下内容。

## 占位路径检测

- [ ] 检查所有 `tasksToAdd` 中的 `files` 字段
- [ ] 若包含 `__PLACEHOLDER__` 前缀路径，用 ⚠️ 高亮标注
- [ ] 要求用户提供真实路径后才可应用

## 已完成任务回归风险

- [ ] 检查 `tasksToModify` / `tasksToRemove` 中是否涉及已完成任务
- [ ] 已完成任务被修改/废弃时用 ⚠️ 标注回归风险
- [ ] 风险等级自动提升为 `high`

## 变更完整性

- [ ] 每个新增任务包含：id、name、phase、files、steps、verification
- [ ] 修改任务有 before/after 对比
- [ ] 废弃任务有明确理由

## 审计链验证

- [ ] `delta.json` 已写入变更目录
- [ ] `intent.md` 已写入变更目录
- [ ] `review-status.json` 已写入变更目录
- [ ] 以上文件在状态变更前完成写入（先审计后生效）
