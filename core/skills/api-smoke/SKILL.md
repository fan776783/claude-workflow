---
name: api-smoke
description: "Use when 用户说「接口冒烟」「生成接口测试脚本」「联调前验接口」「api smoke」「验一下后端」, or 前端想在 UI 成型前先验后端 contract。登录态由用户 cookie 注入,skill 不做登录。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:无活跃 workflow 且用户未指定 spec / autogen 文件时,直接告知需先 `/workflow-spec` 或手动指定来源,不走 code-specs 读取。
</PRE-FLIGHT>

<PATH-CONVENTION>
- 所有 CLI 调用使用固定公共路径 `~/.agents/agent-workflow/core/utils/workflow/`。该路径在 `npm install` 后始终存在,所有 agent 共享,无需动态解析。
- 本 skill 的 bundled assets(`_shared/*.mjs` / `run-all.mjs` / `env.smoke.example` / `gitignore`)位于 `~/.agents/agent-workflow/core/skills/api-smoke/assets/`。Step 6 生成脚本时优先 `cp` 这些文件,然后按项目定向修改。
</PATH-CONVENTION>

# api-smoke

> `/api-smoke` 的完整行动指南。**独立 skill,不进 workflow 状态机、不占 quality gate、不调 workflow_cli 写命令**——只 read-only 读 `status` / `context`。

## 核心边界

| 做 | 不做 |
|---|---|
| 读 spec + autogen + 前端调用点代码 + state.api_context 生成脚本 | 改 workflow 状态 / 帮用户 `pnpm ytt`(交给 `/workflow-delta`) |
| 自动继承项目 HTTP 拦截器注入的 header | 自动化登录(用户自己贴 cookie) |
| 支持 IP 直连 + Host/SNI 绑定(内网测试环境) | 自己跑后端服务 |
| 跑完按 contract-drift / script-bug / env-issue 三分类归纳失败 | 凭空构造未定义的接口(标 `api_gap` 退让) |
| 场景矩阵全量(7 类 + 可选 contract-follow-through) | 把环境问题当 contract 问题报给用户 |

日志 / fixture / 路径约束是硬规则,见下节 HARD-GATE。

## 硬规则(HARD-GATE)

1. **路径自定位**:脚本内所有文件路径(`.env.smoke` / `.smoke-fixture.json` / `logs/` / `trace.log` / `report.md`)必须用 `fileURLToPath(import.meta.url) + resolve()` 自定位。*禁用 `process.cwd()`*——用户从子目录(例如 `pnpm -F <pkg> <cmd>` 改变 cwd、或 `cd scripts/api-smoke/<slug> && node 01-*.mjs`)跑时,`process.cwd()` 会指向非预期目录,读不到 `.env.smoke`、写不到 `logs/`,表现是一切"找不到文件"错误,排查成本高
2. **fixture 必 JSON 持久化**:`_shared/fixture.*` 用文件 + `loadFixture/saveFixture`。*禁止 `export const fixture = {...}` 这类 module 级常量*——`run-all` 用 `spawnSync` 起子进程串联,子进程与父进程不共享内存,module 级对象只在当前进程有效,02-* 脚本读不到 01-* 写的 teamId,只能每个脚本自己再跑一遍依赖接口,流量翻倍且违反"链路冒烟"语义
3. **默认产物必须写 `logs/` + `report.md`**:不是可选项。*日志必含 `suite/test` 归属字段*(没有这两列无法定位失败用例)、*不 truncate response body*(截断后排查 contract-drift 就丢了关键证据)、*cookie 必 redact*(原文入盘会造成凭据泄漏,哪怕只是 gitignore 兜底也不够)

## Checklist(按序执行)

