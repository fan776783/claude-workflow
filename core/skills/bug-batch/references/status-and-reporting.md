# 状态流转与汇总模板

`bug-batch` 在每个 `FixUnit` 完成单元级 review + 物化 + 存在实际代码修改后，立即把该单元覆盖缺陷推进到 `处理中`；全量确认并提交 Commit 后再批量推进到 `待验证`。此文件沉淀状态流转示例和最终汇总模板。

## 0. 分层 review 汇总（Phase 5.5 完成后展示）

```markdown
## 分层 review 汇总

### 单元级 review 结果（主会话直接审查，不调用 codex）
| FixUnit | 修改文件 | 结论 | 主要发现 |
|---------|---------|------|---------|
| FU-001 | auth.ts, session-store.ts | 通过 | 无重大问题 |
| FU-002 | api-client.ts | 通过 | 无重大问题 |
| FU-003 | token-refresh.ts | 不通过 | P1: token 刷新未覆盖并发场景 |

### 批量级 review 结论
- 影响评估: <文件交集 / 共享依赖 / 敏感面命中情况>
- 建议: recommended / optional / skip
- 用户决定: Y / N
- 执行方式: codex 同步 / codex 后台（jobId: <jobId>）/ 主会话直接审查
- 跨单元冲突: 无 / 存在（详见下方）
- 整体结论: 通过 / 不通过

### 影响决策
- FU-003 → manual_intervention (review_rejected)，移出本轮提交
- FU-001、FU-002、FU-004 → 正常推进 Phase 6
```

## 1. 跨单元交叉影响分析

所有 FixUnit 修复完成并完成结果物化后、批量流转前展示：

```markdown
## 跨单元交叉影响分析

### 主线已物化单元
| FixUnit | 物化方式 | 结果 |
|---------|----------|------|
| FU-001 | cherry-pick | 已落地到协调分支 |
| FU-002 | apply patch | 已落地到协调分支 |
| FU-003 | - | 未落地，转人工介入 |

### 文件修改汇总
| FixUnit | 修改文件 |
|---------|----------|
| FU-001 | auth.ts, session-store.ts |
| FU-002 | api-client.ts |

### 交叉影响检测
| 来源 | 目标 | 交集文件 | 影响判定 |
|------|------|----------|----------|
| FU-001 | FU-002 | - | 无交叉影响 |

### 项目级验证
- 测试命令: `npm test`
- 结果: 通过 / 失败（附失败项）

### 结论
- FU-001 与 FU-002：无交叉影响
- FU-003：未物化到协调分支，不纳入本轮交叉影响分析与后续提交
- 整体回归验证：通过
```

## 2. 单元即时流转到处理中

流转前置条件、判定规则、失败级联见 SKILL.md Phase 5.5.3 与 `references/coverage-graph.md`。下面只提供展示模板。

**单元流转调用示例**：

```text
update_issue_state(
  issue_number: "p003",
  target_state: "处理中",
  comment: "FixUnit FU-001 已完成代码修复与验证，等待全量确认"
)
```

**单元流转汇总展示**：

```markdown
## 单元即时流转结果

| FixUnit | 覆盖缺陷 | files_changed | 状态 | 流转结果 | 说明 |
|---------|----------|---------------|------|----------|------|
| FU-001 | p003, p001, p002 | auth.ts, session-store.ts | completed | 已流转处理中 | - |
| FU-002 | p004 | api-client.ts | completed | 已流转处理中 | - |
| FU-004 | p008 | - | no_change_needed | 未流转 | 根因不存在，建议人工确认后关闭 |
| FU-005 | p009 | - | covered_by_other | 未流转 | covered_by_unit: FU-001 |
| FU-006 | p010 | - | manual_intervention | 未流转 | reason: ambiguous_empty_change |
```

## 3. 全量确认卡点

全量确认分两种路径，根据批次状态自动选择。

### 3a. Happy path（自动通过）

当所有已物化 FixUnit 状态均为 `completed` 且无未修复 P0/P1 findings 时，跳过 Hard Stop，直接输出汇总后进入 commit 重建：

```markdown
## 全量确认：全部通过，自动进入重建

### FixUnit 修复汇总

| FixUnit | 覆盖缺陷 | stage commit | 修改文件 | 单元级 review | 批量 review |
|---------|----------|-------------|----------|-------------|------------|
| FU-001 | p003,p001,p002 | 6c20909f5 | auth.ts, session-store.ts | 通过 | 通过 |
| FU-002 | p004 | e136d009e | api-client.ts | 通过 | 通过 |
```

### 3b. 存在异常单元（触发 `[HARD-STOP:CONFIRM-COMMIT]`）

当存在 `manual_intervention` / `no_change_needed` / `covered_by_other` 单元，或有未修复 P0/P1 时，展示完整汇总并等待用户确认：

