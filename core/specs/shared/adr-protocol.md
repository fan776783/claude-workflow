# ADR Protocol

> 架构决策记录（ADR）协议。**只在满足三重门槛时才写**——否则 ADR 会变噪音。
> Inspired by mattpocock/skills 的 `grill-with-docs/ADR-FORMAT.md`。

## 三重门槛（必须全部成立）

1. **Hard to reverse** — 事后改主意代价显著（跨服务 contract、存储选型、部署目标等）
2. **Surprising without context** — 未来读代码的人会想"为什么这么做"
3. **Real trade-off** — 有真实备选方案，因具体原因选了这个

任意一条不成立 → **不写**。

- 容易反转 → 反转就行，不用记
- 不 surprising → 没人会问，记了也没人读
- 没有真实 trade-off → 无非是"做了显而易见的事"，不值得留痕

## 存放位置

- 项目级：`.claude/code-specs/adr/NNNN-slug.md`（与 `shared/` **平行**放，避免与 `shared/` 下的发行物模板混淆）
- 命名：递增四位编号 + kebab-case slug（例：`0001-event-sourced-orders.md`、`0017-postgres-for-write-model.md`）
- 编号规则：扫 `adr/` 下最大编号 + 1

## 最小模板

```md
# {决定的一句话标题}

{1-3 句：上下文 + 决定 + 为什么。}
```

**一段话就够**。ADR 的价值在于记录了 *that* a decision was made 和 *why*，不在于填完模板。

## 可选段（仅在真正需要时加）

- **Status** — `proposed` / `accepted` / `deprecated` / `superseded by ADR-NNNN`，仅当决策会被重新评估时加
- **Considered Options** — 仅当被拒绝的备选方案需要被记住（否则六个月后有人会再提一次）
- **Consequences** — 仅当有非直观的下游影响需要提前警示

## 什么会命中三重门槛

具体示例（命中 ≥ 2 条即值得考虑）：

- **架构形态**：monorepo / 事件溯源写模型 / 读模型投影到 Postgres
- **跨上下文集成模式**：Ordering 和 Billing 走领域事件而非同步 HTTP
- **带锁定的技术选型**：数据库、消息总线、认证供应商、部署目标（不是每个库，只是要一个季度才能换掉的那种）
- **边界 / 范围决策**：Customer 数据归 Customer context 所有；其它 context 只能引 ID — 显式的"不做什么"与"做什么"同样有价值
- **偏离默认路径的决策**：用手写 SQL 而非 ORM，因为 X — 任何正常读者会假设相反的做法，不记录就会被"修复"
- **代码里看不见的约束**：合规要求 / 响应时间 SLA / 下游 partner API contract
- **非显然的备选拒绝**：考虑过 GraphQL 选了 REST 且原因微妙 — 不记六个月后会有人再提 GraphQL

## 谁调用本协议

- **`workflow-spec`** Spec § 9.2 "方案选择" 段：选定方案符合三重门槛 → 建议作者另立 ADR
- **`fix-bug`** Phase 4：若 `code_specs_impact = spec_gap` 且 gap 涉及架构选择（非单点 bug）→ advisory 提示写 ADR（非强制）
- **`workflow-review`** Stage 1：发现代码实现了 spec 未记录的结构性决策 → advisory 提示补 ADR
- **`grill-with-docs` / `improve-codebase-architecture` 等思考类 skill**：用户在讨论中做出命中三重门槛的决策 → 建议落 ADR，不自动创建

## 通用约束

- **不自动生成**：所有 ADR 必须由作者 / 用户最终拍板。agent 只能"建议"+"给初稿"
- **用 `/spec-update` 写入**：与其它 code-specs 内容共用同一入口，不另开 CLI
- **写了就是接受**：默认 `accepted`；deprecate 时在原文件末尾加一行 `**Superseded by**: ADR-NNNN`，不删旧文件
- **只说 why**：ADR 不写实现步骤、不贴大段代码；具体实现走 convention / contract
