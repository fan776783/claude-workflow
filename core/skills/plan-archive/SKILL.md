---
name: plan-archive
description: "Use when 用户调用 /plan-archive, or 三阶段研发流程的阶段三:在所有模块研发上线后,根据实际代码改动回写阶段一技术方案 + 项目级架构文档(docs/architecture / docs/contracts / docs/assets/概要设计 等)。"
argument-hint: "--design <path> --since <commit|branch|tag> [--services <list>]"
disable-model-invocation: true
---

<CONTEXT>
Read 项目级文档(以 reelmate-workspace 为例):
- 阶段一产出 `docs/designs/{slug}-{YYYYMMDD}.md`(必传 --design 参数定位)
- `AGENTS.md` § Project Doc Update Triggers(回写触发表 — 决定哪些改动写哪个文件)
- `AGENTS.md` § Documentation Budget(行数预算 — 落盘前自检)
- `docs/assets/万兴剧厂概要设计.md`(项目总架构文档 — 主要回写目标)
- `docs/architecture/README.md` / `glossary.md` / `adr/template.md`
- `docs/contracts.md` / `docs/engineering/rules.md` / `docs/runbooks/README.md`

若上述任一文件不存在,记录"无项目级 X,跳过对应回写",不阻断流程。
</CONTEXT>

# 技术方案归档(Stage 3)

实施完成后,按实际代码改动回写阶段一技术方案 + 项目级架构文档。三阶段研发流程的阶段三,单点 skill,**不**进入 workflow 状态机。

## 用法

```bash
/plan-archive --design <path> --since <commit|branch|tag> [--services <list>]
/plan-archive --design docs/designs/asset-batch-upload-20260520.md --since master@{2 weeks ago}
/plan-archive --design docs/designs/asset-batch-upload-20260520.md --since v1.2.0 --services rmdfsrv,rmaisrv
```

参数:
- `--design <path>`(**必填**):阶段一文档路径,锚定哪个方案要归档
- `--since <commit|branch|tag>`(**必填**):改动范围起点,例如具体 commit hash / `master@{2 weeks ago}` / 上次 release tag
- `--services <list>`(可选,逗号分隔):限定扫描的服务仓;不传则扫 `AGENTS.md § Repository Shape` 列出的全部服务

## 适用 / 不适用

- ✅ 适用:三阶段流程阶段三 / 复杂迭代后期 / 把事实回写到项目级文档
- ❌ 不适用:单 PR 内的局部回写(让 PR description 承担即可);bugfix 不需要;阶段二未完成不要跑

## Checklist

1. ☐ 输入收集 + 校验
2. ☐ 跨服务改动收集(git log / diff)
3. ☐ 对比与差异分析(改动 vs 设计 vs 项目级文档)
4. ☐ 🛑 回写预览 Hard Stop
5. ☐ 落盘 + 自检 + 汇总

## Step 1 — 输入收集 + 校验

**校验 `--design`**:
- 文件存在
- 是 `docs/designs/` 下的合法阶段一文档(含 § 9 实施回写占位章节)
- Status 字段为 `Approved` 或 `Implemented`(`Draft` → 提示用户先确认方案落地再归档)

**校验 `--since`**:
- 在 reelmate-workspace 根 `git rev-parse <since>` 解析成功(若是分支 / tag 别名)
- 不要假设 commit hash 在所有服务仓都存在,各服务仓独立 git history

**`--services` 默认值**:
- 不传 → 从 `AGENTS.md § Repository Shape` 表读 Go 服务(active)+ Python Agent 服务清单
- 不在工作区内的服务仓(未 clone)→ 跳过 + 在汇总里标注"未扫描"

## Step 2 — 跨服务改动收集

对每个目标服务仓,顺序执行(避免并发 git 锁):

```bash
cd <service>

# 提交概览
git log <since>..HEAD --oneline --no-merges

# 文件级 stat
git diff <since>..HEAD --stat

# 关键文件深读(只列高信号路径,避免噪声)
git diff <since>..HEAD -- \
  'modules/api/init.go' \
  'modules/api/biz/**' \
  'modules/api/ctrl/**' \
  'migrations/**.sql' \
  '**.sql' \
  'conf/*.yml' \
  'agent/**' \
  'pipeline.py' \
  'state.py'
```