1. ☐ 预检 + 读取 workflow 状态 + 测试栈探测
2. ☐ 解析用户 prompt 里的 cookie / host / IP,准备 `.env.smoke`
3. ☐ 扫项目 HTTP 拦截器,提取默认注入 header
4. ☐ 三路汇聚接口清单 **+ 参数语义探测**(前端调用点业务约束)
5. ☐ 构建依赖图 + 登录态 / 环境 convention
6. ☐ 生成脚本(`cp` bundled assets → 业务脚本)+ 连通性自检
7. ☐ 生成 README + **FLOW.md** + `.gitignore` + 失败三分类模板

---

## Step 1: 预检 + 读状态 + 栈探测

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
```

**分流**:

- 有活跃 workflow → 记 `spec_file` / `plan_file` / `api_context.interfaces` / `project_root`
- 无活跃 workflow + 用户传了 spec 路径参数 → 以该路径为 spec,跳过 `api_context`
- 无活跃 workflow 且无参数 → 告知用户先 `/workflow-spec` 或 `/api-smoke <spec-path>`,退出

**测试栈探测**(从 `.claude/config/project-config.json` + `package.json`):

| 条件 | 栈 | HTTP 客户端 |
|---|---|---|
| `tech.testing.framework == 'vitest'` | vitest | 依赖含 `axios` → axios;否则原生 `node:https` |
| `tech.testing.framework == 'jest'` | jest | 同上 |
| 未检测到 / 裸项目 | 纯 Node.js ≥18 | `node:https` / `node:http`(支持 IP 直连) |

**HTTP 实现选择**:即使项目有 axios,若需要 IP 直连 + Host/SNI 绑定(Step 2 识别到),强制走 `node:https.request` 模板——axios 对 SNI 分离场景支持不稳定。

---

## Step 2: 解析用户 prompt + 准备 `.env.smoke`

**扫用户最新消息**,按以下模式提取:

| 模式 | 抽取到 | 去向 |
|---|---|---|
| `cookie: xxx` / `Cookie: xxx` / 浏览器 devtools 格式的 `a=b; c=d;` | `SMOKE_COOKIE` | `.env.smoke` |
| `host: xxx.com` / `域名: xxx.com` / URL 形式 | `SMOKE_HOST` | `.env.smoke` |
| IP(`10.x.x.x` / `192.168.x.x` / `a.b.c.d` 形式)且与 host 一起给 | `SMOKE_RESOLVE_IP` | `.env.smoke` |
| `https://` / `http://` 前缀 | `SMOKE_PROTOCOL` | `.env.smoke` |
| 手动指定的业务上下文(team id / project id / space id) | `SMOKE_<CTX>` | `.env.smoke` |

**策略**:

- 识别到 **任意一项** → 同时生成 `.env.smoke.example`(模板,注释用)和 `.env.smoke`(实填,.gitignore 里屏蔽)
- 未识别到 → 只生成 `.env.smoke.example`,让用户手动拷贝填写
- **识别出的 cookie 在展示给用户的回复里 redact**(只说"已从 prompt 提取 cookie (XXX bytes) 写入 .env.smoke"),不回显原文
- 生成 `.gitignore`(直接 `cp assets/gitignore`)

---

## Step 3: 扫项目 HTTP 拦截器,提取默认 header

**目的**:项目的 axios instance / 自定义 `defFetch` / request interceptor 通常会注入 `X-Prod-Id` / `X-Client-Sn` / `X-Space-Id` / `X-Lang` 等基建 header;裸请求会 401/403。**这一步决定了冒烟脚本能不能跑通**。

**查找方式**(`mcp__auggie-mcp__codebase-retrieval`):

- 关键词:`axios.create`、`interceptors.request.use`、`defFetch`、`request interceptor`、`defaultHeaders`、`setRequestHeader`、`beforeRequest`
- 典型文件:`src/**/http.{ts,js}`、`src/**/request.{ts,js}`、`src/**/api/index.{ts,js}`、`packages/**/http/*.ts`

**提取内容**:

