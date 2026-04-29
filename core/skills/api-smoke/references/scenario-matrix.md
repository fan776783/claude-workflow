# 场景矩阵模板

每个接口生成 7 类场景。**不适用的场景不硬塞**,脚本头注释说明原因。

## 7 类场景

| # | 类型 | 触发条件 | 断言 |
|---|---|---|---|
| 1 | 正常 | 合法 cookie + 合法参数 | 2xx + 响应字段符合 autogen 类型 + 关键业务字段有值 |
| 2 | 参数异常 | 必填缺失 / 类型错 / 枚举越界 | 4xx + 错误码或 message 符合 convention |
| 3 | 鉴权异常 | 空 cookie / 伪造 cookie | 401 |
| 4 | 权限异常 | 角色不足 / 无资源访问权 | 403 |
| 5 | 资源异常 | 不存在 ID / 已删除 ID / 错误类型 ID | 404 或业务错误码 |
| 6 | 业务错误 | spec 列出的失败分支(如"余额不足"、"状态不合法") | 特定业务错误码 + message 关键词 |
| 7 | 边界 | 分页极值 / 超长字段 / 空数组 / 极端时间 | 成功或明确拒绝,不崩溃 |
| 8 | contract-follow-through(可选) | 响应里的关键 URL 字段(`download_url` / `preview_url` / `file_url` / `thumbnail_url`)能 HEAD/GET | 2xx,内容类型符合预期 |

## 每类场景的启发式与例子

### 1. 正常场景

**每个接口都必须有**。如果拿不到合法入参,说明 spec / 依赖链不完整,应该退回依赖图重看。

```ts
import { expectBizOk, expectHasFields } from './_shared/assertions';
import { saveFixture } from './_shared/fixture';

it('正常场景: 合法参数应返回 code=0 + teamId', async () => {
  const r = await client.post('/api/team', { name: 'smoke-test-team' });
  expectBizOk(r, '正常');                           // 2xx + body.code === 0 (兼容无 code 的响应)
  expectHasFields(r.data.data, ['teamId'], '响应');
  saveFixture({ teamId: r.data.data.teamId });     // 持久化给下游脚本(跨进程共享)
});
```

**响应断言粒度**:

- 状态码 — 必断
- 顶层结构字段(`code`, `data`, `message` 这类包装) — 必断
- `data` 里的业务关键字段(按 autogen 响应类型) — 抓 2-5 个核心字段,不必全断
- 不要断**所有字段**——会和后端微调很脆弱

### 2. 参数异常

**从 autogen 入参类型挖**:

- `required` 字段 → 生成「缺失该字段」case
- `string` 字段 → 生成「传 number」case(单字段,不要全改)
- 枚举字段 → 生成「传枚举外的值」case
- 数值范围(若 autogen 有 `Min`/`Max` 注释) → 生成越界 case

**每个异常 case 单独一个 `it`**,不要合并,失败信息更清晰。

```ts
import { expect4xx } from './_shared/assertions';
it('参数异常: 缺少 name 应返回 4xx', async () => {
  expect4xx(await client.post('/api/team', {} as any), '缺 name');
});
```

### 3. 鉴权异常(必有)

所有接口都要覆盖(除非接口本身不鉴权,例如 `/health`)。**用 `expectNotLogin`,不要硬断 `status === 401`**——有的后端 `status=200 + body.code=401002 + msg="User not login err"`,硬断会误报。

```ts
import { expectNotLogin } from './_shared/assertions';
it('鉴权异常: 空 cookie 应未登录', async () => {
  expectNotLogin(await client.post('/api/team', validPayload, { cookie: '' }), '空 cookie');
});
```

### 4. 权限异常(条件)

**触发条件**:spec 里提到角色 / 权限相关描述(例如"仅管理员可创建")。**不适用则跳过**,注释"本接口 spec 未涉及角色/权限,无此场景"。

```ts
it.skip('权限异常: 普通用户应返回 403 (需要额外低权限 cookie)', async () => {
  // TODO(依赖方): 提供低权限 cookie 到 SMOKE_COOKIE_LOW_ROLE 后启用
});
```

