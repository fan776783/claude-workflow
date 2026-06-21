---
name: design-plan
description: "Use when 用户调用 /design-plan, or 需要为复杂跨服务需求(多服务改动 / 数据库 DDL / 新增对外接口 / 架构调整)产出可评审的技术方案文档,典型用户是技术主管 / 资深研发。简单单服务改动走 /workflow-spec,Bug 修复走 /fix-bug。"
argument-hint: "<需求标题或 PRD 链接> | --revise <slug>-<YYYYMMDD>"
---

<CONTEXT>
Read 项目级文档(以 reelmate-workspace 为例,其它项目同理替换路径):
- `AGENTS.md` § Hard Coding Rules(5 条非协商红线)
- `docs/architecture/README.md`(服务边界 / 写权威 / 主链路 / 横切 / Deprecated)
- `docs/architecture/glossary.md`(领域术语 / 数据键 / 状态枚举)
- `docs/contracts.md`(HTTP routing / callbacks / error-handling 已合并为单文件)
- `docs/engineering/rules.md`(项目硬约束)
- `docs/architecture/adr/template.md`(ADR 模板,起草关联 ADR 时复用其结构)

若上述文件在当前项目不存在,记录"无项目级 X,本方案按通用最佳实践给出",不阻断流程。
</CONTEXT>

# 技术方案设计(Stage 1)

复杂需求 → 可评审的技术方案文档。三阶段研发流程的阶段一,单点 skill,**不**进入 workflow 状态机。产出归档到 `docs/designs/{slug}-{YYYYMMDD}.md`,供阶段二各模块研发用 `/workflow-spec` 引用,供阶段三 `/plan-archive` 回写差异。

## 用法

```bash
/design-plan <需求标题或 PRD 链接>
/design-plan "为资产提取加批量上传接口,跨 rmdfsrv + rmaisrv"
/design-plan https://...prd-link
```

## 适用 / 不适用

- ✅ 适用:跨 ≥2 服务的需求 / 新增对外接口 / 数据库 DDL / 架构调整 / 涉及积分或 Agent 的改动
- ❌ 不适用:单服务、单模块的简单改动(直接走 `/workflow-spec`);Bug 修复(走 `/fix-bug` / `/bug-batch`);UI 单页面改动

## 输出 contract

`docs/designs/{slug}-{YYYYMMDD}.md`,模板见 [`references/design-plan-template.md`](references/design-plan-template.md)。文件命名:
- `slug` = 需求标题派生 kebab-case(英文优先,中文转拼音或保留关键英文词;由 skill 自动派生,Hard Stop 时展示给用户确认)
- `YYYYMMDD` = 落盘当日

## Checklist

1. ☐ 需求接收 + 关键缺口反问
2. ☐ 调研(读 docs/ + 必要时读相关服务代码)
3. ☐ 起草技术方案到内存(8 章节)
4. ☐ 🛑 方案评审 Hard Stop
5. ☐ 落盘归档 + 引导阶段二

## Step 1 — 需求接收

**输入归一化**:用户给的可能是 PRD 链接 / 工单号 / 自由文本。skill 解析后构造 `RequirementRecord`:
- `title`(必填)
- `description`(必填,缺失时反问)
- `prd_source`(**必填**:钉钉 / 飞书 / Notion URL;无原文则归一为 `inline:<一句话需求>`)— 阶段二 `/workflow-spec` 回溯 PRD 的唯一锚点

**PRD 原文获取**(检测到 URL 时):
- `alidocs.dingtalk.com` → 调 `/alidocs` skill 取正文
- 飞书 / Notion / Confluence → 对应 MCP 或 skill;无适配器则 WebFetch 兜底
- 取到的正文作为 Step 2-3 的事实依据,不再要求用户粘贴

**关键缺口反问**(命中任一即问):
- 目标用户群、调用量级、SLA 期望
- 是否跨服务?跨哪几个?
- 是否涉及数据库 DDL?是否新增表 / 字段 / 索引?
- 是否涉及对外接口?幂等性?鉴权方式?
- 是否涉及积分预扣 / 退还?
- 是否涉及 Python Agent / Agent 任务 / 回调?
- 是否涉及 Apollo 配置 / MQ topic / Cron?

不要假设答案。一次问完(2-4 个最关键的),不要拆成多轮。