1. 默认注入的 header 键值(静态 + 动态)
2. 动态 header 的来源:
   - 从环境变量(`VITE_*` / `NEXT_PUBLIC_*`)读取 → 映射到 `SMOKE_<NAME>`
   - 从 cookie 抽字段(例如 `driveweb_identity` → `X-Client-Sn`)→ 在 `_shared/env` 里用 `extractCookieValue()` 兜底
   - 从全局 store / localStorage 读(例如 `spaceId`)→ 要求用户在 `.env.smoke` 显式填,给 `SMOKE_<NAME>` 占位

**产出**:一份 `default_headers` 规则表,交给 Step 6 写进 `_shared/client` 模板 + `.env.smoke.example`。

**找不到拦截器**的项目 → 照常,只注入 Cookie + UA + Origin/Referer。

---

## Step 4: 三路汇聚接口清单 + 参数语义探测

详细协议见 [`references/extraction-protocol.md`](references/extraction-protocol.md)。

### 4.1 三路汇聚(路径 + 类型)

1. **spec.md**(范围过滤)— 用户可见行为 / Data Models / 验收标准里出现的接口
2. **`state.api_context.interfaces`**(辅)— `/workflow-delta` 同步过的标准化接口表
3. **YApi autogen**(详细)— `autogen/*.ts` / `*Api.ts` / `.api.ts`,拿请求函数签名 + 入参 / 响应类型

一致性规则:spec 提到但 autogen 缺失 → `api_gap`;autogen 有但 spec 没提 → 跳过;字段冲突 → 以 autogen 为准。

### 4.2 参数语义探测(autogen 看不出的业务约束)

**关键步骤**。autogen 类型只写了 `category_id?: string`,但后端实际要求"必须子类目 id,根节点 id 不认"——这类语义约束藏在 **前端调用点代码** + YApi 备注里,不看会导致冒烟脚本"参数合法但业务失败"。

**查找方式**(`mcp__auggie-mcp__codebase-retrieval`):

- 搜接口名 / autogen 导出的请求函数名 → 命中 `src/pages/**/*.{vue,tsx,ts}` / `src/composables/*` 里的真实调用点
- 看调用点的**参数来源**:`const categoryId = tree.list[0].children[0].id`(不是 `list[0].id`)→ 约束是"子类目 id"
- 看 `autogen/*Api.ts` 里的 JSDoc 注释(YApi 备注通常同步进来)

**产出**:给每个接口写一行「业务约束」,进 Step 7 FLOW.md + 对应脚本的 `ensureXxx()` 实现。

| 接口 | autogen 说 | 前端调用点实际用 | 业务约束 |
|---|---|---|---|
| `POST /resources/search` | `category_id?: string` | `list[*].children[0].id` | 必须**子类目** id |
| `POST /team/member/add` | `teamId: number` | 需 `spaceId` 同 store | 需先选团队 |

找不到调用点(接口新、前端还没接)→ 标 `semantic_unknown`,在 FLOW.md 写明,不猜。

### 4.3 用户 prompt 优先

用户 prompt 里直接列了接口名(例如"对 A/B/C 三个接口冒烟"),以用户列表为准,spec 作为语义补充,autogen 提供类型。

**收尾**:"上面是本次冒烟要覆盖的 N 个接口,每个接口的业务约束已标注在 FLOW.md,回复「继续」我开始生成脚本;要增减告诉我。"

---

## Step 5: 依赖图 + 登录态 convention

详细规则见 [`references/dependency-graph.md`](references/dependency-graph.md)。

- 依赖按 spec 显式业务 workflow → 响应字段复用 → 拓扑排序得脚本编号(`01-*` / `02-*`)
- fixture 默认用 `.smoke-fixture.json` 持久化,跨进程/跨脚本共享(含 `runId` + `ttl`);`run-all` 场景不再让每个脚本重跑依赖补齐
- 登录态统一通过 `SMOKE_COOKIE` 注入;鉴权异常场景在用例内临时覆盖,不污染全局
- 环境变量清单:基础(`SMOKE_HOST` / `SMOKE_PROTOCOL` / `SMOKE_PORT` / `SMOKE_RESOLVE_IP` / `SMOKE_COOKIE` / `SMOKE_TIMEOUT_MS` / `SMOKE_TLS_REJECT_UNAUTHORIZED` / `SMOKE_VERBOSE`)+ Step 3 的拦截器 header + 业务上下文

