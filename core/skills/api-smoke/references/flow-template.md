# `FLOW.md` 模板 — 业务调用链设计文档

和 `report.md`(动态运行产物)并列的**静态设计文档**,排查"这条链路为什么长这样"的时候读。

- `README.md` 教你怎么**跑**
- `FLOW.md` 教你怎么**读懂**
- `report.md` 告诉你**这一次跑**的结果

skill 在 Step 7 必须同时产出 README.md 和 FLOW.md。内容按下面模板展开,字段从 Step 4 三路汇聚 + 参数语义探测 + Step 5 依赖图直接填。

## 模板

```markdown
# <feature-slug> 接口冒烟 — 调用流程与排查手册

> 排查某次失败时:**先看 report.md(时间轴 + 关键数据)→ 再看本文件(业务逻辑)→ 最后看 logs/run-*.ndjson**。

## 1. 调用链路图

<!-- 从 Step 5 依赖图生成。每条线标:上游响应字段 → 下游入参 -->

```
┌────────────────────────────┐
│ 01 官方资产类目列表        │
│ GET /category/tree         │
│ 产出: list[*].children[].id│
└─────────────┬──────────────┘
              │ list[0].children[0].id  → category_id
              ▼
┌────────────────────────────┐
│ 02 官方资产资源列表        │
│ POST /resources/search     │
│ 产出: list[0].id           │
└─────────────┬──────────────┘
              │ list[0].id  → :id / body.id
              ▼
┌────────────────────────────┐
│ 03 官方资产资源下载        │
│ POST /resources/element/   │
│      :id/download          │
│ 产出: element_list[0].download_url │
└────────────────────────────┘
```

## 2. 每个接口 — 入参 / 出参 / 取数据逻辑 / 业务约束

### 2.1 01 官方资产类目列表

- **路径**:`GET /web/v1/df/crc/category/tree`
- **autogen**:`packages/api/lib/autogen/teamAssetsApi.ts` (`ApiDfCrcCategoryTreeGET`)
- **YApi**:http://yapi.wondershare.cn/project/1443/interface/api/278651

**入参**(query)

| 字段 | 类型 | 必填 | 业务约束 | 默认 |
|---|---|---|---|---|
| `is_tree` | `'0' \| '1'` | 否 | autogen 没说,前端调用点(`src/pages/team-assets/official.vue:23`)默认传 `'1'` | `'1'` |
| `order` | `'asc' \| 'desc'` | 否 | 同上,默认 `'desc'` | `'desc'` |

**出参关键字段**

```ts
{ code: 0, data: { list: Array<{ id: number, title: string, children: Array<{ id: number, ... }> }> } }
```

**取数据逻辑(fixture.categoryId)**

```js
// ❗ 业务约束:category_id 必须是子类目 id,根节点不认
function pickCategoryId(tree) {
  for (const node of tree.list) {
    if (node?.children?.[0]?.id) return node.children[0].id;   // 取第一条非空 children 的首个子节点
  }
  return undefined;
}
```

**required 前置**:cookie + 拦截器 header 完整即可,无业务前置。

### 2.2 02 官方资产资源列表

- **路径**:`POST /web/v1/df/crc/resources/search`
- **autogen**:`ApiDfCrcResourcesSearchPOST`

**入参**(body)

| 字段 | 类型 | 必填 | 业务约束 | 默认 |
|---|---|---|---|---|
| `category_id` | `string` | **事实必填** | **必须是子类目 id**(`list[*].children[0].id`);根节点 id 返回空列表(autogen 标可选,但前端调用点始终传) | 无 |
| `keyword` | `string` | 否 | 空串即"不过滤" | `''` |
| `order_by` | `number` | 否 | 1=Best Match, 8=最新;来源 `src/constants/search.ts` | `1` |
| `page` | `number` | 否 | 从 1 开始 | `1` |
| `page_size` | `number` | 否 | 上限 **200**(来源 `src/constants/pagination.ts:3`),YApi 标注同值;超限后端不拒绝,静默超发 | `20` |

**出参关键字段**

```ts
{ code: 0, data: { list: Array<{ id: number, slug: string, title: string, ... }>, pagination: {...} } }
```

**取数据逻辑(fixture.resourceId / fixture.resourceSlug)**

```js
async function ensureResourceId() {
  const { resourceId } = loadFixture();
  if (resourceId) return resourceId;
  const categoryId = await ensureCategoryId();   // ❗ 先拿子类目 id
  const r = await client.post('/web/v1/df/crc/resources/search', {
    category_id: String(categoryId),
    keyword: '', order_by: 1, page: 1, page_size: 10,
  });
  const first = r.data.data.list[0];
  saveFixture({ resourceId: first.id, resourceSlug: first.slug });
  return first.id;
}
```

**required 前置**:`01` 产出有 children 的类目树。

### 2.3 03 官方资产资源下载

- **路径**:`POST /web/v1/df/crc/resources/element/:id/download`

**入参**

| 位置 | 字段 | 类型 | 业务约束 |
|---|---|---|---|
| path | `:id` | `string` | 必须 string 化(数字 id 用 `String(id)`);必须是 02 搜到的 `list[0].id` |
| body | `{ id: string }` | `{ id: string }` | body.id 与 path id 必须相同,冗余校验 |

**出参关键字段**

```ts
{
  code: 0,
  data: {
    element_list: Array<{
      id: number,
      download_url: string,     // ⬅ 真实 CDN 地址,内容是 ComfyUI workflow JSON
      preview_url: string,
      ...
    }>
  }
}
```

**required 前置**:`02` 经由 `category_id` 拿到的合法 resourceId。不走 category 的全库搜索可能拿到测试脏数据(`test_Effect_Particle_*`),业务链路不真实。

## 3. 请求公共 header 解读

冒烟脚本的每次请求都带以下 header(见 `_shared/client.mjs`):

| Header | 来源 | 必要性 |
|---|---|---|
| `Host` | `SMOKE_HOST` | HTTPS SNI + HTTP 路由;IP 直连必填 |
| `Cookie` | `SMOKE_COOKIE` | 登录态 |
| `Origin` / `Referer` | `${protocol}://${host}` | 部分后端 CSRF 校验 |
| `User-Agent` | Chrome 指纹 | 部分后端拦截非浏览器 UA |
| `X-Prod-Id` | `SMOKE_PROD_ID`(Step 3 拦截器探测) | defFetch 注入;缺失后端拒识 |
| `X-Prod-Ver` | `SMOKE_PROD_VER` | 同上 |
| `X-Model-Ver` | `SMOKE_MODEL_VER` | 同上 |
| `X-Lang` | `SMOKE_LANG` | 决定响应里 `language.*` 的默认展示 |
| `X-Client-Sn` | cookie `driveweb_identity` 抽取 | 设备 id;防重放 |
| `X-Space-Id` | `SMOKE_SPACE_ID` | 团队上下文;团队相关接口必填 |

