---
name: improve-architecture
description: "Find architectural deepening opportunities — refactors that turn shallow modules into deep ones. Uses deletion test, dependency classification, and parallel interface design exploration. Use when user says 'improve architecture' / '架构优化' / 'refactor for testability' / '这块太散了' / 'find deepening opportunities', or wants to consolidate tightly-coupled shallow modules."
---

<CONTEXT>
Read `core/specs/shared/architecture-language.md` + `core/specs/shared/glossary.md`。仅架构地图级讨论（不产出代码）时可跳 code-specs。
</CONTEXT>

# Improve Architecture

发现架构摩擦,提出**深化机会**——把 shallow module 变成 deep module。目标:可测性 + AI 可导航性。

术语用 `core/specs/shared/architecture-language.md`(Module / Interface / Seam / Adapter / Depth / Leverage / Locality)。项目词汇用 glossary。

## workflow

### 1. 被拒需求扫描

检查项目根 `.out-of-scope/`(协议见 `core/specs/shared/out-of-scope-protocol.md`):
- 存在且与当前探索区域相关 → 告知用户,由用户决定是否仍要探索
- 不匹配 → 跳过

### 2. Explore

用 Agent tool(`subagent_type=Explore`)走代码库。不按死板 heuristic——有机探索,记录摩擦点:

- 理解一个概念需要在多个小 module 间跳转?
- 哪里 shallow — interface 和 implementation 复杂度差不多?
- 纯函数被提取只为可测,但真 bug 藏在调用方式里(无 locality)?
- 紧耦合 module 跨 seam 泄漏?

**Deletion test**:对每个可疑 module 想象删掉它——复杂度消失 = pass-through;复杂度扩散到 N 个 caller = 有价值。

### 3. 展示候选

编号列表。每个候选:
- **Files** — 涉及文件/module
- **Problem** — 当前架构造成什么摩擦
- **Solution** — 改什么(plain English)
- **Benefits** — locality + leverage 角度,以及测试如何改善

**用 glossary 命名 domain 概念,用 architecture-language.md 命名架构概念。**

如候选和现有 ADR 冲突 → 只在摩擦真实到值得重新讨论时提出,标记 _"contradicts ADR-XXXX"_。

**不提接口设计**。问用户:"要探索哪个?"

### 4. Grilling loop

用户选了候选后,进入质询对话:约束、依赖、deepened module 形状、seam 后面放什么、哪些测试存活。

副作用 inline 发生:
- 命名了 glossary 里没有的概念 → inline 更新 glossary,路由见 `core/specs/shared/glossary.md § 术语更新路由`
- 用户给出 load-bearing 拒绝理由 → 提议写 ADR,三重门槛见 `core/specs/shared/adr-protocol.md`

### 5. Interface Design 探索(可选)

用户想看多种接口方案时,走 [INTERFACE-DESIGN.md](references/INTERFACE-DESIGN.md)。