---

## Step 6: 生成脚本 + 连通性自检

场景矩阵见 [`references/scenario-matrix.md`](references/scenario-matrix.md);模板见 [`references/script-templates.md`](references/script-templates.md)。

**优先 `cp` bundled assets,不要从 markdown 复制粘贴**:

- `assets/_shared/*.mjs`(env / fixture / assertions / client / report / dump / contract-check)
- `assets/run-all.mjs`
- `assets/env.smoke.example` → 改名 `.env.smoke.example`
- `assets/gitignore` → 改名 `.gitignore`

用 `cp` 后按 Step 3 拦截器探测结果 *定向编辑* `_shared/env.mjs` 里的 header 字段 + `.env.smoke.example` 占位。业务脚本(`NN-*.smoke.mjs`)按 script-templates.md 的范式从头写。这样 6 份公共代码的版本由 skill 控制,避免每次 regenerate 产生细微差异。

**目录结构**(相对 `project_root`):

```
scripts/api-smoke/<feature-slug>/
├── .env.smoke.example
├── .env.smoke                   # Step 2 有提取则写,无则仅 example
├── .gitignore                   # 从 assets/gitignore cp(.env.smoke / trace.log / logs/ / report.md / .smoke-fixture.json / dump/)
├── README.md
├── FLOW.md                      # 业务调用链 + 每步入出参 + 排查路径(template: references/flow-template.md)
├── report.md                    # run-all 结束自动生成(template: references/report-template.md)
├── logs/                        # NDJSON 每次运行完整出入参(run-<timestamp>.ndjson)
├── trace.log                    # 可选(SMOKE_VERBOSE=1,控制台副本)
├── .smoke-fixture.json          # 跨脚本 JSON fixture(自动清理,gitignore)
├── _shared/
│   ├── client.{ts,js,mjs}       # IP+SNI + 拦截器 header + NDJSON 日志 + redact + 可选静默重试
│   ├── env.{ts,js,mjs}          # 路径自定位读 .env.smoke
│   ├── assertions.{ts,js,mjs}   # expect2xx / expectBizOk / expectNotLogin / expectBizCode + Runner(runnerContext)
│   ├── fixture.{ts,js,mjs}      # JSON 持久化(loadFixture / saveFixture / clearFixture)
│   ├── runner.{ts,js,mjs}       # 纯 Node 栈最小 test runner(向 client 注入 suite/test)
│   ├── report.{mjs,ts}          # NDJSON → report.md 生成器(P0-4)
│   ├── contract-check.{mjs,ts}  # autogen 类型 vs 实际响应 diff(P2-10,可选)
│   └── dump.{mjs,ts}            # 单接口完整 dump 工具(P2-11)
├── run-all.{ts,js,mjs}          # 子进程串联 + 结束自动跑 report.mjs
└── NN-<接口名>.smoke.{ts,js,mjs}
```

**顺序**:先 `_shared/`(env → fixture → assertions+runner → client → report → dump),再依赖图根节点,沿拓扑序写业务脚本。每个业务脚本覆盖 7 类场景(正常 / 参数异常 / 鉴权异常 / 权限异常 / 资源异常 / 业务错误 / 边界),可选第 8 类 contract-follow-through(关键 URL 字段下载校验)。

**连通性自检**(生成完成后,若 `.env.smoke` 已就位):

1. 跑 `01-*.smoke.*` 的"正常"用例一条
2. 判定结果:
   - `2xx + code=0` → 全量生成完成,告知用户可 `run-all`
   - `4xx/5xx` 且非预期 → 打印完整 verbose trace,**按失败三分类初步归纳**(contract-drift / script-bug / env-issue),给用户下一步建议
   - 网络错误 / 证书错误 → 归 env-issue,提示检查 `SMOKE_RESOLVE_IP` / `SMOKE_TLS_REJECT_UNAUTHORIZED`
