# 接口清单抽取协议

把「本次需求涉及哪些接口」这个问题用三路源头交叉出一个可信清单。

## 源 1:spec.md(范围过滤器)

**目的**:告诉 skill 哪些接口属于「本次需求」,避免把项目里所有接口都扫进来。

**解析位置**(按 spec-template 结构):

| 节 | 找什么 |
|---|---|
| §4 用户可见行为 | "用户点击 X,后端返回 Y","系统在用户进入页面时调用 ..." |
| §5.1 架构module / §5.2 Data Models | 显式的接口名 / 路径 / 请求响应字段 |
| §6 验收标准 | "接口返回 2xx + 字段 Z 有值","失败时返回错误码 A" |
| §7 Q&A | 用户澄清接口行为的问答(通常描述异常分支) |

**抽取启发式**:

- `POST|GET|PUT|DELETE|PATCH` + 路径 → 直接抓
- "调用 xxApi" / "yyService.zz()" → 在 autogen 里按函数名反查
- "某接口" / "业务接口" → 模糊引用,不进清单,在退出前询问用户澄清

**API 范围的判定**:spec 里**出现过**的接口进清单,**只隐含调用**(例如"页面首屏数据"没展开)的标 `implicit`,生成脚本时作为可选项,默认不覆盖,在清单表里打星号提示用户决定。

## 源 2:`state.api_context.interfaces`(标准化辅助)

**来源**:`/workflow-delta` 执行 `pnpm ytt` 后写入的标准化接口表。

