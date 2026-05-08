# Manual Intervention Reasons

修复 / review / 批处理workflow中 `manual_intervention` 的 reason 枚举。fix-bug、bug-batch、workflow-review 共用此表，不各自维护。

## 含义

命中任何一条 reason：
- 不触发状态流转（`status_transition_ready` 强制为 `false`）
- 在最终摘要里填 `manual_intervention_reason`
- 在 `residual_risks` 里说明后续需要人工介入的方向
- 已在上游阶段（如 fix-bug Phase 3.3 进入"处理中"）推进的状态保留不回滚，让人工介入者能看到代码落地进度

## 枚举

### root_cause_mismatch
**触发点**: fix-bug Phase 1.4 / diagnose Phase 3 — 主假设 + 备选假设均被证伪
**后续动作**: 重新审视module架构设计 / 切分修复范围 / 重新走 Phase 1 假设阶段

### verification_failed
**触发点**: fix-bug Phase 3 / bug-batch Phase 5 — 修复后验证连续 3 次失败
**后续动作**: 问题可能不在表层，建议重新审视架构设计 / 拆小问题重跑

### out_of_scope
**触发点**: fix-bug Phase 3 / bug-batch Phase 5 — 实际改动超出 Phase 2 已确认的文件范围
**后续动作**: 停下来让用户决定是否新开一次修复 / 扩展范围后重跑

### review_rejected
**触发点**: fix-bug Phase 4 / bug-batch Phase 6 — review发现 P0 / P1 问题
**后续动作**: 按review意见修改 / 用户评估是否让位 human reviewer

### user_rejected
**触发点**: fix-bug Phase 2.2 Hard Stop / bug-batch FixUnit 编排 Hard Stop — 用户选择 reject
**后续动作**: workflow终止；用户可能要重新整理需求或拆分任务

### materialization_failed
**触发点**: bug-batch Phase 4 — FixUnit 落地脚本执行失败（文件无法创建 / 权限问题 / git 状态冲突）
**后续动作**: 检查环境（磁盘 / 权限 / 未提交的本地改动）

### cross_unit_conflict
**触发点**: bug-batch Phase 5 — 并行修复的 FixUnit 写入同一文件 / 同一 config
**后续动作**: 回到 Phase 4 重新编排，把冲突单元改为串行

### ambiguous_empty_change
**触发点**: bug-batch Phase 5 — FixUnit 执行后 `git diff` 为空，但未标记为 covered_by_other
**后续动作**: 重新验证问题描述 / 复核根因是否在其他 layer

### cover_unit_failed
**触发点**: bug-batch Phase 6 — 某个 `covered_by_unit` 指向的主单元未通过review，导致依赖它的重复缺陷无法自动流转
**后续动作**: 主单元重审后重跑依赖单元的流转，或手动流转

## 使用方式

Skill SKILL.md 里引用本表而非复写。示例：

```markdown
### 1.9 Manual Intervention Reasons

本 skill 可能命中的 reason（子集）：`root_cause_mismatch` / `verification_failed` / `out_of_scope` / `review_rejected` / `user_rejected`。

完整定义见 `core/specs/shared/manual-intervention-reasons.md`。
```

## 扩展

新增 reason 前先问自己：
- 是不是上表已有 reason 的特例？（倾向于复用）
- 是不是单个 skill 的一次性边界？（用 skill 内部 tag，而非入表）
- 触发点 / 后续动作是否对跨 skill 使用者有意义？（是则入表）

入表要同时更新 fix-bug / bug-batch 的引用段落，保持 skill 侧 reason 子集的完整性。