**汇总产出**(per-service):
- 提交数量 + 主要 commit message
- 改动文件清单(分类:路由 / 业务 / SQL / 配置 / Agent / 其他)
- 路由变化:新增 / 修改 / 删除的 endpoint(grep init.go 的 RouterGroup / Handle)
- DDL 变化:新增 / 变更表 + 字段(grep migrations / *.sql)
- 配置变化:新增 / 改动的 Apollo / settings.yml key
- MQ 变化:新增 topic / 消费者注册

## Step 3 — 对比与差异分析

**三方对照**:
- A. 阶段一方案(`--design` 文件 § 1-8)
- B. 实际改动(Step 2 汇总)
- C. 当前项目级文档现状

**按 `AGENTS.md § Project Doc Update Triggers` 表生成回写计划**(详见 [`references/archive-checklist.md`](references/archive-checklist.md)):

| 改动类型 | 触发判定 | 写入目标 | 写入要点 |
| --- | --- | --- | --- |
| 新增 / 改 HTTP 路由 | 路由前缀或 Method 语义变化 | `docs/contracts.md` | 加一行/改一行,不重写全文 |
| 异步回调 / Agent 链路 | callbacks 约定变化 | `docs/contracts.md` | 同上 |
| 错误返回格式 | 新错误类型 / 字段 | `docs/contracts.md` | 同上 |
| 服务边界 / 写权威翻转 / 主链路改 / Deprecated 新增 / 缩写表前缀变 | architecture 表更新 | `docs/architecture/README.md` + `docs/assets/万兴剧厂概要设计.md` | architecture 改表格行,概要设计同步段落 |
| 新增领域术语 / 数据键 / 状态枚举 | 新概念出现 | `docs/architecture/glossary.md` | 加术语条目 |
| 新增分区 / 配置 / Agent / 任务积分硬约束 | rules 变更 | `docs/engineering/rules.md` | 加一条或改一条 |
| 新增联调 / 排障知识 | 实施期遇到值得记录的坑 | `docs/runbooks/README.md` | 加排障条目 |
| hard-to-reverse 架构决策 | 服务拆分 / DB 选型 / 写权威翻转 / 协议变更 | 新建 `docs/architecture/adr/{NNN}-{slug}.md` | 用 `template.md` 五段 |

**始终回写**:`--design` 文件 § 9 实施回写章节。
- § 9.1 实际状态(Implemented / Partial / Cancelled)
- § 9.2 与设计差异(逐条对比 § 2-6)
- § 9.3 关联 PR / Commit
- § 9.4 项目级文档回写清单

## Step 4 — 🛑 回写预览 Hard Stop

本卡点为 [`../../specs/shared/hard-stop-templates.md`](../../specs/shared/hard-stop-templates.md) § Gate 1 形式 B(展示体量大,纯文本不调 AskUserQuestion)。

**展示模板**:

```markdown
## 回写预览

### 1. 设计 → 实施差异摘要
- 接口:<已实现 N/M 条 + 新增 X 条 + 变更 Y 条>
- 数据库:<DDL 已落 N 张表 / 字段差异 X 处>
- 时序:<与设计一致 / 偏差 X 处>
- 工时:<估 X 人日,实际 Y 人日>

### 2. 项目级文档回写计划
| 文件 | 操作 | 行数变化 | 是否超 budget |
| --- | --- | --- | --- |
| docs/contracts.md | 加 2 行 | +2 | 否(47→49,limit 80) |
| docs/architecture/README.md | 改 1 行(写权威表) | ±0 | 否 |
| docs/architecture/glossary.md | 加术语 1 条 | +3 | 否 |
| docs/assets/万兴剧厂概要设计.md | 改 § 二 1 段 | +5 | 无 budget,可写 |
| docs/architecture/adr/009-xxx.md | 新建(用 template.md) | NEW | 否 |
| docs/designs/<slug>-<date>.md | 回写 § 9 | +30 | 无 budget |

### 3. Hard Coding Rules 实测自检
逐条对照阶段一 design-plan 里的"5 条规则触及 / 遵循"声明,用实际代码验证:
- 分区键:<实测所有大表查询带 wsid / 否,列违规位置>
- 跨服务写:<实测无 / 有,列违规位置>
- 任务终态 / 积分:<实测对齐三类记录 / 否>
- Agent 边界:<实测走 rmagsrv + mtrsrv / 否>
- 密钥 Apollo:<实测密钥全 Apollo / 否>

### 4. 关键 diff 摘要(每服务一句)
- rmdfsrv: <X 个 commit,新增批量上传 handler + 1 张表>
- rmaisrv: <Y 个 commit,加 MQ 消费者分支 + 配置项>
- ...

### 5. 未扫描的服务(若有)
- <service>: 未 clone 到工作区,跳过

### 6. 风险 / 残留
- <例如 § 9.2 偏差是否需要补 ADR>
- <例如 budget 超限需迁 ADR>
```

