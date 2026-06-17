# 归档回写清单

> 由 `/plan-archive` Step 3 使用。基于 `AGENTS.md § Project Doc Update Triggers` 展开,加触发判定 + 写哪段 + 不写什么 + budget 自检。

## 1. 回写触发判定表

每条按"触发判定问题"过滤实际改动,命中则写对应文件。同一改动可能命中多条(例:新增写权威服务 → architecture + 概要设计)。

### 1.1 `docs/contracts.md` § HTTP Routing

**触发问题**:
- 新增 / 修改 / 删除了 HTTP 路由?
- 路由前缀不符合 `/v{ver}/{service-short-name}/{business}` 约定?
- Method 语义偏离 GET 查 / POST 写 / PUT 全量改 / DELETE 删?
- Header 上下文(X-User-Id / X-Prod-Id / X-Space-Id)的语义变了?

**写哪段**:对应路由前缀 / Method 表的那一行。新增前缀加新行;改 Method 语义改对应行。

**不写**:具体 endpoint 列表(让代码 init.go 承担);单 PR 的临时变更。

### 1.2 `docs/contracts.md` § Callbacks & Async

**触发问题**:
- 新增异步回调路径?
- Agent 任务回调链 / mtrsrv 入口 / WES / 第三方 AI 回调链路变了?
- MQ topic / 消费者注册方式变了?
- HITL 决策枚举变了?

**写哪段**:链路图 / 选择策略表对应行。

**不写**:单条 callback 的 payload 细节(让各服务 swagger 承担)。

### 1.3 `docs/contracts.md` § Error Handling

**触发问题**:
- 引入了新错误类型 / 新 fail_type 枚举?
- 业务错误返回结构变了(code / msg / data 之外多了字段)?
- 业务任务终态规则变了?
- DDL / Schema 自动化策略变了?

**写哪段**:错误返回构造器约定段 + 任务终态规则段。

**不写**:具体错误码列表(让各服务 errors.go 承担)。

### 1.4 `docs/architecture/README.md`

**触发问题**:
- 新增 / 删除服务?服务职责一句话变了?
- 写权威翻转(某表的写权威服务变了)?
- 主链路新增 / 删除节点?
- Deprecated 资产新增?
- 服务名缩写 / 表前缀新增?

**写哪段**:服务边界表 / 数据归属表 / 主链路段 / Deprecated 表 / 缩写表。

**不写**:具体接口设计(走 contracts);ADR 级长决策(走 ADR)。

**budget**:≤ 130 行。超出 → 把冷细节拆 ADR。

### 1.5 `docs/architecture/glossary.md`

**触发问题**:
- 新增领域术语(业务域 / 数据键 / 状态枚举)?
- 服务名缩写 / 数据库名变了?
- 任务状态枚举增减?
- 新增可观测组件名(LangFuse / Jaeger / 等)?

**写哪段**:对应 § 业务域 / § 数据键 / § 数据库 / § 任务与状态 / § AI 与可观测。

**不写**:同义词重复;概念解释(用一句话定义)。

**词汇维护规则**(`docs/architecture/glossary.md` 已声明):新词必须同步 `architecture/README.md` + `engineering/rules.md` + `glossary.md` 三处。

### 1.6 `docs/engineering/rules.md`

**触发问题**:
- 新增项目级硬约束(分区键 / 配置 / Agent / 任务积分等)?
- 既有约束的边界变了?

**写哪段**:对应章节(数据库 / 配置 / 任务与积分 / Agent)。

**不写**:服务本地约定(走服务级 CLAUDE.md / AGENTS.md);ADR 级决策。

**budget**:≤ 100 行。超出 → 拆 ADR。

### 1.7 `docs/runbooks/README.md`

**触发问题**:
- 新增本地启动步骤 / 联调步骤?
- 实施期遇到值得记录的排障坑?
- 外部依赖入口变了?

**写哪段**:对应章节(本地启动 / 联调 / 排障 / 外部依赖)。

**不写**:单次的 P0 故障复盘(走单独 incident 文档)。

**budget**:≤ 120 行。超出 → 把冷排障迁服务本地 runbook。

### 1.8 `docs/assets/万兴剧厂概要设计.md`

**触发问题**:任何 `docs/architecture/README.md` 触发的同时回写。

**写哪段**:与 `docs/architecture/README.md` 对应的总览章节(§ 一 整体说明 / § 二 一层架构各逻辑模块说明的对应行)。

**不写**:每次小迭代都写这个文件——只在架构表的事实变化时写。

**budget**:无强约束(已 1100+ 行),但优先在 architecture/README.md 里先压缩,再同步过来。

### 1.9 新建 `docs/architecture/adr/{NNN}-{slug}.md`

