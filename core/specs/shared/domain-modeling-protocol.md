# Domain Modeling Protocol

主动构建 / 打磨领域模型的统一协议。当任何 skill 在讨论中发现术语模糊、过载、缺失或需要拍板时，走本协议——不在各 skill inline 各自描述。

抽取自 `workflow-spec` Step 3 术语挑战段 + `improve-architecture` Step 4 副作用段，消除三处 inline 重复（`grill` / `improve-architecture` / `workflow-spec`）。

## Scope

**必读**（当 skill 触发以下场景时）：
- `workflow-spec` Step 3 讨论需求时遇到术语问题
- `improve-architecture` Step 4 质询中发现新概念或 load-bearing 拒绝理由
- `grill` 质询中对齐术语时

**豁免**：与 `glossary.md` 一致。

## 协议

### 1. 术语挑战

用户用的术语和 glossary 冲突时**当场指出**。词模糊 / 过载但 glossary 未收录 → 当场提议 canonical 词。

示例："你说 account——指 Customer 还是 User?这是两个概念"

### 2. Inline 更新 glossary

新术语确认后，按 `core/specs/shared/glossary.md § 术语更新路由` inline 更新 glossary。不要只在对话里对齐——必须落盘。

### 3. ADR 提议

当决策命中三重门槛时，**建议**落 ADR（不自动创建）：

- **hard to reverse** — 改回来代价大
- **surprising without context** — 未来读代码的人会困惑
- **real trade-off** — 有合理的另一面被否决了

三门槛全中 → 提议；用户确认 → 走 `core/specs/shared/adr-protocol.md` 创建。

### 4. 落盘纪律

讨论结果写入当前 skill 的产物文件（`workflow-spec` → spec.md § 9；`improve-architecture` → 候选记录；`grill` → 对齐后的任务描述）。不得仅依赖对话上下文记忆。
