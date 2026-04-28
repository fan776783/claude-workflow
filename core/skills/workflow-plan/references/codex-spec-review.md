# Codex Spec Review（Phase 1.2.5）

> advisory-to-human 模式：Codex 发现写入状态供 Step 6 展示，不自动修改 Spec。

## 前置条件

- Step 5 Spec Self-Review 已完成
- `context_injection.planning.codex_spec_review.triggered = true`

## 调用方式

使用 `task --read-only` 模式（文档审查，非 diff 审查）：

```bash
node ~/.agents/agent-workflow/core/skills/collaborating-with-codex/scripts/codex-bridge.mjs \
  task --read-only \
  --cd "{projectRoot}" \
  --prompt "You are reviewing a specification document. Read the spec file at {specPath} and evaluate:
    1. Architecture feasibility - can this design be implemented as described?
    2. API contract completeness - missing error cases, edge conditions, data validation
    3. Security gaps - auth boundaries, trust assumptions, data exposure
    4. Performance risks - N+1 queries, unbounded lists, missing pagination
    5. Data model issues - schema design, migration safety, constraint coverage
    6. Cross-cutting concerns - caching strategy, concurrency, state consistency

    HARD CONSTRAINTS:
    (1) Ignore hypothetical scenarios without a concrete code path or caller implied by the spec.
    (2) Do not propose scope expansion, new features, or concerns outside the spec's stated requirements.
    (3) Report only critical/important findings; collapse all minor items into a single advisory line, do not expand.

    Output ONLY candidate issues as structured list. Each issue:
    - spec_section: which section of the spec
    - severity: critical | important | minor
    - description: what the risk is
    - suggestion: how to revise the spec"
```

## 执行流程

1. 调用 codex-bridge.mjs，记录开始时间
2. **Codex 调用失败** → 输出 `⚠️ Codex Spec Review: degraded (原因)`，更新状态为 `degraded`，直接进入 Step 6（不消耗预算）
3. **Codex 调用成功** → 解析 `agentMessages` 提取候选问题
4. 当前模型验证每个候选问题：
   - 问题是否与当前 spec 内容对应（非幻觉）
   - 问题是否适用于当前项目架构
   - 排除风格偏好和过度防御性建议
5. 验证后的发现写入 `review_status.codex_spec_review`
6. **不修改 spec 文件**

## 状态更新

```bash
# 由当前模型在 Codex 审查完成后更新（非 CLI 写入）
review_status.codex_spec_review = {
  status: 'completed',
  codex_status: 'success',
  issues_found: N,
  issues: [ ... verified findings ... ],
  session_id: '{from response}',
  timing_ms: {elapsed},
  reviewed_at: '{ISO timestamp}'
}
```

## Step 6 展示格式

当 `codex_spec_review.issues_found > 0` 时，在 Step 6 展示内容中追加：

```
📋 Codex 审查发现（{n} 条，critical: {x} / important: {y}）：
  1. [{severity}] {spec_section}: {description} — 建议: {suggestion}
  2. ...
```

用户可额外选择：
- "采纳 Codex 建议并修改 Spec" → 回到 Step 5，当前模型根据建议修改 Spec

## 降级规则

- 先调用，失败了再降级（禁止预判 Codex 不可用）
- 降级时不消耗任何 review 预算
- 降级状态在 Step 6 展示为 `(Codex 审查未执行: {原因})`