**反馈方式提示**(原样输出,不调 AskUserQuestion):

```
反馈方式:
1. 全部回写按预览执行 → 回「1」/「继续」/「OK」
2. 终止(回写计划不对) → 回「2」/「终止」
- 部分回写 → 直接说改哪些(如"先不写 ADR,等下次","glossary 那条术语换个名")
```

**用户回复归一化**:

| 用户回复 | 归一化路径 |
|---|---|
| `1` / `继续` / `OK` | `confirm` → Step 5 |
| `2` / `终止` / `reject` | `manual_intervention` → 不落盘 |
| 自由文本指出修改 | `revise` → 调整回写计划后重新输出 Step 4 |

模糊回复 → 反问。**立即停止,等用户明确输入**。

## Step 5 — 落盘 + 自检 + 汇总

用户回 `1` / `继续` 后,逐文件 Edit(优先 Edit 不用 Write 全量重写;新建文件除外):

### 5.1 写入顺序

1. 先写 `docs/designs/{slug}-{YYYYMMDD}.md` § 9(主索引)
2. 再写 `docs/architecture/*` / `docs/contracts.md` / `docs/engineering/rules.md` / `docs/runbooks/README.md`(单条 Edit)
3. 最后 `docs/assets/万兴剧厂概要设计.md`(总览,影响最大)
4. 若新建 ADR,最后做(用 `docs/architecture/adr/template.md` 沿袭格式)
5. **估时校准回流**:若主 design § 5 有估时且能取到实际工时,append 一行到 `docs/designs/_estimation-log.md`(详见 [`references/archive-checklist.md`](references/archive-checklist.md) § 6);取不到实际工时则跳过

### 5.2 每文件落盘后自检

- 行数:对照 `AGENTS.md § Documentation Budget` 表,超出则:
  - 暂停,提示用户:"`docs/X.md` 超 limit Y 行,把冷细节拆 ADR / 服务本地文档?"
  - 用户回 `1` / `继续` → 硬写超出;否则直接说怎么拆(拆 ADR / 服务本地文档)
- 溯源注释:在被改文件末尾加(若已有则更新):
  ```
  <!-- archived from docs/designs/{slug}-{YYYYMMDD}.md @ {since}..HEAD -->
  ```
- 链接有效性:新加的链接必须 Read 一次目标文件确认存在

### 5.3 汇总输出

```markdown
✅ 归档完成

### 写入文件
| 文件 | 操作 | 行数变化 |
| --- | --- | --- |
| docs/designs/<slug>-<date>.md § 9 | 回写实施 | +30 |
| docs/contracts.md | +2 行 | 47→49 |
| ...

### 新建 ADR
- docs/architecture/adr/009-xxx.md(若有)

### 未回写(用户指示跳过 / 阻断)
- <文件>: <原因>

### 下一步建议
- 把回写 PR 发给团队 review
- 若有"未回写 / 阻断"项,跟踪到下一迭代
```

## 关键原则

1. **以代码改动为准,不以记忆为准** — 必须跑 git log / diff 拿事实
2. **Edit 优先于 Write** — 项目级文档大多 ≤ 100 行,改一两行不要全量重写
3. **Documentation Budget 是硬约束** — 超出就拆 ADR,不要为了凑 budget 删原有内容
4. **Hard Stop 是真决策点** — 回写涉及多个团队共享文档,必须卡住等用户确认
5. **未扫描的服务不假装扫了** — 显式标注,跟踪到下次
