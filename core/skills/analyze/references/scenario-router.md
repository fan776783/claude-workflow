# 场景参考索引

本文件是 `/analyze` 的参考资料，不是每次分析必须执行的输出契约。

模型在 Phase 2 中做出 `analysis_depth` / `codex_involvement` / `focus_hint` 判断时，
可参考下列场景获取灵感，但不需要逐字段填写。

## 使用指引

- 下列场景的 trigger signals 是示例信号，不是匹配规则。以语义意图识别为准。
- 各场景中的 codex_scope / claude_scope 等字段是参考分工建议，不需要显式输出。
- 当无法精确分类时，优先保证：
  1. 先解释现状，再给建议
  2. 先指出证据，再下结论
  3. 简单定位类请求默认 `analysis_depth: locate`，不升级成重型流程

## 场景清单

### 1. Codebase Overview / Orientation

- **Trigger signals**：上下文、了解、概览、整体结构、这个项目是做什么的、overview、architecture overview
- **analysis_type**：`overview`
- **primary_focus**：项目结构、关键模块、主要职责边界
- **secondary_focus**：入口点、数据流、扩展点
- **codex_scope**：可选；仅在涉及复杂架构或跨模块关系时补充技术视角
- **claude_scope**：主导整体解释、结构梳理、用户可感知的组织方式
- **required_evidence**：目录结构、入口文件、关键模块、调用关系
- **synthesis_emphasis**：建立整体心智模型
- **fallback_behavior**：默认当前模型独立完成；无须强制调用 Codex

### 2. Code Location / Trace Path

- **Trigger signals**：在哪、找到、搜索、定位、入口、谁调用、在哪里处理、where is、trace、path
- **analysis_type**：`location`
- **primary_focus**：定位相关文件、函数、调用链、配置入口
- **secondary_focus**：调用顺序、边界条件、关联模块
- **codex_scope**：通常跳过；仅在跨模块调用链复杂时补充
- **claude_scope**：主导定位、追踪调用路径、解释阅读顺序
- **required_evidence**：文件路径、函数名、调用链、配置项
- **synthesis_emphasis**：给出可跟踪的阅读路径
- **fallback_behavior**：默认当前模型独立完成；若证据不足，说明缺口并给出下一步检索方向

### 3. Root Cause / Bug Explanation

- **Trigger signals**：原因、为什么、bug、错误、异常、没生效、卡住、失效、why is、root cause
- **analysis_type**：`root-cause`
- **primary_focus**：错误现象的成因、首次出错边界、关键失配点
- **secondary_focus**：影响范围、复现条件、可能的替代解释
- **codex_scope**：后端逻辑、状态转换、契约失配、边界条件
- **claude_scope**：前端行为、交互路径、跨层集成与最终综合裁决
- **required_evidence**：错误路径、调用链、状态变化、契约输入输出
- **synthesis_emphasis**：证据链、主假设、备选假设、最可能根因
- **fallback_behavior**：Codex 不可用时由当前模型输出带限制说明的独立分析；若证据不足，明确列出未证实点

### 4. Performance Analysis

- **Trigger signals**：性能、慢、优化、瓶颈、卡顿、吞吐、延迟、响应慢、performance、bottleneck
- **analysis_type**：`performance`
- **primary_focus**：性能瓶颈位置、资源消耗、关键热点
- **secondary_focus**：可观测性、验证方式、权衡成本
- **codex_scope**：后端性能、算法复杂度、资源管理、I/O 路径
- **claude_scope**：前端渲染、交互延迟、bundle / 状态更新链路，以及综合权衡
- **required_evidence**：热点路径、调用频次、资源边界、可能的慢路径
- **synthesis_emphasis**：瓶颈排序、收益/成本权衡、验证建议
- **fallback_behavior**：若缺少可观测性证据，输出“基于代码结构的候选瓶颈”而非确定性结论