**复杂度 / 不确定性分诊**(反问后定档,决定是否真进 8 章节):
- **单服务 + 归属明确** → 不必 design-plan,劝退到 `/workflow-spec` 直接做
- **关键技术未验证**(新中间件 / 性能存疑 / 第三方能力边界不清 / 存储选型未定) → 先 `/research`(查现成方案)或 `/prototype`(spike 去风险),拿到结论再回 design-plan,避免"为不确定的东西写确定的方案"
- **方案空间清晰 + 跨 ≥2 服务** → 正常进 Step 2,起草完整 8 章节

## Step 2 — 调研

**并行读项目级文档**(单条 Read / 多条 parallel),输出"受影响服务初判"列表:
- 从 `docs/architecture/README.md § 服务边界` 圈出主要写权威服务
- 从 `docs/architecture/README.md § 数据归属` 圈出涉及的库 / 表前缀
- 从 `docs/contracts.md` 确认目标路由前缀和 Method 语义
- 从 `docs/architecture/adr/` 检查是否已有相关 ADR(避开 superseded)

**必要时读服务代码**:
- 目标服务 `modules/api/init.go` 看路由组织
- 目标服务 `modules/biz/` 看相邻业务的实现范式
- 目标表的现有 schema(`*.sql` 或 ORM 结构体定义)

**跨 ≥2 业务模块 / 模块归属不清时**(条件读,非每次):若项目有总体概要设计 / 架构总览文档(如 reelmate 的 `docs/assets/万兴剧厂概要设计.md`),读其**业务模块章节 + 架构层表**定位职责边界与服务协作分工。单服务或归属明确的需求跳过——该文档体量大,不进 CONTEXT 常驻。

不要过度调研。Step 2 目的是**为方案落点提供事实依据**,不是把整个服务读懂。

## Step 3 — 起草技术方案到内存

按 [`references/design-plan-template.md`](references/design-plan-template.md) 起草到内存(尚未写文件)。8 个必填章节:

1. **背景与目标** — **PRD 原文链接(必填,沿用 Step 1 的 `prd_source`)** + 业务场景一句话 + 量化目标(QPS / 数据量 / SLA)。frontmatter 的 `PRD Source` 与 § 1 的"PRD 原文链接"必须一致 —— 两处都是给阶段二 `/workflow-spec` 自动回溯钉钉 / 飞书 PRD 用的锚点
2. **接口设计** — 路径(对齐 `/v{ver}/{service-short-name}/{business}` 约定)/ Method / Request / Response / Header / 错误码。涉及对外接口标注是否经 reelmateapi。**每接口标兼容性**(新增 / 破坏性 / 灰度);破坏性变更必须列下游 consumer + 迁移窗口。关键路径选择(路由风格 / 同步异步 / 鉴权方式)附一句 `备选 → 否决理由`
3. **数据库设计** — 库 → 表 → 字段(类型 / nullable / 默认值 / 索引 / 注释)。**显式分区键策略**:涉及大表必带 wsid / `task` 表加 rm_task_id / `episode_parse_*` 加 ep_parse_id。新建表标注写权威服务和读服务清单。关键建模选择(存储选型 / 索引 / 分区数 / 是否独立建表)附一句 `备选 → 否决理由`
4. **系统交互设计** — mermaid `sequenceDiagram` 完整调用链:前端 → Go 服务 → Python Agent → MQ → 第三方 → callback。HITL / 异步 / 重试节点标清楚
5. **微服务变更清单** — **人员分工依据**,每行:仓库 | 模块路径 | 改动一句话 | 估时(0.5d / 1d / 2d) | 负责人(留空待分工)。起草估时前,若存在 `docs/designs/_estimation-log.md`,扫同类需求的"估时 vs 实际"系数校准本次估算(reference-class,不凭空拍)
6. **配置 / Apollo / MQ / Agent 影响** — 新增 Apollo 命名空间 / 新增 MQ topic / Agent 链路变化 / 新增第三方 Key 全列出。密钥不进代码
7. **风险与回滚** — 数据迁移 / 灰度策略 / 回滚 SQL / 流量切换方案 + **验收口径**:关键链路 E2E 场景清单(承接 `docker.sh` 跨服务验证)+ 上线后看哪些指标判成功 / 触发回滚
8. **关联 ADR** — 若决策不可逆(服务拆分 / DB 选型 / 写权威翻转 / 协议变更),起草 ADR 草稿(沿用 `docs/architecture/adr/template.md` 五段)。是否独立成文待 `/plan-archive` 阶段决定

**Hard Coding Rules 自检**:对照 [`references/hard-coding-rules-checklist.md`](references/hard-coding-rules-checklist.md) 6 项(5 条红线 + 数据可见性),逐条标"本方案是否触及 / 如何遵循 / 例外说明"。任何例外必须在风险章节明示。

