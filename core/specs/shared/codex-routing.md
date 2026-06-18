# Codex Routing

Risk-signal based Codex routing shared by fix-bug, bug-batch, diff-review, and the execute 末尾终审 (workflow-execute Step 7). Worker-level roles and invariants follow [`subagent-worker-contract.md`](subagent-worker-contract.md).

## Decision Table

| Signal | Examples | Route | Rationale |
|---|---|---|---|
| `security_boundary` | auth, permission, tenant isolation, secrets, token/session handling | Codex read-only oracle review | High-impact trust boundary failures benefit from independent reasoning. |
| `data_safety` | migration, irreversible state change, deletion, persistence schema, data corruption | Codex read-only oracle review | Data loss and migration hazards are costly and often non-obvious. |
| `concurrency_ordering` | race, retry, idempotency, transaction, queue, stale state | Codex read-only oracle analysis/review | Requires tracing ordering assumptions and reachable interleavings. |
| `cross_task_contract` | API/schema/signature/config key consistency across tasks or layers | Codex read-only oracle review | Contract drift often spans files and is hard to catch in a local diff pass. |
| `stuck_or_looping` | parent failed twice, implementer/reviewer loop >= 2, unresolved root cause, **fix keeps regressing in same region** | Codex read-only oracle analysis | Use Codex as a second opinion before more implementation attempts. Known root cause does NOT justify skipping — see Routing Workflow step 5. |
| `direct_verification` | simple CRUD, enum/string tweak, typo, pure UI check, grep/read/search, screenshot-verifiable change | Current model, no Codex | Direct evidence is cheaper and clearer than spawning an oracle review. |

## Routing Workflow

1. Inspect the issue description, root cause, planned fix, changed files, and risk signals.
2. If any high-risk signal (`security_boundary`, `data_safety`, `concurrency_ordering`, `cross_task_contract`, `stuck_or_looping`) is present, use Codex as a read-only oracle through the host-aware `Invocation Contract` below. The bridge route is implemented by the `collaborating-with-codex` skill; the Codex-host route uses native subagents.
3. If only `direct_verification` signals are present, review directly with the current model and record why Codex was skipped.
4. When signals conflict, prefer the higher-risk route. For example, a UI change touching auth/session behavior still uses Codex oracle review.
5. **`stuck_or_looping` skip 判据**：不得仅因「根因已知」跳过 oracle——**根因已知 ≠ 修复在收敛**。当症状是 thrashing（连续修复在同区域引入新回归）时，oracle 的价值是 **alternative-design POV**（很可能建议缩小 scope / 换设计），正是所需，不得跳过；或直接走设计简化升级（见 workflow-execute `references/subagent-driven.md` § Thrashing 早升级）。仅当 stuck 是 **localized 单根因 correctness 补丁、且根因 + 修复路径都已锁定**时，才可标 `degraded_review: skipped_known_root_cause` 跳过并记理由。

## Invocation Contract

Before invoking Codex, choose the host-aware route:

| Host / tool availability | Route |
|---|---|
| Running inside Codex and `spawn_agent` / `wait` / `close_agent` are available | Use the Codex-native subagent route below. |
| Running inside Codex but native subagent tools are unavailable | Treat the Codex route as failed; record degradation. Do not use the bridge route from inside Codex. |
| Any non-Codex host | Use the bridge route below. |

Codex-hosted callers must not launch a nested `codex app-server` only to ask Codex for a review. Use the native subagent route so the parent Codex session stays the controller and the child session is the read-only reviewer.

### Codex-Native Subagent Route

Use a single read-only reviewer subagent:

1. `spawn_agent` with a prompt whose first line is `Active task: <caller-specific-review-id>` (for example, `diff-review-codex-review` when called by `diff-review`).
2. `wait` until the subagent reaches a terminal result.
3. `close_agent` after collecting the result, even when the result is invalid or empty.

The subagent prompt must include the worker contract fields from [`subagent-worker-contract.md`](subagent-worker-contract.md):

| Field | Required value |
|---|---|
| `Outcome` | Candidate findings only; no final verdict. |
| `Scope` | The explicit file list, diff range, or session file list supplied by the caller. |
| `Allowed actions` | Read-only review; no edits, formatting, commits, dependency changes, or external state changes. |
| `Non-goals` | Out-of-scope refactors, cleanup, speculative hardening, unrelated files, and final adjudication. |
| `Evidence requirements` | File:line evidence and concrete impacted callers/contracts/tests for any claimed downstream impact. |
| `Final output schema` | Structured candidate findings with severity suggestion, evidence, impact hypothesis, and confidence. |
| `Stop conditions` | Return `NEEDS_CONTEXT` if the scope is insufficient; do not expand scope silently. |

This route satisfies "Codex oracle review" for the parent pipeline. The parent still owns normalization, verification, impact analysis, severity calibration, and final report synthesis.

### Bridge Route

Use [`../../skills/collaborating-with-codex/prompts/oracle-review.md`](../../skills/collaborating-with-codex/prompts/oracle-review.md) through the no-target `--oracle-review` bridge mode. The caller provides scope explicitly; the bridge does not infer or generate diff/context.

Required fields:

| Field | Source |
|---|---|
| `TASK` | Concrete question, root cause, planned fix, or review objective. |
| `CONTEXT` | Relevant diff, acceptance criteria, constraints, or caller-provided evidence. |
| `FILES` | Comma-separated files or prose scope. Inserted as-is; the bridge does not parse arrays. |
| `RISK_SIGNALS` | Comma-separated signals from the Decision Table. Inserted as-is. |
| `NON_GOALS` | Out-of-scope refactors, cleanup, speculative hardening, or unrelated domains. |

Run in background with no fixed timeout:

```
node core/skills/collaborating-with-codex/scripts/codex-bridge.mjs \
  --cd "<repo>" \
  --oracle-review \
  --prompt "<task>" \
  --risk-signals "<signals>" \
  --files "<files>" \
  --context "<context>" \
  --non-goals "<non-goals>" \
  --background
```

Fallback for older bridge versions without `--oracle-review`:

```
node core/skills/collaborating-with-codex/scripts/codex-bridge.mjs \
  task \
  --cd "<repo>" \
  --read-only \
  --prompt "<manually rendered oracle-review prompt>" \
  --background
```

Fallback callers must manually assemble the rendered prompt string; do not add helper extraction only for fallback.

## Degradation

- 当前宿主对应路由实际执行失败（Codex-native 的 `spawn_agent` / `wait` / `close_agent` 失败，或 bridge route 失败）→ 当前模型直接 review，在摘要里标注 `degraded_review: no_codex`，并记录 route + error。
- 当前宿主对应路由连续 2 次空响应 → 同降级，不无限重试。

## Usage

Skill SKILL.md 里写：

```markdown
### Phase N review routing

Use `core/specs/shared/codex-routing.md § Decision Table` to choose the review route:
- high-risk signals → Codex read-only oracle, invoked via `codex-routing.md § Invocation Contract` host-aware route
- direct-verification only → current model direct review
```

Do not duplicate the risk table or oracle prompt template in each skill.