```markdown
## 批量修复已完成，等待全量确认

### FixUnit 修复汇总

| FixUnit | 主缺陷 | 覆盖缺陷 | 重复缺陷 | 状态 | 当前蓝鲸状态 | 根因摘要 | 修改文件 | 剩余风险 |
|---------|--------|----------|----------|------|-------------|----------|----------|----------|
| FU-001 | p003 | p003,p001 | p002 | 已修复 | 处理中 | token 刷新链路失效 | auth.ts, session-store.ts | 低 |
| FU-002 | p004 | p004 | - | 已修复 | 处理中 | 接口超时未重试 | api-client.ts | 低 |
| FU-003 | p005 | p005 | p006 | 人工介入 | 待处理 | 根因需重新评估 | - | - |
| FU-004 | p008 | p008 | - | 无需修改 | 待处理 | 根因已不存在 | - | - |

### 待提交范围
- 本次提交仅包含: FU-001, FU-002（已在”处理中”，Commit 后流转到”待验证”）
- 不纳入本次提交: FU-003（人工介入，保持当前状态），FU-004（无实际修改，建议关闭）

### 建议人工验证
- FU-001: 验证主流程登录刷新，验证历史重复问题 p002 是否一并消失
- FU-002: 验证接口超时重试逻辑
- FU-003: 需人工重新评估根因后再处理

## 是否确认以上已修复的 FixUnit 可以提交 Commit 并流转到待验证？(Y/N)
```

## 4. 提交 Commit

重建流程、commit message 格式与示例见 `references/commit-rebuild.md` 第 2、4 节。

## 5. 批量流转到待验证

Commit 完成后，仅对实际纳入 commit 的 issue 统一流转：

```text
batch_update_issue_states(
  issue_numbers: ["p003", "p001", "p002", "p004"],
  target_state: "待验证",
  comment: "批量修复已全量确认并提交 Commit，进入待验证"
)
```

## 6. 批量汇总报告

```markdown
## 批量修复报告

### 修复单元统计
- 总单元数: N
- 成功完成并流转待验证: X
- 无需修改 (no_change_needed): A
- 已被其他单元覆盖 (covered_by_other): B
- 人工介入 (manual_intervention): Y
- 阻塞未执行 (blocked): Z

### FixUnit 视图
| FixUnit | 主缺陷 | 覆盖缺陷 | 状态 | 原因 | 修改文件 | 根因摘要 | 待介入资产 |
|---------|--------|----------|------|------|----------|----------|-----------|
| FU-001 | p003 | p003,p001,p002 | completed | - | auth.ts | token 刷新链路失效 | - |
| FU-002 | p004 | p004 | completed | - | api-client.ts | 接口超时未重试 | - |
| FU-003 | p005 | p005,p006 | manual_intervention | review_rejected | token-refresh.ts | 并发场景未覆盖 | worktree: ../bug-batch-worktrees/FU-003, 分支: fix/FU-003 |
| FU-004 | p008 | p008 | no_change_needed | - | - | 根因已不存在 | - |
| FU-005 | p009 | p009 | covered_by_other | covered_by_unit: FU-001 | - | 同根因已修复 | - |

### Issue 视图
| 工单号 | 所属单元 | 角色 | 最终蓝鲸状态 | 说明 |
|--------|----------|------|-------------|------|
| p003 | FU-001 | 主缺陷 | 待验证 | 直接修复 |
| p001 | FU-001 | 关联缺陷 | 待验证 | 共享根因一并覆盖 |
| p002 | FU-001 | 重复缺陷 | 待验证 | 继承主修复结果 |
| p004 | FU-002 | 主缺陷 | 待验证 | 接口超时重试已修复 |
| p009 | FU-005 (covered by FU-001) | 被覆盖主缺陷 | 待验证 | 随 FU-001 一起流转 |
| p005 | FU-003 | 主缺陷 | 待处理 | 单元级 review 不通过，需人工接手 |
| p008 | FU-004 | 主缺陷 | 待处理 | 建议人工确认后关闭 |

### Commit 信息
fix: p003 p001 p002 p004 修复了登录态刷新失效和接口超时问题

### 待人工处理项
- FU-003 / p005,p006: review 不通过，worktree 保留在 ../bug-batch-worktrees/FU-003，分支 fix/FU-003
- FU-004 / p008: 根因已不存在，请人工确认后关闭缺陷

### Code Specs 归纳

- 跨单元命中 Common Mistake: <`{file}.md § {H3 子标题}` 及涉及 FU，或 "无">
- 跨单元 spec gap: <`{file}.md` 及涉及 FU，或 "无">
- 建议沉淀的 spec 条目: <路径 + 草案一句话，或 "无">
```