## Step 4 — 🛑 方案评审 Hard Stop

本卡点为 [`../../specs/shared/hard-stop-templates.md`](../../specs/shared/hard-stop-templates.md) § Gate 1 形式 B(展示体量 ≥ 4 段,纯文本不调 AskUserQuestion)。

**展示模板**:

```markdown
## 技术方案评审

### 1. 需求摘要
<title> — <一句话目标>

### 2. 受影响服务
- <service>: <职责变化一句话>
- ...

### 3. 关键决策
- 接口:<最关键路由 1-2 条 + Method>
- 数据库:<新增 / 变更表 1-2 条 + 分区策略>
- 时序:<最关键的异步节点 / HITL 节点>
- 工时估算:<总人日 + 关键路径>

### 4. 微服务变更清单(分工预览)
| 仓库 | 模块 | 改动 | 估时 |
| --- | --- | --- | --- |
| ... | ... | ... | ... |

### 5. Hard Coding Rules 自检
- 分区键:<触及 / 不触及>,<如何遵循>
- 跨服务写:<触及 / 不触及>,<是否动了非权威表>
- 任务终态 / 积分:<触及 / 不触及>,<是否对齐三类记录>
- Agent 边界:<触及 / 不触及>,<是否走 rmagsrv / mtrsrv>
- 密钥 / Apollo:<触及 / 不触及>,<是否进 Apollo>
- 数据可见性:<触及 / 不触及>,<子账号 / 团队 / 跨租户分别能看到 / 操作什么>

### 6. 风险与回滚
<最高风险 1-2 条>

### 6.1 验收口径
<关键链路 E2E 场景 + 上线后判成功 / 触发回滚的指标>

### 7. 关联 ADR
<草稿要点 1-3 句,或"本次无 hard-to-reverse 决策">

### 8. 落盘文件名
docs/designs/<slug>-<YYYYMMDD>.md
```

**反馈方式提示**(原样输出,不调 AskUserQuestion):

```
反馈方式:
1. 方案可行,落盘归档 → 回「1」/「继续」/「OK」
2. 终止(方案不可行) → 回「2」/「终止」
- 大方向对,小调整 → 直接说改哪里(如"接口路径改成 /v2","数据库加个 status 索引"),按反馈调整后重新输出本评审
```

**用户回复归一化**:

| 用户回复 | 归一化路径 |
|---|---|
| `1` / `继续` / `OK` / `落盘` | `confirm` → Step 5 |
| `2` / `终止` / `reject` | `manual_intervention` → 不落盘,告知用户改动未保存 |
| 自由文本指出修改点 | `revise` → 调整方案后重新输出 Step 4 卡点 |

模糊回复("看着办" / "你决定")→ 不归一化,反问具体走哪条。

**立即停止,等用户明确输入,不要继续后续操作**。

## Step 5 — 落盘归档 + per-module slice 派生

用户回 `1` / `继续` 后:

```bash
mkdir -p docs/designs
```

### 5.1 写主文档

写入 `docs/designs/{slug}-{YYYYMMDD}.md`,内容用 [`references/design-plan-template.md`](references/design-plan-template.md) 占位填充 + Step 3 起草内容。frontmatter `Version=1.0.0` `Status=Draft`,§ 10 修订历史首行写 `1.0.0 Draft 初稿`。

### 5.2 派生 per-module slice(条件触发)

读取主文档 § 5 微服务变更清单,按 `仓库` 列分组。**当涉及 ≥ 2 个仓库时,自动派生 slice**(单仓库直接跳过本步)。

```bash
mkdir -p docs/designs/{slug}-{YYYYMMDD}
```

对每个仓库 `<repo>` 写一份 `docs/designs/{slug}-{YYYYMMDD}/{repo}.md`,内容:

```markdown
# {需求标题} — {repo} 模块

> 派生自 [`../{slug}-{YYYYMMDD}.md`](../{slug}-{YYYYMMDD}.md)。本文件只列 `{repo}` 仓库相关的方案切片;完整方案以主文档为准。

| 字段 | 值 |
| --- | --- |
| 主文档 | `../{slug}-{YYYYMMDD}.md` |
| 仓库 | `{repo}` |
| PRD Source | `<同主文档 frontmatter>` |
| 派生时间 | `{YYYY-MM-DD HH:mm}`(主文档 Version=1.0.0 时点) |

## 你的范围(主文档 § 5 中本仓库行)

| 模块路径 | 改动一句话 | 估时 | 负责人 |
| --- | --- | --- | --- |
| `<filtered rows>` | ... | ... | ... |

## 上下游接口(引用,不复制)

> 本仓库接口见主文档 [§ 2 接口设计](../{slug}-{YYYYMMDD}.md);**涉及的既有跨服务契约一律用锚点引用**(若项目契约层带稳定锚点,如 `docs/contracts.md#seam-cb-mtrsrv`),**禁止把契约字段抄进切片**。

