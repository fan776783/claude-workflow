# Suite Mode

Suite mode creates a persistent, repeatable script directory under the user project.

## Directory

```text
scripts/api-smoke/<slug>/
├── .env.smoke.example
├── .env.smoke
├── .gitignore
├── README.md
├── FLOW.md
├── report.md
├── logs/
├── trace.log
├── .smoke-fixture.json
├── dump/
├── _shared/
│   ├── assertions.mjs
│   ├── client.mjs
│   ├── contract-check.mjs
│   ├── dump.mjs
│   ├── env.mjs
│   ├── fixture.mjs
│   └── report.mjs
├── run-all.mjs
└── NN-<endpoint>.smoke.mjs
```

Copy bundled assets as-is. The only shared asset customization is the top `CONFIG` block in `_shared/report.mjs`. Business scripts and docs are generated per inventory.

## Asset Map

| Source | Target | Purpose |
|---|---|---|
| `assets/_shared/env.mjs` | `_shared/env.mjs` | self-located env read, `SMOKE_HEADER_*` parsing |
| `assets/_shared/client.mjs` | `_shared/client.mjs` | IP/SNI, request logging, redaction, retry |
| `assets/_shared/assertions.mjs` | `_shared/assertions.mjs` | business assertions and `Runner` |
| `assets/_shared/fixture.mjs` | `_shared/fixture.mjs` | JSON fixture persistence |
| `assets/_shared/report.mjs` | `_shared/report.mjs` | NDJSON to `report.md` |
| `assets/_shared/dump.mjs` | `_shared/dump.mjs` | one-off full response dump |
| `assets/_shared/contract-check.mjs` | `_shared/contract-check.mjs` | optional response/type diff placeholder |
| `assets/run-all.mjs` | `run-all.mjs` | serial child-process runner and report call |
| `assets/env.smoke.example` | `.env.smoke.example` | env template |
| `assets/gitignore` | `.gitignore` | ignored runtime artifacts |

## Required Asset Capabilities

Do not remove these when adapting to a project:

| Capability | Location |
|---|---|
| IP direct + Host/SNI split | `client.mjs` |
| TLS bypass via `SMOKE_TLS_REJECT_UNAUTHORIZED=0` | `env.mjs` / `client.mjs` |
| browser/client header inheritance | `SMOKE_HEADER_*` in `env.mjs` |
| full NDJSON response body plus redacted sensitive headers | `client.mjs` |
| `suite`/`test` on each log row | `assertions.mjs` + `client.mjs` |
| JSON fixture shared across child processes | `fixture.mjs` |
| self-located paths | all shared assets |
| `SMOKE_VERBOSE`, `trace.log`, retry | `client.mjs` |
| `expectBizOk`, `expectNotLogin`, `expectBizCode` | `assertions.mjs` |
| top summary block in `report.md` | `report.mjs` |

## `SMOKE_HEADER_*`

Any `SMOKE_HEADER_<NAME>=<value>` becomes an HTTP header. Underscores become hyphens and each segment is title-cased:

```text
SMOKE_HEADER_X_SPACE_ID=123      -> X-Space-Id: 123
SMOKE_HEADER_AUTHORIZATION=...   -> Authorization: ...
SMOKE_HEADER_X_SN=@cookie:sid    -> X-Sn: value extracted from SMOKE_COOKIE
```

Plain empty values are skipped. `@cookie:<key>` values are included and the header name is added to `sensitiveHeaders` even if the cookie key is currently absent. `SMOKE_HEADER_HOST` and `SMOKE_HEADER_COOKIE` are refused. Runtime signatures or request IDs can be supplied from a business script with `opts.headers`; that merge happens last.

## Dependency And Fixture Protocol

Order endpoints by explicit business flow first, then by response-field to request-field reuse. Independent endpoints get independent scripts. Unclear dependencies get a `TODO` comment, not guessed data.

Use `.smoke-fixture.json` for cross-script values:

```js
import { loadFixture, saveFixture } from './_shared/fixture.mjs';

async function ensureTeamId() {
  const { teamId } = loadFixture();
  if (teamId) return teamId;
  const r = await client.post('/api/team', { name: `smoke-${Date.now()}` });
  saveFixture({ teamId: r.data.data.teamId });
  return r.data.data.teamId;
}
```

`run-all.mjs` runs scripts serially and clears fixture at start. Single-script runs should still work through `ensureXxx()`.

## Business Script Pattern

```js
#!/usr/bin/env node
/**
 * Endpoint: createTeam
 * Method + path: POST /api/team
 * Sources: curl + src/api/teamApi.ts
 * Constraints: name length 1-50
 * Scenarios: normal, parameter abnormal, auth abnormal
 */
import { client } from './_shared/client.mjs';
import { expectBizOk, expect4xx, expectNotLogin, expectHasFields, Runner } from './_shared/assertions.mjs';
import { saveFixture } from './_shared/fixture.mjs';

const runner = new Runner('01 createTeam');

runner.test('normal: returns teamId', async () => {
  const r = await client.post('/api/team', { name: `smoke-${Date.now()}` });
  expectBizOk(r, 'normal');
  expectHasFields(r.data.data, ['teamId'], 'response');
  saveFixture({ teamId: r.data.data.teamId });
});

runner.test('parameter abnormal: missing name', async () => {
  expect4xx(await client.post('/api/team', {}), 'missing name');
});

runner.test('auth abnormal: empty cookie', async () => {
  expectNotLogin(await client.post('/api/team', { name: 'x' }, { cookie: '' }), 'empty cookie');
});

runner.run();
```

If a project uses vitest/jest, keep the same behavior while adapting imports and runner integration. If IP direct + SNI is needed, keep Node `http`/`https` rather than axios.

## README And FLOW

`README.md` must contain: inventory, env setup, cookie/header instructions, run commands, artifact navigation, failure-classification guide, and extension notes.

`FLOW.md` is a concise static design note, about 30 lines unless the chain is complex:

```markdown
# <slug> API Smoke Flow

## Inventory
| Step | Endpoint | Produces | Consumes | Constraints |
|---|---|---|---|---|

## Data Flow
01 create -> `teamId` -> 02 add member

## Header Context
| Header | Source | Why |
|---|---|---|

## Debug Path
1. Read `report.md` top summary.
2. Compare this file's constraints.
3. Filter `logs/run-*.ndjson` for raw evidence.

## Known Skips
- destructive or billable normal paths stay skipped until confirmed.
```

## Report Contract

The report top block must show five things: run time/log file, one-look suite table, linkage key data, endpoint status/code summary, and attention items. Downstream details include timeline, dependency trace, and first successful sample per endpoint.

Edit only `CONFIG` in `_shared/report.mjs` for project-specific fixture keys, link fields, URL normalization, or noteworthy response patterns.

## Teardown Policy

Do not call login endpoints. Do not auto-delete data unless the spec or user gives a safe cleanup path. If cleanup is available, generate `99-teardown.smoke.mjs`; otherwise document created data in README.