3. 自检不强制通过——用户可能没开 VPN / 没给完整 cookie,自检失败不删脚本,只在终端报告

---

## Step 7: README + FLOW.md + 失败三分类模板

**同时产出两份文档**(不是二选一):

### README.md(运行指南)

- 本次覆盖的接口清单
- cookie 获取说明(浏览器 devtools Application → Cookies)
- `.env.smoke` 变量清单(含 Step 3 提取的拦截器 header 说明)
- 按探测栈给出的运行命令(单跑 / `run-all` / `SMOKE_VERBOSE=1` / `SMOKE_RETRY=1`)
- **产物导航**:出事先看哪个文件 → `report.md`(时间轴 + 链路 + 首样例)→ `FLOW.md`(业务逻辑)→ `logs/run-*.ndjson`(原始数据)→ `trace.log`(verbose 控制台副本)
- **失败三分类模板**(`references/scenario-matrix.md § 失败分类`):跑完后按 contract-drift / script-bug / env-issue 归纳,给下一步动作
- 扩展说明(新增接口 / 场景只加文件,不影响已生成脚本)

### FLOW.md(业务调用链设计文档)

模板见 [`references/flow-template.md`](references/flow-template.md)。内容:

- 调用链路图(01 → 02 → 03 数据依赖)
- 每步接口:入参 convention(**含 autogen 看不出的业务约束**,如 "category_id 必须是子类目 id")/ 出参关键字段 / 取数伪码 / required 前置
- 请求公共 header 解读(哪些是 defFetch 注入、鉴权失败的典型形态)
- 排查三层(报告 → 业务逻辑 → NDJSON 原始)+ `jq` 速查命令

**FLOW.md 不是 README 的子集**——README 教跑脚本,FLOW.md 教怎么读懂"这条调用链为什么长这样"。

`.gitignore` 从 `assets/gitignore` 直接 `cp`,内容:`.env.smoke`、`trace.log`、`logs/`、`report.md`、`.smoke-fixture.json`、`dump/`。

---

## 产物路径

| 产物 | 路径 | 说明 |
|---|---|---|
| 脚本目录 | `<project_root>/scripts/api-smoke/<feature-slug>/` | 全部产物根 |
| 链路报告(**排查先看这个**) | `report.md` | 每次 `run-all` 后自动刷新;含顶部醒目摘要块 |
| 业务逻辑手册 | `FLOW.md` | 调用链 + 参数语义 convention |
| NDJSON 原始日志 | `logs/run-<timestamp>.ndjson` | 完整出入参 + suite/test 归属 + cookie redact |
| Verbose 控制台副本 | `trace.log` | 可选(SMOKE_VERBOSE=1) |
| 跨脚本 fixture | `.smoke-fixture.json` | 自动清理(runId + ttl) |
| workflow 状态(只读) | `~/.claude/workflows/{projectId}/workflow-state.json` | |
| 接口 contract 源(只读) | `<project_root>/**/autogen/*.ts` / `*Api.ts` | |
| 前端调用点(只读,Step 4 参数语义探测用) | `<project_root>/src/**/*.{vue,tsx,ts}` | 看 autogen 看不出的业务约束 |

## 协同 Skills

| Skill | 关系 |
|---|---|
| `/workflow-delta` | 同步 `api_context.interfaces` + 生成 autogen;api-smoke 消费其产物 |
| `/workflow-execute` | 前端联调阶段用户手动调 `/api-smoke`,不影响执行管线 |
| `/fix-bug` | 冒烟归为 contract-drift 的失败 → 用 `/fix-bug` 处理单个缺陷 |
| `/diagnose` | 冒烟归为 env-issue / 非确定性异常 → 进 `/diagnose` 建反馈循环 |