默认 skip,要求用户另外提供低权限 cookie 才能启用——避免用户无法跑。

### 5. 资源异常(条件)

**触发条件**:接口路径含 `:id` / `:xxxId`,或入参含「目标资源 ID」。**不适用则跳过**,注释"本接口无资源 ID 参数"。

```ts
it('资源异常: 不存在的 teamId 应返回 404', async () => {
  const resp = await client.get('/api/team/99999999');
  expect([404, 400]).toContain(resp.status);  // 后端可能用 400 + 业务码
});
```

### 6. 业务错误(条件)

**触发条件**:spec §6 验收标准或 §7 Q&A 列了明确的失败分支(例如"余额不足返回 10001"、"团队已满返回 ERR_FULL")。

**不要**自己发明业务错误场景——只覆盖 spec 里明确出现的。

```ts
import { expectBizCode } from './_shared/assertions';
it('业务错误: 团队成员已满应返回 ERR_TEAM_FULL', async () => {
  // 依赖: fixture 里预置满员团队 ID
  const r = await client.post(`/api/team/${fixture.fullTeamId}/member`, validMember);
  expectBizCode(r, 'ERR_TEAM_FULL', '满员');
});
```

如果构造业务错误场景需要复杂前置(例如"先创建满员团队")→ 标 `it.skip` + `TODO(依赖方)`,不尝试自动填满。

### 7. 边界(条件)

**触发条件**:接口含分页参数 / 入参含长度限制的 string / 入参含时间范围。**不适用则跳过**。

```ts
it('边界: 分页 pageSize=0 应返回空数组或 4xx', async () => {
  const resp = await client.get('/api/team?page=1&pageSize=0');
  expect(resp.status).toBeLessThan(500);
});

it('边界: name 超长应返回 4xx (不是 500)', async () => {
  const resp = await client.post('/api/team', { name: 'x'.repeat(10000) });
  expect(resp.status).toBeGreaterThanOrEqual(400);
  expect(resp.status).toBeLessThan(500);
});
```

**关键断言**:"不应返回 5xx"——边界 case 最常见的 bug 是后端没做防御,抛 500。

## 脚本头注释模板

每个业务脚本头部必须写:

```ts
/**
 * 接口: {接口名}
 * 方法 + 路径: {METHOD} {/path}
 * 来源: {autogen 文件路径}
 * spec 引用: §X.Y
 *
 * 覆盖场景:
 * - [x] 正常
 * - [x] 参数异常: 缺少 {field1}, 类型错误 {field2}
 * - [x] 鉴权异常
 * - [ ] 权限异常: spec 未涉及角色,跳过
 * - [x] 资源异常
 * - [x] 业务错误: ERR_TEAM_FULL (需要 fixture.fullTeamId,默认 skip)
 * - [ ] 边界: 本接口无分页/长度限制,跳过
 *
 * 依赖:
 * - 前置: 01-createTeam 提供 teamId
 * - 后续: 03-publishNotice 消费本接口产出
 */
```

给下游人工 review 和延后补充提供清晰视图。

### 8. contract-follow-through(可选)

**触发条件**:响应体里含 URL 字段(`download_url` / `preview_url` / `file_url` / `thumbnail_url` / `cover_url`),业务 workflow 要求客户端真实下载/展示。

**默认 `it.skip`**(会多一次 HTTP 流量,CDN 大文件可能慢),脚本头注释写清楚启用方式。

```ts
import { expect2xx } from './_shared/assertions';
it.skip('contract-follow-through: download_url 可 HEAD 到(去 .skip 启用)', async () => {
  const r = await client.post('/resources/element/:id/download', { id: String(fixture.resourceId) });
  const downloadUrl = r.data.data.element_list[0].download_url;
  // 外部 CDN 不走 _shared/client(不带内部 header / cookie),用 fetch
  const head = await fetch(downloadUrl, { method: 'HEAD' });
  expect(head.status, `download_url HEAD`).toBeGreaterThanOrEqual(200);
  expect(head.status).toBeLessThan(300);
});
```

**为什么默认 skip**:

