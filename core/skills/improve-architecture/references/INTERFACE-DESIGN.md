# Interface Design

用户想为选中的深化候选探索多种接口方案时用此协议。基于"Design It Twice"(Ousterhout)——第一个想法不太可能是最好的。

## 流程

### 1. Frame 问题空间

spawn sub-agents 之前,写一段用户可读的问题空间说明:
- 新 interface 必须满足的约束
- 依赖及其分类(见 [DEEPENING.md](DEEPENING.md))
- 一个 illustrative code sketch 让约束具体化——不是提案,只是锚定

展示给用户,然后立即进 Step 2。用户读的同时 sub-agents 并行工作。

### 2. Spawn sub-agents

用 Agent tool spawn 3+ sub-agents(**注意:这是 skill 内部 Agent 调用,不是 `/dispatching-parallel-agents`**)。每个产出一种**结构性不同**的 interface。

每个 sub-agent 收到独立 technical brief(文件路径、耦合细节、依赖分类、seam 后面放什么)+ 不同的设计约束:

- Agent 1: "Minimize interface — 1-3 entry points max. Maximize leverage per entry point."
- Agent 2: "Maximize flexibility — support many use cases and extension."
- Agent 3: "Optimize for common caller — make default case trivial."
- Agent 4 (if applicable): "Design around ports & adapters for cross-seam dependencies."

Brief 中包含 `architecture-language.md` 词汇和项目 glossary 词汇。

每个 sub-agent 输出:
1. Interface(types / methods / params + invariants / ordering / error modes)
2. Usage example — caller 怎么用
3. Implementation 藏了什么在 seam 后面
4. Dependency strategy + adapters(参考 [DEEPENING.md](DEEPENING.md))
5. Trade-offs — leverage 高在哪里、薄在哪里

### 3. 对比 + 推荐

顺序展示各设计让用户逐个消化,然后 prose 对比。按 **Depth**(interface leverage)、**Locality**(change concentration)、**Seam placement** 对比。

给出你的推荐:哪个最强、为什么。不同设计的元素能组合就提 hybrid。有观点——用户要的是 strong read 不是菜单。

### Fallback(不支持并行时)

工具不支持并行 Agent 调用 → 顺序执行 3 个方案(每个用不同约束),其余流程不变。