**触发判定**(全部满足才建 ADR,见 `docs/architecture/adr/README.md`):
- 改动重构成本高 / 难以反向
- 不能从代码 / git history 推断出"为什么"
- 当时存在过 ≥ 1 个被认真考虑后否决的备选方案

**写哪段**:用 `docs/architecture/adr/template.md` 五段(Context / Decision / Consequences / Alternatives / References)。

**编号**:取 `docs/architecture/adr/` 目录现有最大编号 +1。

## 2. Documentation Budget 对照

> 落盘前自检,超 limit 暂停 + 询问用户。

| 文件 | Limit |
| --- | --- |
| `docs/README.md` | ≤ 20 |
| `docs/architecture/README.md` | ≤ 130 |
| `docs/engineering/rules.md` | ≤ 100 |
| `docs/runbooks/README.md` | ≤ 120 |
| `docs/architecture/adr/README.md` | ≤ 80 |
| `docs/contracts.md` | ≤ 170 |
| `docs/architecture/glossary.md` | (无强 limit,保持紧凑) |
| `docs/assets/万兴剧厂概要设计.md` | (无强 limit) |
| `docs/designs/*.md` | (无强 limit,但建议 ≤ 400) |

## 3. 写入前自检清单

每个被写文件落盘前过一遍:

- [ ] 行数没超 budget(超出已与用户确认)
- [ ] 新加的内容描述的是**事实**(已实施 / 已验证),不是设想
- [ ] 链接的目标文件 / 段落真实存在(Read 验证)
- [ ] 分区键引用对齐 architecture(`wsid` / `rm_task_id` / `ep_parse_id`)
- [ ] Apollo 引用没暴露具体 key 值
- [ ] Hard Coding Rules 没被悄悄改动(规则正文一字不改,例外另起一节说明)
- [ ] 文件末尾有溯源注释 `<!-- archived from docs/designs/... @ <commit-range> -->`

## 4. 跨文件一致性检查

写完所有文件后过一次:

- 同一术语在 architecture/README.md / glossary.md / 概要设计.md 三处定义一致?
- 新增分区策略在 architecture/README.md(§ 横切事实)+ engineering/rules.md(§ 数据库)+ ADR(若有)三处一致?
- 新建 ADR 编号在 architecture/adr/README.md 索引里加了一行?
- 阶段一 design 文档 § 9 列出的"项目级文档回写清单"与实际写入对得上?

任一不一致 → 暂停,告知用户,不要静默写。

## 5. 主 design 文档状态推进

回写主 design 文档的 § 9 实施回写后,**同时**更新 frontmatter + § 10 修订历史:

| 字段 | 写什么 |
| --- | --- |
| `Version` | 升 minor(如 `1.1.0` → `1.2.0`),原因:阶段三回写本身是章节增补 |
| `Status` | `Approved` → `Implemented`(本次实施完成);若部分回滚则 `Partial` |
| § 10 修订历史 | append 一行:`{YYYY-MM-DD} \| {新版本} \| Implemented \| /plan-archive \| 阶段三回写 § 9 实施差异 + 项目级文档同步` |

**修订历史规则**(同 design-plan):append-only,不删旧行,不改既有行。

如果本次回写发现方案有 hard-to-reverse 的偏离(写权威翻转 / 服务边界改动 / 接口语义变),不直接改 design 主文档,而是:

1. 在 § 9.2 与设计差异中明示偏离点
2. 必要时**新建后续 design 文档**`docs/designs/{new-slug}-{date}.md`,frontmatter `Supersedes: <旧 slug>`
3. 同时回旧文档 frontmatter 写 `Superseded By: <新 slug>`
4. § 10 各自追加 `Superseded` 标记行

模型拿不准是否需要 supersede 时,Hard Stop 询问用户,不要自动决定。

## 6. 估时校准回流(reference-class forecasting)

回写 § 9 时,若主 design 文档 § 5 有估时、且本次能取到实际工时(git log 时间跨度 / 用户告知),**append 一行到 `docs/designs/_estimation-log.md`**(无则首次创建,带表头):

| 日期 | slug | 需求类型 | 估时(人日) | 实际(人日) | 系数 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |

- `需求类型`:粗分类(跨服务 CRUD / Agent 链路 / DDL 迁移 / 纯接入层 等),供 design-plan 起草同类需求时取系数
- `系数` = 实际 / 估时
- 该 log **不进 budget 约束**,append-only,是 design-plan Step 3 / § 5 估时的校准源 —— 闭环:plan-archive 产出 → design-plan 消费,取代凭空拍脑袋
- 取不到实际工时(无明确起止 / 用户未告知)→ 跳过,不编造