- 本仓库接口:主文档 § 2 相关行
- 依赖的既有契约 seam:<列 `<file>#anchor`;无则写"无">

## 数据库改动(引用,不复制)

> 写权威与表归属以契约层为准(若有锚点,如 `docs/architecture/README.md#seam-domain-<ns>`);本需求新增/变更表见主文档 [§ 3 数据库设计](../{slug}-{YYYYMMDD}.md)。

## 时序中你的角色

> 完整时序见主文档 § 4。本仓库参与的关键节点:

- <step N>: <在时序中的动作>

## 配置(主文档 § 6 中 service={repo} 的 Apollo / MQ)

<filtered Apollo / MQ rows>

## 阶段二启动

```bash
cd {repo}
/workflow-spec ../docs/designs/{slug}-{YYYYMMDD}/{repo}.md
```

完整方案 / Hard Coding Rules 自检 / 风险 / ADR 全部以主文档为准。本切片是分工视图,**不替代评审**。
```

**slice 不派生整片时序图**(各模块都有自己的视角,易混淆)。研发需要完整时序时回主文档 § 4。

**slice 引用不复制**:切片只列指针(主文档章节 + 既有 contract seam 锚点),不复制接口 / 表字段定义。contract 或主文档变更 → slice 重新派生(覆写),引用自动跟随,杜绝跨仓库副本漂移。这是"薄共享 contract layer(单一真相源)+ per-module 执行文档(只引用)"layer 结构的落点。

### 5.3 落盘后输出

```markdown
✅ 技术方案已落盘:
   主文档: docs/designs/<slug>-<YYYYMMDD>.md (<行数> 行, Version=1.0.0, Status=Draft)
   模块切片:
     - docs/designs/<slug>-<YYYYMMDD>/<repo1>.md
     - docs/designs/<slug>-<YYYYMMDD>/<repo2>.md
     ...

下一步:
1. 团队评审 / 第三方技术评审 → 在主文档上直接 PR 评论 / 修订
   评审反馈合入后:Status → Reviewed → Approved,Version 升 minor / patch,§ 10 追加一行
2. 各研发阶段二启动(三种调用形态等价):
   A. 用 slice(推荐,分工最清):
      cd <repo>
      /workflow-spec ../docs/designs/<slug>-<YYYYMMDD>/<repo>.md
   B. 主文档 + 范围限定:
      /workflow-spec "../docs/designs/<slug>-<YYYYMMDD>.md 范围:§ 5 <repo> <模块>"
   C. 整文档(单仓库或想全文上下文):
      /workflow-spec ../docs/designs/<slug>-<YYYYMMDD>.md
3. PRD URL 已锚定在主文档 frontmatter `PRD Source`,模型遇到歧义自动回溯,无需命令行二次传
4. 全部模块上线后,技术主管:
   /plan-archive --design docs/designs/<slug>-<YYYYMMDD>.md --since <commit>
```

### 5.4 评审反馈迭代(后续触发本 skill 时)

用户后续以 `/design-plan --revise <slug>-<YYYYMMDD>` 形态回到本 skill 时:
- 读主文档,识别当前 Version
- 按修改范围决定 major / minor / patch(本 skill 主动建议,用户确认)
- Step 4 Hard Stop 展示 diff + 升版建议
- Step 5 重写主文档(保留 § 10 历史,append 新行)+ 重新派生 slice(覆写,因为 slice 是主文档投影)

## 关键原则

1. **以代码和工具搜索结果为准,不猜测** — Step 2 调研要拿到事实再 Step 3 起草
2. **Hard Coding Rules 显式自检** — 5 条红线任一触及必须在方案中说明遵循 / 例外
3. **微服务变更清单是分工依据,不是细节描述** — 仓库 + 模块 + 一句话 + 估时,不写代码
4. **Hard Stop 是真决策点** — 落盘前必须卡,因为之后所有研发会基于此分头开干
5. **落盘文件不可变,迭代差异由 plan-archive 回写** — 阶段一文档锁定方案,阶段三文档承载实施差异