**鉴权失败的典型形态**(cookie 错 vs header 错):

- **cookie 过期** → `status=401` 或 `status=200 + body.code != 0 + msg="User not login err"`
- **缺拦截器 header** → `status=401` 或 `status=200 + body.code=<签名错误码>`
- **`X-Space-Id` 错** → `status=200 + 返回空列表`(不会 401,很隐蔽)

## 4. 排查路径(三层)

| 层 | 看什么 | 工具 |
|---|---|---|
| **第一层** 快速定位 | `report.md` 顶部摘要块 → 一眼看 FAIL 分布、链路关键数据对不对、业务 code 异常 | 打开 `report.md` |
| **第二层** 业务逻辑 | 本文件 §2 每个接口的业务约束 → 确认调用链是否符合 spec | 读 `FLOW.md` |
| **第三层** 原始数据 | `logs/run-*.ndjson` 完整出入参 | `jq` 过滤 |

**jq 速查**

```bash
# 最近一次 run 的所有失败请求
jq -c 'select(.responseStatus >= 400)' logs/run-<ts>.ndjson

# 某接口的业务 code 分布
jq -c 'select(.url | test("/resources/search")) | {status:.responseStatus, code:(.responseBody|fromjson?.code), msg:(.responseBody|fromjson?.msg)}' logs/run-<ts>.ndjson | sort -u

# 某个用例的完整请求响应
jq 'select(.suite=="02 官方资产资源列表" and .test=="正常: ...")' logs/run-<ts>.ndjson

# 找 5xx
jq -c 'select(.responseStatus >= 500) | {ts, url, body: (.responseBody|.[:200])}' logs/run-<ts>.ndjson

# 统计 cookie 用量(redact 后看字节数)
jq -r '.requestHeaders.Cookie' logs/run-<ts>.ndjson | sort -u
```

## 5. 失败三分类决策树

```
请求失败?
├─ 网络错误 / TLS 错 / TCP 不通
│   → env-issue: 查 SMOKE_RESOLVE_IP / SMOKE_TLS_REJECT_UNAUTHORIZED / VPN
├─ 全量 401 且 cookie 非空
│   → env-issue: cookie 过期 or 拦截器 header 不全
├─ 特定接口 Service Not Found / 路由 404
│   → env-issue: 测试环境未部署该路由;换环境或找运维确认
├─ 后端返回字段与 autogen 类型不符 / msg 指向 contract delta
│   → contract-drift: 找后端确认,走 /fix-bug
├─ 脚本 TypeError / URL 拼错 / body 字段名拼错
│   → script-bug: 当场修脚本重跑
└─ 其它(PASS 但业务 msg 异常,如静默超限、code 映射不准)
    → 🟡 软警告,建议反馈后端,不阻塞冒烟结论
```

## 6. 版本 delta
<!-- 手动维护,每次 skill 重跑后如果有业务约束改变,在这里加一行 -->

- 2026-04-29 初始化,3 个接口
```

## 如何让 skill 自动填充模板

skill 在 Step 7 生成 FLOW.md 时,按以下顺序填:

1. **调用链路图**:从 Step 5 依赖图输出,箭头标注"上游响应路径 → 下游入参"
2. **每接口入参/出参**:从 autogen 响应类型 + Step 4.2 参数语义探测结果合成
3. **取数据逻辑**:复用业务脚本里的 `ensureXxx()` 代码片段
4. **required 前置**:从依赖图节点关系
5. **公共 header 解读**:从 Step 3 拦截器探测规则表
6. **jq 速查**:把归一化后的 URL 替换进模板
7. **失败三分类决策树**:复用 `scenario-matrix.md § 失败分类` 的规则

## 为什么 FLOW.md 不合并进 README

- README 读者 = 刚拿到脚本想跑的人;要的是命令 + 最简说明
- FLOW.md 读者 = 排查出问题的人;要的是业务约束 + 数据流
- 合成一篇会让"怎么跑"被"业务约束"淹没,新人找不到命令;拆两篇两边都清爽
