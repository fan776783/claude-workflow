# Codex Plan Review（Phase 2.5.5）

> bounded-autofix 模式：Codex 发现经验证后，当前模型可自动修复 Plan。

## 前置条件

- Step 7 Plan Self-Review 已完成
- `context_injection.planning.codex_plan_review.triggered = true`

## 调用方式

使用 `task --read-only` 模式：

```bash
node ~/.agents/agent-workflow/core/skills/collaborating-with-codex/scripts/codex-bridge.mjs \
  task --read-only \
  --cd "{projectRoot}" \
  --prompt "You are reviewing an implementation plan. Read the plan file at {planPath} and the spec at {specPath}. Evaluate:
    1. Implementation order - are task dependencies correct?
    2. Technical approach - will the proposed patterns actually work?
    3. Missing steps - implicit steps not called out (migrations, config, env)?
    4. Error handling gaps - what failure modes are not addressed?
    5. Integration risks - conflicts with existing code paths?
    6. Test coverage - are proposed tests sufficient?

    HARD CONSTRAINTS:
    (1) Ignore hypothetical scenarios without a concrete code path or caller — trust internal code with known shape.
    (2) Do not propose spec-scope changes, new features, or cleanup outside the plan's stated tasks.
    (3) Report only critical/important findings; collapse all minor items into a single advisory line, do not expand.

    Output ONLY candidate issues. Each issue:
    - task_ref: which task (e.g. T3)
    - severity: critical | important | minor
    - description: what the risk is
    - suggestion: how to fix the plan"
```

## 执行流程

1. 调用 codex-bridge.mjs，记录开始时间
2. **Codex 调用失败** → 输出 `⚠️ Codex Plan Review: degraded`，直接进入 `planned` 状态
3. **Codex 调用成功** → 解析候选问题
4. 当前模型验证每个候选问题：
   - task_ref 对应的 task 是否存在
   - 问题是否与 plan 实际内容对应
   - 建议是否技术可行
5. **verified critical/important** → 当前模型修复 Plan → 重跑 Plan Self-Review
6. **所有 minor 或无 verified issues** → 直接进入 `planned` 状态

## 预算规则

- `max_attempts = 2`（1 次 Codex 审查 + 最多 1 次修复后复审）
- Provider 失败不消耗 revision 预算，立即降级
- 只有 revision loop（修复 → 复审）消耗预算
- 预算耗尽后直接进入 `planned`，不阻塞流程

## 自动修复范围

允许修复的内容：
- 调整 task 执行顺序
- 补充遗漏的步骤（migration、config 等）
- 补充 error handling 代码
- 修正 task 间的类型/函数名不一致

不允许修改的内容：
- Spec 范围（scope、requirements）
- 架构决策（Architecture 章节对应的技术选型）
- 验收标准（Acceptance Criteria）

超出允许范围的 Codex 建议 → 标记为建议，写入状态但不执行，由后续 Step 8 输出供参考。

## 状态更新

```bash
review_status.codex_plan_review = {
  status: 'completed',
  codex_status: 'success',
  attempt: 1,
  issues_found: N,
  issues: [ ... verified findings ... ],
  session_id: '{from response}',
  timing_ms: {elapsed},
  reviewed_at: '{ISO timestamp}'
}
```

## 降级规则

与 Codex Spec Review 一致：先调用再降级，不预判可用性。
