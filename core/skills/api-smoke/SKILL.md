---
name: api-smoke
description: "API smoke validation for backend contracts from user curl/HAR/.http, OpenAPI/Swagger/Apifox/Postman exports, YApi autogen, workflow spec, backend routes, and frontend call sites; supports quick live curl probes and suite script generation. Use when 用户说「接口冒烟」「生成接口测试脚本」「联调前验接口」「api smoke」「验一下后端」「验一下」「通不通」「可重复跑」「回归」, or 前端想在 UI 成型前先验后端 contract。登录态由用户 cookie 注入,skill 不做登录。"
argument-hint: "[quick | suite] <接口源>"
---

<CONTEXT>
Read `core/specs/shared/glossary.md` plus this skill's current `SKILL.md` when editing it. A workflow can enrich scope and API names, but it is optional.
</CONTEXT>

<PATH-CONVENTION>
- CLI reads use `~/.agents/agent-workflow/core/utils/workflow/`; never write workflow state.
- Bundled assets live in `~/.agents/agent-workflow/core/skills/api-smoke/assets/`. Suite mode copies assets first, then edits only project-specific script files and allowed config blocks.
</PATH-CONVENTION>

# api-smoke

## Mode Routing

| Signal | Mode | Behavior | Output |
|---|---|---|---|
| "验一下", "通不通", pasted curl, few endpoints | quick | run live `curl` probes in-session | verdict, replay curl group, copyable inventory |
| "生成脚本", "可重复跑", "回归" | suite | generate a persistent script suite | `scripts/api-smoke/<slug>/` |
| unclear | ask once | choose quick or suite | no files until chosen |

**Upgrade**: quick produces no repo files. To upgrade, reuse the confirmed inventory and verified params, then write them into suite `FLOW.md` as the first step.

## Core Boundaries

| Do | Do Not |
|---|---|
| validate backend contract from real sources and call sites | invent endpoints or fields; mark `api_gap` / `semantic_unknown` |
| inherit browser/client headers through explicit variables | call login endpoints; user provides cookie |
| support IP direct + Host/SNI and TLS bypass | start backend services |
| classify failures as `contract-drift`, `script-bug`, `env-issue` | report environment noise as backend bugs |
| skip destructive or billable normal paths until user confirms | auto-fire DELETE/reset/payment-like paths |

## Hard Gates

1. **Credential discipline**: quick stores cookie/header text in a temp header file and uses `curl -H @file`; remove it after the run. Never put cookie values in argv, transcript, logs, `README.md`, or `FLOW.md`. Prefer DevTools "Copy as cURL"; redact HAR echoes because HAR contains credentials.
2. **Destructive discipline**: DELETE/reset/destructive and third-party billing normal scenarios require user confirmation in quick and `it.skip` in suite. Non-destructive negative cases may be generated.
3. **Suite path discipline**: scripts must self-locate `.env.smoke`, `.smoke-fixture.json`, `logs/`, `trace.log`, and `report.md` through `fileURLToPath(import.meta.url)` + `resolve()`.
4. **Suite fixture discipline**: shared state must use JSON via `_shared/fixture.mjs`; no module-level fixture objects.
5. **Suite evidence discipline**: write NDJSON with `suite`/`test`, do not truncate response bodies in NDJSON, and redact `Cookie`, `Authorization`, and cookie-derived headers.

## Interface Sources

Use two independent axes, then present the inventory for confirmation.

| Question | Decision |
|---|---|
| Which endpoints are in scope? | user prompt/curl/HAR/.http > workflow spec if present > ask user |
| Which fields are authoritative? | real capture > OpenAPI/autogen types > spec prose |

Source adapters: user curl/HAR/.http, OpenAPI/Swagger/Apifox/Postman, YApi autogen TS, workflow spec + `api_context` as name-to-path mapping only, backend routes before frontend call sites, then frontend call sites. Inventory shape:

```js
{ name, method, path, req, resp, sources: [], constraints: [], gaps: [] }
```

Details: [`references/interface-sources.md`](references/interface-sources.md).

## Quick Flow

1. Extract target endpoints and credentials from prompt or "Copy as cURL"; redact before displaying anything.
2. Build the inventory table with source provenance and obvious gaps; cover normal + auth abnormal + one parameter abnormal per endpoint.
3. Map environment knobs to curl:
   | Need | curl flag |
   |---|---|
   | IP direct with SNI | `--resolve host:443:ip` |
   | TLS bypass | `-k` |
   | timeout | `--max-time <seconds>` |
   | method/body | `-X` + `--data-raw` |
   | temp headers | `-H @<tmp-header-file>` |
4. Run safe probes only. Ask before destructive/billable normal paths.
5. Return verdict: inventory, pass/fail table, three-way failure classification, and replay curl commands with cookie placeholders.

## Suite Flow

1. Confirm scope inventory, semantic constraints, destructive skips, and target slug.
2. Copy bundled assets into `scripts/api-smoke/<slug>/`; do not hand-copy asset code from docs.
3. Fill `.env.smoke.example` using `SMOKE_HEADER_<NAME>` entries for client headers.
4. Generate `NN-*.smoke.mjs` scripts from the 7+1 scenario matrix.
5. Build dependency order and `ensureXxx()` helpers from response-to-request data flow.
6. Generate `README.md` and `FLOW.md`; keep `report.mjs` generic except its top `CONFIG` block.
7. If credentials are available, run the first safe normal case and classify failures.

Suite details: [`references/scenarios-and-failures.md`](references/scenarios-and-failures.md), [`references/suite-mode.md`](references/suite-mode.md).

## Outputs

| Mode | Output |
|---|---|
| quick | session-only verdict, replay curl group with placeholders, copyable inventory |
| suite | `<project_root>/scripts/api-smoke/<slug>/` with `_shared/`, `.env.smoke.example`, `.gitignore`, `README.md`, `FLOW.md`, `run-all.mjs`, `NN-*.smoke.mjs` |

Runtime artifacts: `logs/run-*.ndjson`, `report.md`, `trace.log`, `.smoke-fixture.json`, and `dump/` stay ignored.

## Related Skills

| Skill | Relation |
|---|---|
| `/workflow-delta` | can refresh autogen and `api_context`; api-smoke only consumes them |
| `/workflow-execute` | users may call api-smoke during frontend integration; it does not affect execution state |
| `/fix-bug` | use when a smoke failure is confirmed `contract-drift` |
| `/diagnose` | use for persistent `env-issue` or unclear flaky behavior |
