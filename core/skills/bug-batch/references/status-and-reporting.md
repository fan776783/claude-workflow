# 状态流转与汇总模板

## 1. Review 汇总（Phase 6 完成后）

```markdown
## 分层 review 汇总

### 单元级 review
| FixUnit | 修改文件 | 结论 | 主要发现 |
|---------|---------|------|---------|
| FU-001 | auth.ts, session-store.ts | 通过 | - |
| FU-002 | api-client.ts | 通过 | - |
| FU-003 | token-refresh.ts | 不通过 | P1: 并发场景未覆盖 |

### 跨单元交叉影响
- 文件交集: <有/无>
- 项目级测试: <通过/失败>
- 结论: <无交叉 / 兼容性问题 / 严重冲突>
```

## 2. 单元流转示例

```text
update_issue_state(
  issue_number: "p003",
  target_state: "处理中",
  comment: "FixUnit FU-001 已完成修复与验证"
)
```

## 3. 全量确认

### Happy path（自动通过）

```markdown
## 全量确认：全部通过，自动进入重建

| FixUnit | 覆盖缺陷 | stage commit | 修改文件 | review |
|---------|----------|-------------|----------|--------|
| FU-001 | p003,p001,p002 | 6c20909f5 | auth.ts | 通过 |
| FU-002 | p004 | e136d009e | api-client.ts | 通过 |
```

### 存在异常（触发 `[HARD-STOP:CONFIRM-COMMIT]`）

```markdown
## 批量修复完成，等待确认

| FixUnit | 覆盖缺陷 | 状态 | 蓝鲸状态 | 根因摘要 | 修改文件 |
|---------|----------|------|----------|----------|----------|
| FU-001 | p003,p001,p002 | completed | 处理中 | token 刷新失效 | auth.ts |
| FU-003 | p005,p006 | manual_intervention | 待处理 | 需重新评估 | - |

### 待提交范围
- 提交: FU-001, FU-002
- 不纳入: FU-003（人工介入）

确认后提交 Commit 并流转到待验证？
```

## 4. 汇总报告（Phase 8）

```markdown
## 批量修复报告

### 统计
- 总单元: N | 已修复: X | 无需修改: A | 被覆盖: B | 人工介入: Y | 阻塞: Z

### FixUnit 视图
| FixUnit | 主缺陷 | 覆盖缺陷 | 状态 | 原因 | 修改文件 | 待介入资产 |
|---------|--------|----------|------|------|----------|-----------|
| FU-001 | p003 | p003,p001,p002 | completed | - | auth.ts | - |
| FU-003 | p005 | p005,p006 | manual_intervention | review_rejected | - | worktree: .../FU-003 |

### Issue 视图
| 工单号 | 所属单元 | 角色 | 最终状态 | 说明 |
|--------|----------|------|---------|------|
| p003 | FU-001 | 主缺陷 | 待验证 | 直接修复 |
| p002 | FU-001 | 重复缺陷 | 待验证 | 继承修复 |
| p005 | FU-003 | 主缺陷 | 待处理 | 需人工接手 |

### Commit
fix: p003 p001 p002 p004 修复了登录态刷新失效和接口超时问题

### 待人工处理
- FU-003 / p005,p006: review 不通过，worktree 保留

### Code Specs 归纳
- 跨单元 spec gap: <路径及 FU，或 "无">
- 建议沉淀: <路径 + 草案，或 "无">
```
