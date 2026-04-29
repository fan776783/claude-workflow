# 脚本模板

按 SKILL.md Step 1 探测的栈选一种,**保持一致,不要混用**。

## Bundled assets(单一事实源)

下列文件已打包进 `assets/`,skill 生成脚本时 *先 `cp` 后改*,不要手写、不要从本文档粘贴:

| 来源(skill 内) | 目标(用户项目) | 作用 |
|---|---|---|
| `assets/_shared/env.mjs` | `scripts/api-smoke/<slug>/_shared/env.mjs` | 路径自定位读 `.env.smoke` |
| `assets/_shared/fixture.mjs` | 同上 `_shared/fixture.mjs` | JSON 持久化 fixture |
| `assets/_shared/assertions.mjs` | 同上 `_shared/assertions.mjs` | 业务语义断言 + Runner + `runnerContext` |
| `assets/_shared/client.mjs` | 同上 `_shared/client.mjs` | IP/SNI + NDJSON + 拦截器 header |
| `assets/_shared/report.mjs` | 同上 `_shared/report.mjs` | NDJSON → report.md |
| `assets/_shared/dump.mjs` | 同上 `_shared/dump.mjs` | 单接口 dump 工具 |
| `assets/_shared/contract-check.mjs` | 同上 `_shared/contract-check.mjs` | autogen vs 实际响应 diff(占位) |
| `assets/run-all.mjs` | `scripts/api-smoke/<slug>/run-all.mjs` | 子进程串联 + 自动调 report |
| `assets/env.smoke.example` | `scripts/api-smoke/<slug>/.env.smoke.example` | 环境变量模板 |
| `assets/gitignore` | `scripts/api-smoke/<slug>/.gitignore` | 必含条目 |

**skill 的职责**:

1. `cp` 上述文件到项目目录
2. 按 Step 3 拦截器探测结果改 `env.mjs` 里的 header 字段映射 + `.env.smoke.example` 里对应占位
3. 按接口清单生成 `NN-<接口名>.smoke.mjs` 业务脚本(下方「业务脚本模板」)
4. 生成 `README.md` + `FLOW.md`

## 模板必带能力(对照表)

上述 assets 已覆盖这些能力,**不允许简化剥离**:

| 能力 | 为什么必需 | 实现位置 |
|---|---|---|
| IP 直连 + Host/SNI 绑定 | 内网测试环境 DNS 不通是常态 | `client.mjs` |
| TLS 自签证书绕过 | 内网自签证书常见 | `env.mjs` `SMOKE_TLS_REJECT_UNAUTHORIZED` |
| 拦截器 header 继承 | 不带 `X-Prod-Id`/`X-Space-Id` 一律 401 | `env.mjs` + `client.mjs` |
| NDJSON 完整日志(不 truncate body + cookie redact) | 排查要看完整出入参,但禁止泄漏凭据 | `client.mjs` |
| Runner 注入 `suite/test` 到每条日志 | 定位失败用例 | `assertions.mjs` `runnerContext` + `client.mjs` |
| fixture JSON 持久化 | `run-all` 子进程要跨进程共享 | `fixture.mjs` |
| 路径自定位 | 用户 cd 到子目录也能跑 | 所有 `_shared/*.mjs` 头部 |
| `SMOKE_VERBOSE` 控制台副本 + `trace.log` | 实时看 | `client.mjs` |
| `SMOKE_RETRY` 静默重试 | 吸收后端瞬态漂移 | `client.mjs` |
| 业务语义断言(`expectBizOk` / `expectNotLogin` / `expectBizCode`) | 处理 status=401 body.code=0 | `assertions.mjs` |
| `report.mjs` 人类可读报告 | 排查先看这个 | `report.mjs` |

## 业务脚本模板(skill 每个接口生成一份)

这个脚本不在 bundled 范围——skill 要按接口清单 + 参数语义探测结果**现生成**。范式:

