# Depth Heuristics（架构深度 advisory）

> 供 `SKILL.md` Stage 1 维度表的「Depth Heuristics（advisory）」行引用。纯 advisory：不写入 `quality_gates.*`，不消耗预算，不影响 pass/fail 判定。
>
> Inspired by mattpocock/skills 的 `improve-codebase-architecture/LANGUAGE.md` / `DEEPENING.md` —— 把"小接口 + 深实现"的抽象原则转成 diff 级可操作的三条启发式。

## 词汇表（本 checklist 专用）

与 Probe A–E 共享 diff window，但语言层面独立：

- **Module** — 有接口 + 实现的单元（function / class / package slice）
- **Deep module** — 小接口 / 大实现；复杂度藏在接口背后
- **Shallow module** — 接口几乎和实现一样复杂；多是 pass-through
- **Seam** — 接口所在处（可替换行为的位置）
- **Adapter** — 填在 seam 的具体实现

## 三条核心启发式

### H1 · Deletion test（shallow module 识别）

> 如果删掉这个 module，复杂度**蒸发** → 它是 pass-through（shallow module）。
> 如果删掉，复杂度**分散到 N 个 caller** → 它在干活（deep module）。

**Trigger**：diff 新增或大改（≥ 80% 行变化）一个独立 module 文件。

**Checklist**：

- [ ] 新 module 的**接口行数**（exports / public methods 签名）与**实现行数**近等（比值 ≥ 0.6）？
- [ ] 实际 caller 数 ≤ 1（grep 调用点）？
- [ ] 删掉后把调用逻辑内联回 caller，复杂度是否蒸发而非分散？

三条全 YES → 打 ⚠️ `shallow-module` tag。

**性能复用**：grep caller 的结果应在 Stage 1 context 内缓存并被 H2 / H3 及 Stage 2 共用，避免对同一 module 的调用点重复全仓扫描。

**例外**：
- 明显的 adapter / gateway 文件（命名含 `adapter` / `gateway` / `client`）
- 纯类型 / DTO / 常量文件
- spec § 5.5 Seam Strategy 里已显式声明"为多 adapter 预留"的 port 文件

### H2 · Single-adapter abstraction（人工思考项，不做自动 grep）

> 一个 interface + 一个 adapter = 假想 seam；等有第二个 adapter 再立 port。

**本条不做自动触发**——TypeScript / Vue / React 里 `interface` 多半是类型标注而非 port，grep 会大面积误伤 props、DTO、函数签名 interface。

Stage 1 主任务读 diff 时按以下**自问清单**判断：

- [ ] diff 里新增的**抽象类**（`abstract class` / Python `ABC` / OOP 语言的 abstract base）只有**一个**具体子类？
- [ ] 新增的**注入点接口**（构造函数注入、DI 容器 binding、依赖注入装饰器标注的接口）只有**一个**实现类？
- [ ] 该接口在 spec § 5 或 § 5.5 Seam Strategy 是否显式声明"预留多实现"？有 → 忽略；无 → 写 advisory

命中时打 ⚠️ `single-adapter-abstraction` tag。

**排除**：
- 纯类型标注（props / DTO / 函数签名 interface）不算 seam
- 协议 / contract 类文件（命名含 `protocol` / `contract` / 与 code-spec contract 对齐）

### H3 · Testing past the interface（测试形状信号）

> 测试穿过同一个 seam。如果需要测"past the interface"（private method、内部 state、实现细节），module 形状可能不对。

**Trigger**：diff 包含 test 文件修改或新增。

**Checklist**：

- [ ] test 直接访问 `_privateField` / `#private` / `.__internal__`？
- [ ] test 含 `// @ts-expect-error` / `as any` 并访问非公共 API？
- [ ] test 通过反射 / `Object.getPrototypeOf` / 运行时 introspection 读取私有状态？
- [ ] test 断言依赖内部数据结构（如 `expect(instance._cache.size).toBe(...)`）？

任一 YES → 打 ⚠️ `testing-past-interface` tag。

## 输出位置

Stage 1 输出块在 `Cross-Layer (Advisory)` 块之后、`Probe E` 块之前追加 `Depth (Advisory)` 子块：

```
**Depth (Advisory):**
- [H1 shallow-module] src/utils/logger-wrapper.ts — 接口 8 行 / 实现 10 行、仅 1 caller；考虑内联
- [H2 single-adapter] src/gateways/ReportGateway.ts — 唯一 HttpReportGateway 实现且 spec 未声明预留；Stage 2 会复查
- [H3 testing-past-interface] test/payment.test.ts L42 — 直接读 `_state`；考虑改走公共 API 或增加 observable
```

**无命中时省略整个子块**（与 § A–D 一致）。

## Why 这些是 advisory 不是阻塞

- 深度判断主观，容易因"未来再加 adapter"被反驳
- shallow / single-adapter 是**信号**，不是错误——有时候过渡期就需要这样的中间态
- 阻塞会制造大量噪音；advisory 让主任务 / 用户决定

## 与其它 probe 的关系

| Probe | 层级 | 阻塞语义 | 关注点 |
|-------|------|----------|--------|
| A–D（cross-layer-checklist） | 同层 | advisory | 数据流 / 复用 / import / 同层一致 |
| E（infra depth gate） | 同层 | **阻塞** | code-spec 7 段深度（文档完备性） |
| 本 checklist（H1–H3） | 同层 | advisory | 代码结构深度（接口 / seam） |

E 查"文档深度"（code-spec 是否完备）；本 checklist 查"代码深度"（module 是否形状健康）。两者正交、可同时触发。

## 与 spec § 5.5 Depth and Seams 的关系

- spec § 5.5 是**事前声明**：plan 阶段写出 module 深度预期 / seam 策略
- 本 checklist 是**事后复核**：review 阶段对照 diff 找反模式
- 如 spec § 5.5 存在 → 本 checklist 优先信任其声明（"已声明预留多 adapter"可屏蔽 H2）
- spec § 5.5 缺失 → 按默认启发式判断
