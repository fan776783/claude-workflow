# Scenarios And Failures

This file is the single source for scenario coverage and failure classification.

## Scenario Matrix

| # | Scenario | When | Assertion |
|---|---|---|---|
| 1 | normal | every non-skipped endpoint | 2xx + business success + key fields |
| 2 | parameter abnormal | required/malformed/out-of-range input exists | 4xx or documented business code |
| 3 | auth abnormal | endpoint requires login | `expectNotLogin`, not hard-coded 401 |
| 4 | permission abnormal | role/resource access is in scope | 403 or documented code; usually skipped until low-role cookie exists |
| 5 | resource abnormal | path/body contains resource IDs | 404 or business missing-resource code |
| 6 | business error | spec names a failure branch | documented business code/message |
| 7 | boundary | pagination, length, time, empty list, max size | no 5xx; success or clear rejection |
| 8 | contract-follow-through | response returns URL fields and user wants chain validation | optional `it.skip`, HEAD/GET confirms reachable URL |

Quick mode uses a safe subset: normal + auth abnormal + one parameter abnormal per endpoint. Suite mode generates all applicable cases, with skips when setup is unsafe or unavailable.

## Scenario Rules

- Normal scenarios need real valid params. If they cannot be constructed, go back to dependency and semantic probes.
- Parameter abnormal cases mutate one field at a time.
- Auth abnormal uses request-level `cookie: ''` or a temp curl header file without cookie.
- Permission abnormal defaults to skip unless the user provides a low-role credential.
- Business error scenarios must come from spec, capture, or backend docs; do not invent them.
- Boundary cases emphasize "not 5xx" for defensive behavior.
- URL follow-through is skipped by default because it may add CDN traffic or depend on short-lived tokens.

## Auth Failure Shapes

Do not equate auth failure with only HTTP 401. Common shapes:

| Shape | Likely Cause |
|---|---|
| `status=401` or `403` | missing/expired cookie |
| `status=200` with business code/message for not logged in | app-level auth wrapper |
| `status=200` with empty list or missing current context | required context header is wrong or absent |

Use `expectNotLogin` in generated scripts because it covers status and body-code variants. When all endpoints fail auth with a non-empty cookie, classify as `env-issue` first and check copied browser headers.

## Failure Classes

| Class | Definition | Typical Signals | Next Action |
|---|---|---|---|
| `contract-drift` | request matches the chosen contract source, but backend status/code/shape differs | missing response field, wrong type, unexpected business code, documented error mismatch | capture evidence and route to `/fix-bug` or backend owner |
| `script-bug` | generated script sends the wrong request or fails before a valid request | import error, undefined fixture, wrong method/path/body key | fix script and rerun immediately |
| `env-issue` | script and contract are plausible, but the target environment cannot run it | DNS/TLS/TCP timeout, VPN, all auth failing, route not deployed, 502/504 | fix env/cookie/header/deploy target, then rerun |

## Decision Tree

```text
failure?
├─ no request sent, import error, bad fixture, wrong URL shape
│  → script-bug
├─ network / DNS / TLS / timeout / reset
│  → env-issue
├─ all endpoints auth-fail with non-empty cookie
│  → env-issue: cookie expired, wrong domain, or missing client headers
├─ only one route missing in target env
│  → env-issue unless another source proves it is deployed
├─ response shape/status/business code conflicts with selected type/capture
│  → contract-drift
└─ pass with odd warning, such as silent limit behavior
   → soft warning in report
```

## Verdict Template

```markdown
## Smoke Verdict

Inventory: 3 endpoints
Safe probes run: 9
Passed: 7
Failed: 2

### contract-drift
- `POST /api/team`: expected `data.teamId`, actual missing.

### script-bug
- none

### env-issue
- `GET /api/project`: TLS certificate rejected. Retry with trusted cert or `SMOKE_TLS_REJECT_UNAUTHORIZED=0`.

### Replay
- `curl ... -H @headers.redacted`
```

Quick mode returns this in the session. Suite mode writes the classification into `README.md`/`report.md` guidance and prints it after a connectivity check.
