# 分析与编排输出模板

Phase 3-4 向用户展示的统一模板。

## 1. 缺陷分析视图

```markdown
| 工单号 | 优先级 | 根因初判 | 确信度 | 证据 | 模块 | 关系结论 | 建议 |
|--------|--------|----------|--------|------|------|----------|------|
| p001 | HIGH | 登录态未同步 | ✅ high | auth/store.ts:42 token 赋值缺失 | auth/store | same_root_cause -> p003 | 合并处理 |
| p002 | 中 | 与 p001 复现路径一致 | ✅ high | 同 p001 | auth/store | duplicate_of -> p001 | 归并 |
| p005 | 中 | 列表加载异常 | ⚠️ medium | api/list.ts:120 可疑 | list/api | primary | 待验证 |
| p006 | LOW | "页面白屏" | ❌ low | 无复现/日志/截图 | unknown | needs_manual_judgement | 补充信息 |
```

确信度：✅ high = 已定位问题点；⚠️ medium = 可疑区域；❌ low = 无法对应。

## 2. 缺陷关系矩阵

```markdown
| 来源 | 目标 | 关系 | 证据摘要 |
|------|------|------|----------|
| p002 | p001 | duplicate_of | 相同复现路径与报错日志 |
| p001 | p003 | same_root_cause | 同一 token 刷新链路 |
| p004 | p003 | blocked_by | 需上游接口先恢复 |
```

## 3. 修复单元编排结果

```markdown
| FixUnit | 主缺陷 | 覆盖缺陷 | 重复缺陷 | 依赖 | 确信度 | 根因摘要 |
|---------|--------|----------|----------|------|--------|----------|
| FU-001 | p003 | p003,p001 | p002 | - | ✅ high | token 刷新失效 |
| FU-002 | p004 | p004 | - | FU-001 | ⚠️ medium | 依赖登录态恢复 |
| FU-003 | p006 | p006 | - | - | ❌ low | 无法定位 — needs_manual_judgement |
```

## 4. 批量澄清区

存在 `clarification_needed` 的 issue 时展示：

```markdown
## 需要补充信息的缺陷

| 工单号 | 确信度 | 问题 | 有帮助的补充 |
|--------|--------|------|-------------|
| p006 | ❌ low | "页面白屏"——全白还是部分组件缺失？哪个路由？ | 复现步骤 / 控制台截图 / URL |
| p008 | ⚠️ medium | "提交失败"——接口 500 还是前端校验？ | 网络面板截图 / toast 文案 |
```

## 5. Task 树预览

```markdown
Layer 0（立即并行）：
- fix:FU-001（p003，src/auth/）
- fix:FU-003（p007，src/api/）

Layer 1（Layer 0 完成后）：
- fix:FU-002（p004，blockedBy: FU-001，src/session/）
```