- CDN 可能需要 IP 白名单;临时环境跑容易失败误报
- 大文件 HEAD 虽快,但 `download_url` 可能是短时 token,脚本跑得慢 token 就过期
- 冒烟核心诉求是"后端接口通不通",不是"CDN 能不能下"

**启用场景**:业务方想确认 contract 完整性(下载链路真的能走通);或 download_url 频繁挂 404 时做回归。

## 数据清理

冒烟会创建测试数据。可选产出:

- `99-teardown.smoke.{ts,js}` — 按 fixture 里记录的 ID 反向删除
- spec 未给清理方案 → 不自动生成,在 README 里提示"冒烟会产生测试数据,请手动清理或跑 teardown"

---

## 失败分类(三类)

冒烟跑完出现的失败**不要一股脑报 FAIL**——必须分类,因为每类下一步动作完全不同。这一节同时是 SKILL.md Step 6 连通性自检 + Step 7 README 的判定依据。

### contract-drift(contract 漂移)

**定义**:脚本按 autogen 类型发请求,后端返回的**状态码 / 业务码 / 字段结构**与 autogen contract 不符。

**典型征兆**:

- 正常用例拿到 `code=非 0` 且 msg 指向业务失败,但 spec / autogen 明确该路径是成功
- 响应体字段和 autogen 类型不符(缺字段 / 类型错)
- 后端 status 200 但 body.code 表示错(或相反)
- 参数异常用例拿到预期外的错误码(例如 spec convention `400 + ERR_X`,实际 `400 + invalid json body`)

**下一步动作**:记到 README 的 contract-drift 段,附 autogen 原文 + 实际响应,交给 `/fix-bug` 或对接后端同学确认 contract。

### script-bug(脚本问题)

**定义**:请求没打出去 / 打出去的请求与 autogen 不符,责任在脚本。

**典型征兆**:

- `TypeError: xxx is not a function` / 导入失败 / fixture 字段 undefined
- URL 拼错(少 `/` / 多 `/` / 路径参数没替换)
- 请求 body 字段名写错(autogen 要 `category_id`,脚本发 `categoryId`)
- 请求方法错(autogen POST,脚本 GET)

**下一步动作**:当场修脚本,重跑。不算后端问题。

### env-issue(环境问题)

**定义**:脚本和 contract 都没问题,但目标环境不具备运行条件。

**典型征兆**:

- TCP 失败 / DNS 失败 / TLS 证书错误 / 网络超时 / 连接 reset
- 全量接口一律 401(且 cookie 非空)→ 可能 cookie 过期 / 域不匹配 / 缺拦截器 header(参考 `extraction-protocol.md § 拦截器 header`)
- 合法 ID 调用拿到 `Service Not Found` / 路由不存在 → 测试环境未部署该路由,对比预发 / 生产可能正常
- 后端返回 `502 Bad Gateway` / `504 Gateway Timeout`

**下一步动作**:

| 征兆 | 检查 |
|---|---|
| TCP/DNS/TLS | `SMOKE_RESOLVE_IP` 填了没?VPN 通不通?`SMOKE_TLS_REJECT_UNAUTHORIZED=0`? |
| 全量 401 | cookie 是否过期(devtools 重新复制一次)?拦截器 header 是否齐全? |
| 路由未部署 | 联系运维 / 后端 / SRE 确认环境部署状态;换一个环境(dev → staging)验证 |
| 5xx | 看后端日志;非冒烟脚本能解决的问题 |

### 输出模板(Step 7 README 必含)

```markdown
## 冒烟结果

总请求数: 22
成功: 20
失败: 2

### contract-drift(需后端确认)
- `POST /web/v1/df/crc/resources/element/:id/download` 正常路径 → `code=744 Service Not Found`
  - autogen 期望: `code=0 + data.element_list`
  - 建议: 先确认测试环境部署状态,若部署了,走 /fix-bug

### script-bug
(无)

### env-issue
(无)

### 说明
N 次成功路径平均 400ms,失败路径 ~15ms。
```

让用户一眼看出哪些要动代码、哪些找后端 / 运维、哪些是脚本自己的 bug。
