# Interface Sources

This file defines how api-smoke builds one endpoint inventory without depending on a workflow or one API generator.

## Two Axes

| Axis | Rule |
|---|---|
| Scope | user prompt with endpoint list, curl, HAR, or `.http` file > workflow spec when present > ask user |
| Field authority | real capture > OpenAPI/autogen type source > spec prose |

Do not turn either axis into a single priority chain. A workflow spec may define scope while a curl capture defines exact headers and body. `api_context` is only an interface-name to method/path mapping; it does not win field disputes.

## Source Adapters

| Source | Use For | Notes |
|---|---|---|
| User input: curl, HAR, `.http` | exact request shape, real headers, auth behavior | HAR includes plaintext credentials; redact before echoing |
| OpenAPI / Swagger / Apifox / Postman export | path, method, schemas, examples | prefer examples for quick mode payloads |
| YApi autogen TS | function names, request/response types, comments | never edit generated files |
| workflow spec | scope, acceptance criteria, business failures | optional enrichment only |
| workflow `api_context` | interface name to method/path mapping | no type authority |
| Backend route definitions | implementation path/method source | scan before frontend call sites in full-stack repos |
| Frontend call sites | semantic constraints and runtime context | best source for hidden value rules |

Skip login endpoints, WebSocket/SSE streams, and direct third-party billing calls unless the user explicitly asks. For destructive endpoints, include them in inventory but require confirmation or `it.skip`.

## Inventory Shape

```js
{
  name: 'createTeam',
  method: 'POST',
  path: '/api/team',
  req: { body: 'CreateTeamReq', query: null, params: null },
  resp: 'CreateTeamResp',
  sources: [
    { kind: 'curl', field: 'req.body', ref: 'user prompt' },
    { kind: 'autogen', field: 'resp', ref: 'src/api/teamApi.ts' }
  ],
  constraints: [
    { field: 'teamId', rule: 'must come from current team context', source: 'src/pages/team.vue:42' }
  ],
  gaps: []
}
```

`sources` are field-level. When two sources disagree, keep both in notes and choose by the field authority axis.

## Semantic Probe

Autogen types describe shape, not always valid values. Probe four classes from call sites and comments:

| Class | What To Extract | Example Signal |
|---|---|---|
| Value domain | allowed IDs, enum subsets, child-vs-root rules | `list[0].children[0].id` feeds `category_id` |
| Required predecessor | existing team/project/space selection | `setCurrentTeam(teamId)` before member API |
| ID/string format | number-as-string, slug-vs-id, URL encoding | `String(resource.id)` |
| Limits/defaults | page size, keyword length, date range | `MAX_PAGE_SIZE = 200` |

If no call site exists, mark `semantic_unknown` and either ask for a real curl/HAR or generate the suite with an explicit comment that it follows type shape only.

## Client Header Classification

Scan `axios.create`, `interceptors.request.use`, `defFetch`, `defaultHeaders`, `beforeRequest`, `setRequestHeader`, and framework fetch wrappers. Classify headers this way:

| Source | Suite Handling |
|---|---|
| static string | `SMOKE_HEADER_<NAME>=value` in `.env.smoke.example` |
| build env | map to `SMOKE_HEADER_<NAME>` and note original env key |
| cookie field | `SMOKE_HEADER_<NAME>=@cookie:<cookie-key>` |
| store/localStorage | require explicit `SMOKE_HEADER_<NAME>` from user |
| signature/timestamp | reproduce only if deterministic; otherwise document request-level `opts.headers` escape hatch |
| trace/request ID | generate in business script or request options |

`SMOKE_HEADER_HOST` and `SMOKE_HEADER_COOKIE` are refused by the asset parser. Host is controlled by `SMOKE_HOST`; cookie is controlled only by `SMOKE_COOKIE`.

## Confirmation Format

```markdown
### Smoke Inventory (N endpoints)

| # | Name | Method + Path | Req | Resp | Sources | Constraints | Gaps |
|---|---|---|---|---|---|---|---|
| 1 | createTeam | POST /api/team | `CreateTeamReq` | `CreateTeamResp` | curl + autogen | name length 1-50 | - |

### Gaps
- `getStats`: spec mentions it but no route or type source was found.

### Skips
- `DELETE /api/team/:id`: destructive normal path; suite will generate `it.skip`.
```

End with a direct confirmation question before suite generation. Quick mode can continue after the inventory if the safe probes are obvious.
