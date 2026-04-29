# Architecture Language

架构讨论用词表。glossary.md 管项目 / workflow / 产物术语（workflow / skill / pkg / layer / contract），本文件管**架构形状**术语（module / interface / depth / seam / adapter / leverage / locality）。

改编自 mattpocock/skills `improve-codebase-architecture/LANGUAGE.md`（MIT 授权）。一致的架构词汇是 code review、refactor 建议和 deep-module 讨论可读性的前提。

## Scope

**必读**：
- `core/skills/diff-review/**`、`core/skills/workflow-review/**`（跨 skill 通用review语言）
- `core/skills/fix-bug/**` 在讨论架构级 gap 时
- 任何包含"重构 / 深module / 影响边界 / 抽象"讨论的 normative 产出

**豁免**：与 glossary.md 的豁免一致（CLAUDE.md、README、`core/docs/**`、fenced code、`// glossary-allow` 后缀）。

## Terms

### Module
**Definition**: 任何包含 interface 和 implementation 的代码单元——function / class / package / tier-spanning slice。尺度无关，函数级也叫 module。
**Avoid**: unit / component / service（太抽象或带框架内涵）

### Interface
**Definition**: 调用方正确使用此 module 必须知道的一切——type signature、invariant、ordering constraint、error mode、required config、performance characteristic。
**Avoid**: API / signature（只指 type-level 表层）

### Implementation
**Definition**: module 内部代码。与 Adapter 不同：一个物件可以是"小 adapter + 大 implementation"（Postgres repo），也可以是"大 adapter + 小 implementation"（in-memory fake）。当讨论的重心是 seam 时用 adapter，否则用 implementation。

### Depth
**Definition**: interface 的杠杆率——每学习一单位 interface，调用方 / 测试能驱动多少行为。
- **Deep module**: 小 interface + 大 behaviour
- **Shallow module**: interface 复杂度和 implementation 接近

### Seam（来自 Michael Feathers）
**Definition**: 不修改原地代码就能替换行为的位置。module interface 所处的**位置**。seam 放在哪是独立的设计决策，与 seam 背后放什么分开。
**Avoid**: boundary（与 DDD bounded context 重载）

### Adapter
**Definition**: 满足某个 seam 上 interface 的具体实现。描述**角色**（填哪个槽位），不描述**内容**（里面是什么）。

### Leverage
**Definition**: 深度给调用方的回报。每学一单位 interface 获得更多能力；一份 implementation 回馈 N 个 call site 和 M 个测试。

### Locality
**Definition**: 深度给维护者的回报。改动 / bug / 知识 / 验证集中在一处，而非散布于调用方。一处修复处处修复。

## Principles

- **Depth 是 interface 的属性，不是 implementation 的属性。** deep module 内部可以由小的可 mock / 可替换部件组成——它们只是不在 interface 里。module 可以有 **internal seams**（implementation 私有，被自己的测试用）和 **external seam**（在 interface 处）。
- **Deletion test**：想象删掉这个 module。如果复杂度消失，module 没有藏东西（它是 pass-through）。如果复杂度在 N 个 caller 里重现，module 在挣它的工资。
- **Interface 即测试面**：caller 和测试穿过同一个 seam。如果想测"穿过 interface 之后的东西"，module 形状可能有问题。
- **一个 adapter = hypothetical seam；两个 adapter = real seam**。没有东西在 seam 两边变化，就不要引入 seam。

## Relationships

- 一个 **Module** 拥有恰好一个 **Interface**（暴露给 caller 和测试的表面）。
- **Depth** 是 **Module** 的属性，相对于它的 **Interface** 衡量。
- **Seam** 是 **Module** 的 **Interface** 所在的位置。
- **Adapter** 坐落在 **Seam** 上，满足 **Interface**。
- **Depth** 为 caller 产生 **Leverage**，为 maintainer 产生 **Locality**。

## Rejected framings

- **把 depth 定义为 "implementation 行数 / interface 行数" 的比值**（Ousterhout 原版）：鼓励灌水 implementation。本文件采用 depth-as-leverage 定义。
- **"Interface" 等同于 TypeScript `interface` 关键字或 class 的 public 方法**：太窄。此处的 interface 包含 caller 必须知道的所有事实。
- **"Boundary"**：与 DDD bounded context 重载，改用 **seam** 或 **interface**。

## 如何在 review / refactor 建议里使用

- 提到"把 X 和 Y 分开"时说"在 X 和 Y 之间引入 seam"（而不是"boundary"）。
- 评价一个 module 时用 `deep` / `shallow`，附带 deletion test 结论（"删了这个，复杂度会回到 3 个 caller"）。
- 提议抽象时先检查 adapter 数：只有 1 个 adapter = hypothetical seam，暂不抽象；2 个及以上 = real seam，可以引入 interface。
- 讨论测试可达性时用 "the interface is the test surface"——如果测试想绕过 interface，module 形状错了。