### 5. Security / Dependency Audit

- **Trigger signals**：依赖、漏洞、安全、审计、权限、越权、注入、leak、audit、security
- **analysis_type**：`audit`
- **primary_focus**：安全风险、依赖风险、信任边界、输入输出边界
- **secondary_focus**：缓解方向、影响范围、误报风险
- **codex_scope**：后端安全、依赖链风险、数据流与边界检查
- **claude_scope**：前端暴露面、用户可见风险、跨层数据暴露与最终综合
- **required_evidence**：输入源、敏感路径、权限边界、依赖使用位置
- **synthesis_emphasis**：风险等级、影响面、优先治理顺序
- **fallback_behavior**：Codex 不可用时仅输出当前模型能直接验证的风险，不夸大未证实问题

### 6. Architecture / Design Review

- **Trigger signals**：架构、设计、合理、重构、模式、可维护性、扩展性、architecture、design
- **analysis_type**：`architecture`
- **primary_focus**：结构合理性、职责边界、扩展性、复杂度来源
- **secondary_focus**：替代方案、迁移成本、长期维护影响
- **codex_scope**：后端结构、接口契约、复杂度与风险来源
- **claude_scope**：前端/交互结构、CLI/workflow 体验、整体收口与权衡
- **required_evidence**：模块边界、依赖方向、共享契约、职责分布
- **synthesis_emphasis**：结构问题、权衡取舍、推荐演进方向
- **fallback_behavior**：若请求范围过大，先收缩到最关键的模块或流程再分析

### 7. Requirement Decomposition

- **Trigger signals**：需求、拆解、功能点、PRD、方案、怎么做、拆分、requirement
- **analysis_type**：`decomposition`
- **primary_focus**：需求拆分、子问题边界、依赖顺序
- **secondary_focus**：风险点、缺失信息、需要确认的决策
- **codex_scope**：后端实现面、数据契约、复杂技术依赖
- **claude_scope**：前端/交互面、工作流体验、跨层衔接与综合输出
- **required_evidence**：现有模块能力、契约边界、依赖关系、用户路径
- **synthesis_emphasis**：拆分结果、优先级、待确认问题
- **fallback_behavior**：信息不完整时，先输出拆解假设与缺口，不伪造确定性方案

## 组合与优先级规则

当一个请求同时命中多个场景时：

1. **location** 优先用于缩小范围，不应单独把请求升级为重型分析。
2. **root-cause / performance / audit / architecture** 属于深度分析场景，可与其他场景组合。
3. **overview** 只在用户目标确实偏理解全貌时作为主场景；否则作为补充背景。
4. **decomposition** 可与 `architecture` 组合；先解释现有结构，再拆需求更稳妥。

推荐判断顺序：

- 先判断用户是在**找位置**、**找原因**、**做评审**、还是**做拆解**
- 再判断问题主要落在 frontend / backend / CLI / workflow / cross-stack 哪个领域
- 最后决定 Codex 是跳过、补充还是主参与者

## 默认退化策略

### A. 当前模型独立完成

适用于：

- 定位类问题
- 小范围结构解释
- 明显偏前端/交互的分析
- 证据足够且无需额外技术视角的问题

### B. Codex 协助 + 当前模型综合

适用于：

- 根因分析
- 架构评审
- 性能分析
- 安全 / 依赖审计
- 跨模块 / 跨层问题

### C. Degraded 输出

若 Codex 不可用、返回过于泛化，或检索证据不足：

- 明确标记结论的限制条件
- 区分“已证实发现”和“候选判断”
- 给出最小下一步验证建议

## 示例

**用户输入**：`分析这个 skill 的执行过程是否可以优化`

**推荐判断结果**：

- `analysis_depth`: `deep`
- `codex_involvement`: `assist`
- `focus_hint`: skill 执行流是否存在重复、串行依赖或契约漂移，重点关注关键优化点与推荐改造顺序
