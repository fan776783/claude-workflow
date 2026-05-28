# Codex Routing

Risk-signal based Codex routing shared by fix-bug, bug-batch, diff-review, and the execute 末尾终审 (workflow-execute Step 7). Worker-level roles and invariants follow [`subagent-worker-contract.md`](subagent-worker-contract.md).

## Decision Table

| Signal | Examples | Route | Rationale |
|---|---|---|---|
| `security_boundary` | auth, permission, tenant isolation, secrets, token/session handling | Codex read-only oracle review | High-impact trust boundary failures benefit from independent reasoning. |
| `data_safety` | migration, irreversible state change, deletion, persistence schema, data corruption | Codex read-only oracle review | Data loss and migration hazards are costly and often non-obvious. |
| `concurrency_ordering` | race, retry, idempotency, transaction, queue, stale state | Codex read-only oracle analysis/review | Requires tracing ordering assumptions and reachable interleavings. |
| `cross_task_contract` | API/schema/signature/config key consistency across tasks or layers | Codex read-only oracle review | Contract drift often spans files and is hard to catch in a local diff pass. |
| `stuck_or_looping` | parent failed twice, implementer/reviewer loop >= 2, unresolved root cause | Codex read-only oracle analysis | Use Codex as a second opinion before more implementation attempts. |
| `direct_verification` | simple CRUD, enum/string tweak, typo, pure UI check, grep/read/search, screenshot-verifiable change | Current model, no Codex | Direct evidence is cheaper and clearer than spawning an oracle review. |

## Routing Workflow

1. Inspect the issue description, root cause, planned fix, changed files, and risk signals.
2. If any high-risk signal (`security_boundary`, `data_safety`, `concurrency_ordering`, `cross_task_contract`, `stuck_or_looping`) is present, use Codex as a read-only oracle through the `collaborating-with-codex` skill.
3. If only `direct_verification` signals are present, review directly with the current model and record why Codex was skipped.
4. When signals conflict, prefer the higher-risk route. For example, a UI change touching auth/session behavior still uses Codex oracle review.

## Invocation Contract

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

- Codex 不可用 → 当前模型直接 review，在摘要里标注 `degraded_review: no_codex`。
- Codex 连续 2 次空响应 → 同降级，不无限重试。

## Usage

Skill SKILL.md 里写：

```markdown
### Phase N review routing

Use `core/specs/shared/codex-routing.md § Decision Table` to choose the review route:
- high-risk signals → Codex read-only oracle, invoked via `codex-routing.md § Invocation Contract`
- direct-verification only → current model direct review
```

Do not duplicate the risk table or oracle prompt template in each skill.
