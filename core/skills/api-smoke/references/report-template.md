# `report.mjs` 链路报告生成器

把 NDJSON 日志加工成排查友好的 `report.md`。run-all 结束后自动跑一次。

## 目录

- [产物结构(`report.md`)](#产物结构reportmd)
- [醒目摘要块要点(必须符合)](#醒目摘要块要点必须符合)
  - [视觉分割](#1-视觉分割)
  - [🎯 一眼结果表](#2--一眼结果表)
  - [🔑 链路关键数据](#3--链路关键数据)
  - [📬 接口业务 code 汇总](#4--接口业务-code-汇总)
  - [⚠️ 需要关注](#5-️-需要关注)
- [实现核心逻辑(`_shared/report.mjs`)](#实现核心逻辑_sharedreportmjs)

## 产物结构(report.md)

顶部是**醒目摘要块**(用户第一眼只看这个),往下才是详情。

```markdown
<!-- ═══════════════════════════════════════════════════════════════ -->
<!--                    🔍 本次冒烟运行摘要                          -->
<!-- ═══════════════════════════════════════════════════════════════ -->

> **⏱ 运行时间** 2026-04-29 16:51:12 · **耗时** 3.8s
> **📁 日志** logs/run-2026-04-29T08-51-12.ndjson (112 KB · 22 条)

### 🎯 一眼结果

| 套件 | 用例 | 请求 | PASS | FAIL | 业务 code 非 0 | 平均耗时 |
|---|---:|---:|---:|---:|---:|---:|
| **01 官方资产类目列表** | 6 | 6 | ✅ 6 | ❌ 0 | — | 395ms |
| **02 官方资产资源列表** | 8 | 9 | ✅ 8 | ❌ 0 | 1 (code=740011) | 421ms |
| **03 官方资产资源下载** | 5 | 5 | ✅ 5 | ❌ 0 | — | 168ms |
| **合计** | 19 | 22 | ✅ 19 | ❌ 0 | 1 | 342ms |

### 🔑 链路关键数据(下游入参溯源)

| 数据 | 值 | 来源 |
|---|---|---|
| `categoryId` | **1503718585** | `01 POST /category/tree` → `list[0].children[0].id` |
| `resourceId` | **1509722393** | `02 POST /resources/search` (category_id=1503718585) → `list[0].id` |
| `resource.slug` | `character123` | 同上 |
| download.url | `https://dynamic-alisz-rs-test.../5c606f...json` | `03 POST /resources/element/1509722393/download` → `data.element_list[0].download_url` |

### 📬 接口业务 code 汇总

| 接口 | 200 次 | 4xx 次 | 5xx 次 | 业务 code 分布 |
|---|---:|---:|---:|---|
| `GET /web/v1/df/crc/category/tree` | 5 | 1(空 Cookie→401) | 0 | code=0 × 5, "User not login err" × 1 |
| `POST /web/v1/df/crc/resources/search` | 7 | 2 | 0 | code=0 × 7, code=740011 × 1, "User not login err" × 1 |
| `POST /web/v1/df/crc/resources/element/:id/download` | 2 | 3 | 0 | code=0 × 2, code=740011 × 2, "User not login err" × 1 |

### ⚠️ 需要关注

- ✅ **全部用例通过** — 无 contract-drift / script-bug / env-issue
- 🟡 **02 order_by=999 → code=740011 "invalid json body"** — 后端错误映射可能不准,建议反馈
- 🟡 **02 page_size=500 未被后端拒绝**(YApi 标注上限 200)— 静默超限,建议后端加 guard

<!-- ═══════════════════════════════════════════════════════════════ -->
<!--                        详细数据(按需查阅)                      -->
<!-- ═══════════════════════════════════════════════════════════════ -->

## 时间轴

... (按请求时间展开,每一条:用例 + 接口 + method + status + 耗时 + 入出参摘要)

## 链路依赖溯源

... (每条下游调用的关键入参能否在更早的上游响应中找到出处)

## 每接口首个成功样例

... (完整请求头 + 完整响应体,便于对照 autogen 做 contract 校验)
```

## 醒目摘要块要点(必须符合)

### 1. 视觉分割

用 `<!-- ═══... -->` + 标题强分割上下文。`report.md` 顶部前 30 行必须是摘要块,用户打开文件不用滚屏就能看出结果。

### 2. 🎯 一眼结果表

- 每个 suite 一行,最后一行合计,**PASS/FAIL 数字加 emoji** ✅❌
- `请求数 > 用例数` 的情况(例如 02 套件里某用例触发 `ensureCategoryId` 多调了一次 `01` tree)显式列出,避免用户疑惑
- 业务 code 非 0 独立一列,PASS 但 code 非 0 的 case 在这里可见(例如"期望 4xx" 的参数异常用例)

### 3. 🔑 链路关键数据

**必有**。用户最关心的是"这条链路跑到哪里,下游拿到的 id 从哪来"。

- 从 fixture / ensureXxx 产出的值逐条列
- **来源列必须写清楚**:`"01 POST /category/tree" → "list[0].children[0].id"` —— 用户一眼看出数据流是否对
- 如果链路出错(上游没产出导致下游兜底),在值后标 `⚠️ 从 fallback 兜底链路取`

### 4. 📬 接口业务 code 汇总

**必有**。按归一化 URL 分组,列:

- 200/4xx/5xx 次数
- 业务 code 分布(如 `code=0 × 7, code=740011 × 1`)
- 每个 code 配最具代表性的 msg(便于排查)

### 5. ⚠️ 需要关注

失败三分类(contract-drift / script-bug / env-issue)的自动归纳结果。PASS 但后端 msg 异常的(错误码映射不准、静默超限)也归这里,用 🟡 软警告。

## 实现核心逻辑

**单一事实源**:`core/skills/api-smoke/assets/_shared/report.mjs`。skill 生成脚本时 `cp` 该文件,不要粘贴代码。行为调整改 asset,不改本文档。

要点:

- 读 `logs/run-*.ndjson`(命令行参数;无则取最新)
- 产 `report.md`(默认同目录);顶部醒目摘要块
- 时间轴、链路依赖溯源、每接口首个成功完整样例
- 不 truncate body 的原始落盘在 NDJSON,`report.md` 里首样例做 2000B 软截断


skill 生成 report.mjs 时,按 Step 4 的参数语义探测结果**定制 `fixtureKeys` + 响应路径**:

- 项目里常见 fixture 键(从 `saveFixture()` 调用点挖):`categoryId`、`resourceId`、`teamId`、`spaceId`、`projectId`
- 响应结构差异:有的 `data.data.list`,有的 `data.list`,有的直接 `list` — report.mjs 里 `data = body?.data?.data || body?.data || body` 逐层回退
- 链路关键字段(`download_url` / `file_url` / `preview_url`)单独列出,业务上比 id 更重要

## 和其他产物的关系

| 顺序 | 产物 | 作用 |
|---|---|---|
| 1 | `report.md`(顶部摘要块) | 排查**第一眼** — 通过率、链路关键数据、业务 code 分布 |
| 2 | `report.md`(详细段) | 发现异常后看时间轴 + 首样例,对比 autogen contract |
| 3 | `FLOW.md` | 需要理解业务约束("为什么 category_id 必须是子类目 id")时读 |
| 4 | `logs/run-*.ndjson` | 详细段也看不清时,用 `jq` 过滤原始数据 |
| 5 | `trace.log` | 实时观察(SMOKE_VERBOSE=1) |
