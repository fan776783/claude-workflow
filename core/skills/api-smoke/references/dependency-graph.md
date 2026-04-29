# 依赖图与登录态 convention

冒烟不是孤立接口的单元测试——很多接口需要前置业务数据才能跑。这份协议定义如何推断顺序、如何传递数据、登录态怎么塞。

## 依赖推断(按序)

### 1. spec 显式业务 workflow → 强依赖

spec 里出现「创建团队 → 添加成员 → 发布通告」这种顺序叙事 → 按叙事给接口编号:

```
01-create-team.smoke.ts   # 正常场景产出 teamId 放入 fixture
02-add-member.smoke.ts    # 从 fixture 取 teamId
03-publish-notice.smoke.ts
```

### 2. 响应字段 → 下一接口入参

autogen 类型里明显的数据流(`CreateTeamResp.teamId` 出现在 `AddMemberReq.teamId`)→ 强依赖,即使 spec 没明写也要串起来。

### 3. 拿不准的依赖 → `TODO` 注释

spec 没明写、autogen 类型里也看不出数据流的潜在依赖 → **不硬写**,在脚本里留:

```ts
// TODO(依赖方): 本接口可能需要先调用 getUserRole 拿角色信息,
// spec 未明确,自行确认后补充 fixture 或在环境变量提供
```

### 4. 独立接口 → 独立脚本

和任何其他接口都没数据流依赖 → 独立编号,不进依赖链。

## fixture 传递机制

**统一用 `.smoke-fixture.json` 持久化**,跨脚本 / 跨进程共享。`run-all` 用子进程串联也能让 02 / 03 直接拿到 01 的产出,不用每个脚本再跑一轮依赖补齐接口。

### 文件结构

```json
{
  "runId": "2026-04-29T15-59-11_abc123",
  "createdAt": "2026-04-29T15:59:11.000Z",
  "ttlMs": 3600000,
  "data": {
    "categoryId": 1503718561,
    "resourceId": 1509722505,
    "teamId": null
  }
}
```

- `runId` — 每次 `run-all` 开始时写一个新 ID,单跑某个脚本时若文件不存在则当场建
- `ttlMs` — 过期时间,默认 1h;过期视为 cold start,丢弃内容,触发 ensure 兜底
- `data` — 各脚本产出的共享值

### 读写 convention

`_shared/fixture.{mjs,ts}` 暴露三个函数:

```ts
export function loadFixture(): FixtureData     // 读文件,过期返回 {}
export function saveFixture(patch: Partial<FixtureData>): void  // 浅合并后写回
export function clearFixture(): void           // 删除文件
```

脚本使用:

```ts
// 01 脚本:跑完正常用例写入
import { saveFixture } from './_shared/fixture';
saveFixture({ categoryId: resp.data.list[0].id });

// 02 脚本:用前先读,无则兜底调 01 的接口补齐
import { loadFixture, saveFixture } from './_shared/fixture';
let { categoryId } = loadFixture();
if (!categoryId) { categoryId = await ensureCategoryId(); saveFixture({ categoryId }); }
```

### `ensureXxx()` 兜底(单跑也能跑通)

每个业务脚本的头部定义 `ensureXxx()`:fixture 里有就直接返回,没有就调依赖接口拿一次、写回 fixture。这样:

- **单跑** `02-*.smoke.*` → `.smoke-fixture.json` 不存在 / 无 categoryId → `ensureCategoryId()` 自行补齐
- **run-all** 串联跑 → 01 已写 fixture,02 读到直接用,不重跑

**避免**:跨脚本硬编码 ID(`"teamId": 123`)——这只在你本地数据库是这个 ID 的时候能跑。

### 并发 run-all 安全

`run-all` 采用子进程 `spawnSync` 串行(不并行),每个脚本内部可能并发 `it`,但都读同一份 `.smoke-fixture.json`,fixture 写入为全文件覆盖(读-merge-写),单脚本内不并发写同一字段时是安全的。

`clearFixture()` 在 `run-all` 启动时调用,保证 runId 新鲜。

## 登录态注入

### 标准 convention

- **唯一入口**:`.env.smoke` 里的 `SMOKE_COOKIE` 变量
- client 读取后塞进 `Cookie` header 发请求
- 用户从浏览器 devtools 复制 Cookie 字符串,**完整粘贴**(包含所有 `key=value; key=value`)

### 不做什么

- **不调用任何登录接口**——哪怕它出现在 autogen 里。登录通常涉及验证码 / SSO / 企业微信 / 钉钉扫码等 workflow,脚本无法自动化
- **不持久化 cookie**——每次运行依赖环境变量,过期了用户重新复制

### 鉴权异常场景(401)

不污染 `SMOKE_COOKIE`,用请求级覆盖:

```ts
// vitest / jest
it('空 cookie 应返回 401', async () => {
  const resp = await client.post('/api/team', payload, { cookie: '' });
  expect(resp.status).toBe(401);
});
```

client 接口必须支持**每次请求覆盖 cookie** 的参数;`_shared/client` 生成时要把这个开关做进去。

## 环境变量清单

从 spec 识别,生成到 `.env.smoke.example`:

| 变量 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `SMOKE_BASE_URL` | ✅ | 后端 API 根地址(不含路径,含协议) | `https://api-dev.example.com` |
| `SMOKE_COOKIE` | ✅ | 浏览器 devtools 复制的完整 Cookie | `sessionid=abc; csrftoken=xyz` |
| `SMOKE_<CTX>` | 条件 | spec 里暗示需要的业务上下文(团队 ID / 租户 ID) | `SMOKE_TEAM_ID=10086` |
| `SMOKE_TIMEOUT_MS` | 可选 | 单请求超时,默认 10000 | `30000` |

**识别 `SMOKE_<CTX>` 的启发式**:

- spec 描述「在现有团队里添加成员」,但没说从哪创建 → 需要 `SMOKE_TEAM_ID`
- spec 描述「切换到项目 A 再操作」 → 需要 `SMOKE_PROJECT_ID`
- **预先存在的业务上下文**通常都需要一个环境变量,让用户提供真实 ID,不要让 skill 假装自己知道

## 循环依赖与破坏性操作

### 循环依赖(A 创建产出 X,B 修改 X,C 删除 X 又回到 A)

- 按 spec 叙事顺序排,不尝试"优化"
- 提供一个 `99-teardown.smoke.ts`(可选),跑完把测试产生的数据删掉;spec 没明说清理 workflow 则不自动生成

### 破坏性操作(DELETE / 重置 / 改密码)

- **不在默认正常场景自动执行**——即使 autogen 里有 delete 接口,用例里默认 skip
- 生成脚本时把这类接口的正常场景包在 `it.skip('破坏性操作,确认后移除 .skip 启用', ...)` 里
- 异常场景(例如"删除不存在的资源应 404")正常生成,因为不会真删东西
- 在脚本头注释醒目标出:"本接口含破坏性操作,正常场景默认 skip,确认影响范围后启用"

## 依赖图输出到 README

生成 README 时附一张 mermaid / ASCII 依赖图:

```
01-createTeam ──┬──▶ 02-addMember ──▶ 03-publishNotice
                │
                └──▶ 04-getTeamInfo (独立读取,不依赖 02)
```

用户一眼看得出来哪些接口串在一起、哪些是独立的。