**读取方式**:

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
```

返回 JSON 含 `api_context.interfaces`。字段结构由项目决定,通常含 `path`、`method`、`name`、`category`。

**用途**:作为「路径 / 方法 / 接口名」的权威映射表,当 spec 只提到接口名时从这里查路径。

**缺失处理**:`api_context.interfaces` 为空或不存在 → 说明 workflow 没跑过 `/workflow-delta`,退回到源 3 autogen 直接扫。

## 源 3:YApi autogen 代码(详细类型)

**目的**:拿到请求函数签名 + 入参 / 响应 TS 类型,用于生成断言。

**查找方式**(用 `mcp__auggie-mcp__codebase-retrieval`,不用 grep):

- 关键词:`autogen`、spec 里提到的接口名、`request(`、`http.get(`、`axios.`
- 典型文件:`**/autogen/*.ts`、`**/*Api.ts`、`**/api/*.ts`、`**/.api.ts`

**从 autogen 提取**:

1. 请求函数名(即 "接口名")
2. 路径 + HTTP 方法(通常在函数体里的 `request({ url, method })`)
3. 入参类型(函数参数 TS 类型)
4. 响应类型(`Promise<T>` 的 T)
5. 业务错误码枚举(若同文件或同module的 `error.ts` / `constants.ts` 里有定义)

**不要做的事**:

- 不要修改 autogen 文件
- 不要跑 `pnpm ytt`(那是 `/workflow-delta` 的职责)
- 不要从 autogen 里"发现"没在 spec 里出现过的接口——那不属于本次需求

## 三路合并 + 一致性检查

合并规则:

| 情况 | 处理 |
|---|---|
| spec 有 + autogen 有 + api_context 有 | 正常进清单,互相验证 |
| spec 有 + autogen 缺失 | 标 `api_gap`,告知用户先 `/workflow-delta`,脚本不为此接口生成 |
| spec 有 + autogen 有 + api_context 缺失 | 正常进清单,注释"api_context 未同步,建议跑 /workflow-delta" |
| spec 无 + autogen 有 | 跳过(不在本次范围) |
| spec 模糊引用 + autogen 匹配多个候选 | 列候选给用户,**不猜**,用自然语言问"spec 里的 XX 指的是这里的 A / B / C 哪个?" |

**字段级冲突**:spec 描述的字段与 autogen 类型不一致 → 以 autogen 为准(这是实际代码会发送的结构),在生成脚本的注释里标明:"spec §X 描述为 Y,实际 autogen 类型为 Z,采用 autogen"。

## 产出:接口清单表

展示给用户确认时用这个格式:

```markdown
### 冒烟覆盖接口清单(N 个)

| # | 接口名 | 方法 + 路径 | 入参 | 响应 | 来源 | spec 引用 |
|---|---|---|---|---|---|---|
| 1 | createTeam | POST /api/team | `CreateTeamReq` | `CreateTeamResp` | autogen/teamApi.ts | §4.2 / §6.1 |
| 2 | addMember | POST /api/team/:id/member | `AddMemberReq` | `AddMemberResp` | autogen/teamApi.ts | §4.3 |
| ...

### api_gap(autogen 中未找到)
- `getTeamStats` — spec §5.2 提到,autogen 中无对应函数。建议先 `/workflow-delta` 同步。

### implicit(spec 隐含,默认不覆盖,需要也告诉我)
- `getCurrentUser` — spec §4.1 "页面加载时" 推测,未显式提
```

用自然语言收尾:"上面 N 个接口会被覆盖,M 个标了 api_gap 需要先同步,K 个隐含接口默认不做。回复「继续」开始生成,或告诉我要调整哪里。"

## 判定边界

- **涉及登录 / 鉴权接口**:不生成脚本(用户说登录态通过 cookie 注入)。即使 spec 提到,也在清单里标"用户负责,skill 跳过"
- **仅用于长连接 / WebSocket / SSE 的接口**:跳过(不是冒烟范畴),注明原因
- **纯第三方外部接口**(例如直接打到支付平台):谨慎纳入,只生成正常场景,异常场景可能触发计费,交给用户决定是否保留

---

## 参数语义探测(SKILL.md Step 4.2 的细则)

autogen 类型只描述**签名**:字段名 / 类型 / 必选-可选。但后端在业务层经常强加**值域约束**,比如:

- `category_id?: string` 实际只接受**子类目** id,根节点 id 会返回空列表或业务错误
- `page_size?: number` autogen 标可选,实际不传会 500,或 size > 200 返回 code=400011
- `id: string` 路径参数,某些后端要求整数形式的字符串,传 UUID 会 `Service Not Found`

这些约束在 autogen 里**不会出现**(YApi 的备注字段可能有,取决于后端同学的习惯)。但它们**必在前端调用点**——因为前端必须满足约束才能跑通 UI。

### 查找路径

`mcp__auggie-mcp__codebase-retrieval` 按接口名 / autogen 导出函数名反查:

| 关键词 | 命中点 | 能拿到什么 |
|---|---|---|
| `ApiXxxPOST` / 接口函数名 | `src/pages/**/*.{vue,tsx,ts}` / `src/composables/*.ts` | 真实调用点:入参从哪取、响应怎么用 |
| `/api/xxx/yyy` 路径片段 | service 层 / api 封装 | URL 拼接方式、是否有额外 query |
| autogen 文件本身 | `autogen/*Api.ts` 顶部 JSDoc | YApi 备注(如果后端填了) |

### 要提取的 4 类语义约束

#### A. 字段值域(autogen 不显式)

```ts
// 在 src/pages/team-assets/official.vue 看到:
const categoryId = computed(() => tree.value?.list?.[0]?.children?.[0]?.id);
searchAssets({ category_id: String(categoryId.value) });
```

→ 约束:`category_id` 必须是 `list[*].children[0].id`(子类目),不是 `list[*].id`。

#### B. 前置数据依赖

```ts
// 看到 addMember 前总会走 selectTeam:
await setCurrentTeam(teamId);   // 更新 store.spaceId
await addMember({ teamId, email });
```

→ 约束:`addMember` 前必须 `spaceId` store 已就位(冒烟脚本 → `SMOKE_SPACE_ID` 必填)。

#### C. ID / slug 的格式偏好

```ts
searchById(String(resource.id));   // 数字 id 转字符串再传
```

→ 约束:path param 要字符串化,否则 `id=123` vs `id="123"` 后端可能严格区分。

#### D. 分页上限、过滤器默认值

```ts
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
```

→ 约束:边界场景用 `> 200` 试超限;正常场景用 `DEFAULT_PAGE_SIZE`。

### 记录格式(进 FLOW.md + ensureXxx)

每个接口一条「业务约束」表格:

| 接口 | 参数 | autogen 类型 | 业务约束 | 来源 |
|---|---|---|---|---|
| `POST /resources/search` | `category_id` | `string?` | 必须 `list[*].children[0].id`(子类目) | `src/pages/team-assets/official.vue:45` |
| `POST /resources/search` | `page_size` | `number?` | 上限 200;默认 20 | `src/constants/pagination.ts:3` |

生成脚本时,`ensureXxx()` 必须**按约束取数**,不只是按类型;FLOW.md 的「每步接口」章节必须**明文写出约束 + 来源路径**,让用户一眼看懂。

### 找不到调用点(接口新)

接口刚加、前端还没接入 → 标 `semantic_unknown`。SKILL.md Step 4 收尾展示清单时列出来,让用户:

1. 提供一个真实的请求示例(devtools 复制 curl),skill 据此反推约束
2. 或明确说"按 autogen 类型原样发,有问题再收紧"——生成脚本时加醒目注释

---

## 拦截器 header 提取(SKILL.md Step 3 的细则)

前端项目通常把 HTTP 客户端封装成 `axios.create` 实例或自定义 `defFetch`/`request` 函数,在 `interceptors.request.use` 或函数内部注入一批基建 header——**跳过这一层,冒烟脚本会一律 401/403**,却不容易看出是什么 header 缺失。冒烟脚本必须**继承**这些默认注入逻辑,不能只带 cookie。

### 查找入口

`mcp__auggie-mcp__codebase-retrieval` 关键词(挑 3-5 个试):

- `axios.create` / `interceptors.request.use` / `axios.defaults.headers`
- `defFetch` / `defaultHeaders` / `defaultOptions`
- `request interceptor` / `beforeRequest` / `transformRequest`
- `setRequestHeader` / `setHeader` / `X-Prod-Id` / `X-Client-Sn`

典型文件:

| 路径模式 | 常见项目 |
|---|---|
| `src/**/http.{ts,js}` / `src/**/request.{ts,js}` | 通用 |
| `src/**/api/index.{ts,js}` / `src/**/utils/fetch.{ts,js}` | 通用 |
| `packages/**/http/*.ts` / `packages/**/api-client/src/*.ts` | monorepo |
| `plugins/axios*.ts` / `composables/useFetch.ts` | Nuxt |

### 分类规则

找到拦截器后,逐项 header 分类:

| 来源 | skill 处理 | 示例 |
|---|---|---|
| **静态字符串** | 写成 `_shared/client` 模板内常量 | `'X-Model-Ver': 'v2.0'` |
| **环境变量(构建时)** | `VITE_APP_ID` / `NEXT_PUBLIC_*` → 映射 `SMOKE_<NAME>`,`.env.smoke.example` 给默认值 + 注释来源文件 | `'X-Prod-Id': import.meta.env.VITE_APP_ID` → `SMOKE_PROD_ID` |
| **cookie 字段** | 在 `_shared/env` 用 `extractCookieValue(cookie, '<name>')` 兜底 | `driveweb_identity` cookie → `X-Client-Sn` |
| **全局 store / localStorage** | 浏览器运行时状态,脚本无法复现 → 要求 `.env.smoke` 显式填,给 `SMOKE_<NAME>` 占位,README 说明去浏览器 devtools Network → Headers 抓 | `spaceId` / `currentTeamId` |
| **签名 / 时间戳(运行时计算)** | 如果能复现签名算法,直接搬进 `_shared/client`;算法复杂(有私钥 / HMAC 秘钥)则在 README 标"需用户贴一个真实 `X-Signature` 到 `SMOKE_SIGNATURE`,过期就换",不尝试伪造 | `X-Signature` / `X-Timestamp` |
| **Trace / 请求 ID** | 脚本自生成 UUID → `X-Trace-Id` | `X-Request-Id` |

### 产出规则表

给 Step 6 写模板用:

```
default_headers:
  static:
    X-Model-Ver: v2.0
    X-Lang: zh-cn
  from_env:
    X-Prod-Id: SMOKE_PROD_ID (来源: src/plugins/axios.ts:L12, VITE_APP_ID)
    X-Prod-Ver: SMOKE_PROD_VER (来源: package.json.version)
  from_cookie:
    X-Client-Sn: extractCookieValue(cookie, 'driveweb_identity')
  from_env_required:
    X-Space-Id: SMOKE_SPACE_ID (必须用户填;来源: store/user.ts:L40)
  from_signature:
    X-Signature: (skip — 需要用户贴真实值)
  runtime_generated:
    X-Trace-Id: () => randomUUID()
```

### 常见项目示例

**reelmate 类**(Vite + 自定义 defFetch):`X-Prod-Id` + `X-Prod-Ver` + `X-Model-Ver` + `X-Lang` + `X-Space-Id` + `X-Client-Sn` 从 cookie `driveweb_identity` 抽。

**中后台 Vue Admin 类**(axios 封装):`Authorization: Bearer <token>`(从 localStorage / cookie 抽 token),`X-Tenant-Id`(从 store)。

**Next.js + tRPC 类**:通常不注入自定义 header,走 Next Auth 的 session cookie + CSRF token(`X-CSRF-Token` 从 cookie 抽)。

### 找不到拦截器

项目是极简的 `fetch` 裸调用 → skip 本节,脚本只注入 Cookie + UA + Origin + Referer。