```js
#!/usr/bin/env node
/**
 * 接口: createTeam
 * 方法 + 路径: POST /api/team
 * 来源: src/api/autogen/teamApi.ts (ApiTeamPOST)
 * spec 引用: §4.2 / §6.1
 *
 * 业务约束(Step 4 参数语义探测):
 *   - name: string,长度 1-50(来源 src/pages/team/create.vue:33)
 *
 * 覆盖场景: [x] 正常 [x] 参数异常 [x] 鉴权异常 [x] 业务错误
 * 产出 fixture: teamId → 02-addMember 消费
 */
import { client } from './_shared/client.mjs';
import { expectBizOk, expect4xx, expectNotLogin, expectHasFields, Runner } from './_shared/assertions.mjs';
import { saveFixture } from './_shared/fixture.mjs';

const runner = new Runner('01 createTeam');

runner.test('正常: 合法参数应返回 code=0 + teamId', async () => {
  const r = await client.post('/api/team', { name: `smoke-${Date.now()}` });
  expectBizOk(r, '正常');
  expectHasFields(r.data.data, ['teamId'], '响应');
  saveFixture({ teamId: r.data.data.teamId });   // 跨进程共享
});

runner.test('参数异常: 缺 name 应返回 4xx', async () => {
  expect4xx(await client.post('/api/team', {}), '缺 name');
});

runner.test('鉴权异常: 空 cookie 应未登录', async () => {
  expectNotLogin(await client.post('/api/team', { name: 'x' }, { cookie: '' }), '空 cookie');
});

runner.run();
```

**下游脚本复用 fixture** + `ensureXxx()` 兜底:

```js
import { loadFixture, saveFixture } from './_shared/fixture.mjs';

async function ensureTeamId() {
  const { teamId } = loadFixture();
  if (teamId) return teamId;
  const r = await client.post('/api/team', { name: `fallback-${Date.now()}` });
  saveFixture({ teamId: r.data.data.teamId });
  return r.data.data.teamId;
}
```

## 栈 A:vitest(TS)

bundled assets 是 `.mjs`。若项目栈是 vitest,skill 拷贝后改动:

- `_shared/*.mjs` → `_shared/*.ts`,加类型
- Runner 改用 vitest 的 `describe/it/beforeEach`,`runnerContext` 用 `beforeEach` 注入:

```ts
import { beforeEach } from 'vitest';
import { runnerContext } from './_shared/assertions';
beforeEach((ctx) => {
  runnerContext.suite = ctx.task.suite?.name || '';
  runnerContext.test = ctx.task.name;
});
```

- `run-all.ts` 用 `spawnSync('pnpm', ['vitest', 'run', resolve(here, f)])`

## 栈 B:jest

同栈 A,Runner 改用 `@jest/globals` 的 `beforeEach`;`expect.getState().currentTestName` 拿当前用例名。

## 运行命令(写进 README)

| 栈 | 单文件 | 全部 | Verbose |
|---|---|---|---|
| 纯 Node | `node scripts/api-smoke/<slug>/01-*.smoke.mjs` | `node scripts/api-smoke/<slug>/run-all.mjs` | `SMOKE_VERBOSE=1 node ...` |
| vitest | `pnpm vitest run scripts/api-smoke/<slug>/01-*.smoke.ts` | `pnpm tsx scripts/api-smoke/<slug>/run-all.ts` | `SMOKE_VERBOSE=1 pnpm vitest ...` |
| jest | `pnpm jest scripts/api-smoke/<slug>/01-*.smoke.ts` | `pnpm tsx scripts/api-smoke/<slug>/run-all.ts` | `SMOKE_VERBOSE=1 pnpm jest ...` |

单跑要写 NDJSON:`SMOKE_LOG_FILE=logs/debug.ndjson node scripts/api-smoke/<slug>/01-*.smoke.mjs`。

## 产出栈的选择优先级

1. **必须 IP 直连 + SNI 分离** → 强制纯 `node:https`(即使项目有 axios)
2. 项目 `tech.testing.framework` 明确 → 用该栈
3. 都没有 → 栈 C(纯 Node)
