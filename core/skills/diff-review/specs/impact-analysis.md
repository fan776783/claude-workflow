# diff-review 影响性分析规范

> 为 `diff-review` 提供统一的 impact-aware review contract。该规范定义何时执行影响性分析、分析哪些维度、如何输出 blast radius / regression risk / validation scope，并作为 Quick / Deep 两种模式共享的依据。

## 何时读取

- `core/skills/diff-review/SKILL.md` 进入 finding verification 之后、报告汇总之前
- Quick 模式需要判断某个 finding 是否应升级为 material finding 时
- Deep 模式需要对 Codex / Claude 候选问题做统一裁决时
- Review Loop 中对 blocking finding 制定修复与复审范围时

## 目标

影响性分析不是泛泛而谈的“看起来有风险”，而是回答以下问题：

1. 这个问题是否真实越过了当前 diff 的局部上下文？
2. 它可能影响哪些文件、模块、调用方、共享状态或契约边界？
3. 它的 blast radius 是局部的，还是跨模块 / 系统级的？
4. 现有测试是否覆盖这些影响面？若没有，缺口在哪里？
5. 若修复该问题，复审时必须回看的范围是什么？

## 与 finding verification 的关系

执行顺序必须是：

```text
Candidate Finding
  → VERIFY（问题是否存在、是否由本次改动引入）
  → IMPACT ANALYSIS（影响范围有多大、证据是什么）
  → SEVERITY CALIBRATION（最终优先级）
  → REPORT
```

禁止跳过 VERIFY 直接进行影响性分析；也禁止在没有 impact evidence 的情况下，将跨边界风险直接定为 P0/P1。

## 何时必须执行完整影响性分析

### 必做（完整分析）

以下 finding 必须执行完整 impact analysis：

- 所有准备进入最终报告的 **P0 / P1** 候选问题
- 任意声称存在以下风险的 **P2** 候选问题：
  - 跨模块影响
  - 共享状态副作用
  - API / schema / props / config / return shape 契约破坏
  - 数据流传播风险
  - 高回归风险
  - 用户可见行为退化

### 可做轻量分析

以下 finding 可只做轻量 impact scan：

- 局部且证据充分的 P2 问题
- P3 建议项
- 明显不涉及共享边界、调用链、契约变更的局部实现缺陷

轻量分析至少要说明：
- 影响局限于哪里
- 为什么不需要完整 blast-radius tracing

## 分析维度

### 1. Direct Impact

识别直接受影响的实现面：
- 变更文件
- 变更函数 / 类 / 组件 / hook / service
- 当前 diff 直接修改的逻辑分支或状态转换

### 2. Dependency / Caller Chain

识别调用链传播范围：
- 哪些调用方直接依赖该函数 / 模块 / 组件？
- 是否有间接 consumer 通过共享 util / service / store 间接受影响？
- 是否存在跨层传播（UI → service → API / state / persistence）？

### 3. Data / State Flow

识别数据与状态传播路径：
- 受影响变量、参数、返回值如何向下游传播？
- 是否涉及 Context / Store / 全局状态 / 缓存 / feature toggles / 隐式依赖？
- 是否存在“局部改动、全局生效”的状态副作用？

### 4. Contract Boundaries

识别被触及的契约边界：
- API request / response shape
- schema / persistence shape
- component props / emitted events / callback contract
- config keys / env assumptions
- error handling contract / loading state contract / permission contract

只要 claim 涉及“其他部分会坏”，必须明确指出被影响的 contract boundary。

### 5. User-visible Surface

识别用户可见影响：
- 页面行为 / 交互状态 / 权限结果 / 数据呈现
- loading / empty / error / retry 等状态是否变化
- 是否会造成 silent failure、误导性 UI、或不可恢复的流程中断

### 6. Test Coverage / Validation Surface

识别验证证据与缺口：
- 是否已有测试覆盖直接影响面？
- 是否已有测试覆盖间接影响面？
- 现有测试是否真正覆盖风险点，还是只覆盖 happy path？
- 修复后至少要重新验证哪些测试 / 场景？

## 风险分级

### Blast Radius

```text
local        = 影响局限于当前实现单元或单一文件
module       = 影响同一模块内多个调用点或组件
cross-module = 影响多个模块 / 层之间的调用链或共享契约
systemic     = 影响核心共享基础设施、全局状态或广泛用户流程
```

### Regression Risk

```text
low    = 局部影响、测试覆盖充分、无共享边界变更
medium = 存在少量调用链传播或部分测试缺口
high   = 共享契约 / 跨模块 / 全局状态 / 核心路径，且测试不足或后果严重
```

## 严重级别校准规则

最终 severity 必须在 impact analysis 之后确定：

- **P0**：已验证的问题会导致阻塞发布级故障，且 blast radius 为 `cross-module` 或 `systemic`，或虽局部但后果极严重（安全、数据破坏、核心流程瘫痪）
- **P1**：问题真实存在，影响面明确，且会在实际使用中导致重要功能错误、明显回归或较高运维成本
- **P2**：问题真实存在，但影响受限、可控，或需要特定上下文才触发
- **P3**：建议项、局部优化项，或 impact 已证实局限在很小范围内

禁止仅因“看起来重要”而在未完成 impact analysis 前提升为 P0/P1。

## 输出结构

每个完成 impact analysis 的 finding，至少应形成以下信息：

```markdown
### Impact
- Direct files: <直接影响文件>
- Affected modules: <模块 / 调用方 / consumers>
- Affected surfaces: <用户可见行为 / 契约 / 状态面>
- Shared state / contracts: <若无则写 None>
- Blast radius: local / module / cross-module / systemic
- Regression risk: low / medium / high
- Existing tests: <相关测试或 None>
- Validation scope: <修复后必须复查的测试 / 场景>
```

如果无需完整 impact analysis，也必须写明：

```markdown
### Impact
- Scope: local only
- Reason: <为什么不需要完整 tracing>
- Validation scope: <最小复查范围>
```

## Review Loop 集成要求

当最终报告 `Verdict = INCORRECT` 且 finding 为 P0/P1 时，impact analysis 输出必须继续传递到修复建议：

- **Fix Scope**：改什么、不要误伤什么
- **Regression Verification**：修复后必须回归的调用方、模块、状态或测试
- **Re-review Focus**：重新审查时优先检查的 impact scope

重新审查时，不得只看修改行；必须先检查上轮报告中的 `Validation scope` 与 `Re-review Focus`。

## 推荐检索方式

优先使用现有检索约定，而不是拍脑袋推测：
- 搜调用方 / importers / references
- 搜相关测试文件与测试引用
- 搜共享状态 / 契约定义 / schema / config 使用点
- 如 claim 无法找到具体受影响代码，应降级或移除

## 设计来源

本规范复用了以下已有模式：
- `core/skills/fix-bug/references/impact-analysis.md` 的依赖链 / 数据流 / 测试覆盖 / 风险分级
- `core/skills/workflow-delta/specs/delta/impact-analysis.md` 的 `affectedFiles / affectedModules / riskLevel` 结构化思路
- `core/specs/workflow-runtime/review-feedback-protocol.md` 的 `VERIFY → EVALUATE` 纪律
