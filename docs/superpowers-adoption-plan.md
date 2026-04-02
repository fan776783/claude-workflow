# Superpowers 借鉴实施方案

> 从 Superpowers 项目中提炼 8 项核心机制，融入 claude-workflow 现有体系。
>
> 原则：增强执行纪律，不改变现有架构。每项改动都是对现有文件的增量修改。

---

## 审查结论

> Codex + 当前模型交叉验证（2026-02-25）

| # | 提案 | 评定 | 关键调整 |
|---|------|------|----------|
| 1 | 验证铁律 | ✅ 已实施（加固） | 增加 VerificationEvidence 接口、git_commit 检查 commit hash |
| 2 | 设计审批硬门控 | ✅ 已实施（加固） | 条件触发（非空维度 ≥ 3）、短需求静默通过 |
| 3 | 任务粒度标准 | ✅ 已实施（方案 B） | 步骤内化到 requirement 字段，Step 6.5 支持步骤级验证 |
| 4 | 根因追溯纪律 | ✅ 已实施（加固） | 允许 1 主 + 1 备假设、明确失败计数语义 |
| 5 | 双阶段任务审查 | ✅ 已实施（改为只读） | 去掉自动修复，偏差追加为新任务 |
| 6 | 借口表 + 红旗清单 | ✅ 已实施 | 放入 references 而非输出模板，避免膨胀 |
| 7 | 审查反馈技术验证 | ✅ 已实施（加固） | 最多验证 5 条 P0/P1、安全类豁免 YAGNI |
| 8 | 并行代理独立性验证 | ✅ 已实施（渐进式） | 状态模型扩展 + 独立性检查器 + 并行执行器，含冲突检测和降级策略 |

---

## 总览

| #   | 借鉴点                  | 改动目标          | 涉及文件                                                                              |
| --- | ----------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| 1   | 验证铁律                | execute 流程      | `specs/execute/execution-modes.md`, `references/execute-overview.md`                  |
| 2   | 设计审批硬门控          | start 流程        | `specs/start/phase-0.5-requirement-extraction.md`, `references/start-overview.md`     |
| 3   | 任务粒度标准            | 任务生成          | `specs/start/phase-2-task-generation.md`                                              |
| 4   | 根因追溯纪律            | fix-bug skill     | `skills/fix-bug/SKILL.md`, `skills/fix-bug/references/root-cause-tracing.md`（新增）  |
| 5   | 双阶段任务审查          | execute 流程      | `specs/execute/execution-modes.md`, `references/execute-overview.md`                  |
| 6   | 合理化借口表 + 红旗清单 | Brief / 验收映射   | `specs/start/phase-0.6-brief.md`, `references/brief.md` |
| 7   | 审查反馈技术验证        | diff-review skill | `skills/diff-review/SKILL.md`, `skills/diff-review/references/deep-mode.md`           |
| 8   | 并行代理独立性验证      | execute 流程      | `specs/execute/execution-modes.md`                                                    |

---

## 1. 验证铁律（Verification Iron Law）

**来源**: Superpowers `verification-before-completion`

**问题**: 当前 execute 流程在 Step 7 直接标记任务为 `completed`，没有强制要求运行验证命令并读取输出。代理可能在未实际验证的情况下声称任务完成。

**改动方案**:

在 `specs/execute/execution-modes.md` 的 Step 7（更新任务状态）之前，插入 Step 6.5：

```markdown
### Step 6.5：完成验证（Iron Law）

**铁律：没有新鲜验证证据，不得标记任务为 completed。**

每个任务完成后，必须执行以下验证序列：

1. **识别验证命令**：根据任务类型确定验证方式
   - `create_file` / `edit_file` → 运行相关测试 或 检查文件语法
   - `run_tests` → 读取测试输出，确认全部通过
   - `codex_review` → 读取审查评分，确认达到阈值
   - `git_commit` → 运行 `git status` 确认提交成功

2. **执行验证命令**：实际运行命令并读取输出

3. **验证通过判定**：
   - 测试全部通过 → ✅ 可标记完成
   - 文件语法正确 → ✅ 可标记完成
   - 审查评分达标 → ✅ 可标记完成
   - 任何失败 → ❌ 标记为 `failed`，禁止标记 `completed`

**红旗清单**（出现以下情况说明在跳过验证）：

- 使用"应该没问题"、"看起来正确"等模糊措辞
- 没有运行任何命令就标记完成
- 只运行了部分验证就声称全部通过
- 引用之前的测试结果而非本次运行结果
```

在 `references/execute-overview.md` 的 Step 7 之前添加对 Step 6.5 的引用。

---

## 2. 设计审批硬门控（Design Approval Hard Gate）

**来源**: Superpowers `brainstorming`

**问题**: 当前 Phase 0.5（需求结构化提取）完成后会继续进入 Phase 0.55 / 0.6（Requirement Baseline 与 Brief 生成），如果缺少显式确认点，后续所有产出都可能沿着错误理解继续收敛。

**改动方案**:

在 `specs/start/phase-0.5-requirement-extraction.md` 末尾，添加硬门控：

````markdown
### Hard Gate: 需求理解确认

Phase 0.5 完成后，**必须**向用户展示结构化提取结果摘要并等待确认：

​```

## 需求理解确认

### 提取摘要

- **表单场景**: {N} 个（{场景列表}）
- **角色权限**: {N} 个角色（{角色列表}）
- **交互规格**: {N} 条
- **业务规则**: {N} 条
- **边界场景**: {N} 个
- **UI展示规则**: {N} 条
- **功能流程**: {N} 个

### 关键业务规则

1. {最重要的 3 条业务规则}

### 可能的遗漏

- {基于分析识别的潜在遗漏点}

## 以上理解是否准确？需要补充或修正吗？(Y/N)

​```

**立即终止，禁止继续执行 Phase 0.6。**

用户确认后才可继续。如果用户提出修正：

1. 更新结构化提取结果
2. 重新展示摘要
3. 再次等待确认
````

在 `references/start-overview.md` 的流程图中，Phase 0.5 与后续 Phase 0.55 / 0.6 之间添加 `🛑 确认需求理解` 节点。

---

## 3. 任务粒度标准（Bite-Sized Task Steps）

**来源**: Superpowers `writing-plans`

**问题**: 当前 Phase 2 生成的任务粒度偏粗，一个任务可能包含"创建组件 + 实现逻辑 + 添加样式"等多个步骤，缺少步骤级验证点和显式提交点。

**改动方案**:

在 `specs/start/phase-2-task-generation.md` 的 Step 2（生成任务列表）中，为每个任务添加 `steps` 字段：

````markdown
### 任务步骤标准

每个 `create_file` 或 `edit_file` 类型的任务，必须拆分为以下步骤序列：

​```typescript
interface TaskStep {
action: string; // 具体动作
expected: string; // 预期结果（可验证）
}

// 标准步骤模板
const STANDARD_STEPS: TaskStep[] = [
{ action: "写测试（如适用）", expected: "测试文件已创建，运行后失败（RED）" },
{ action: "实现功能", expected: "代码已写入目标文件" },
{ action: "运行验证", expected: "测试通过（GREEN）或语法检查通过" },
{ action: "检查副作用", expected: "相关模块的现有测试仍然通过" },
];
​```

**粒度标准**：

- 每个步骤应该是一个原子操作（创建一个文件、修改一个函数、运行一次测试）
- 每个步骤都有明确的预期结果
- 如果一个任务的 `requirement` 描述超过 2 句话，考虑拆分为多个任务

**输出格式变更**：

在 tasks.md 中，每个任务增加步骤列表：

​```markdown

## T3: 实现用户列表组件

- **阶段**: ui-display
- **文件**: `src/components/UserList.vue`
- **需求**: 实现用户列表展示，支持分页和筛选
- **验收项**: AC-U1.1, AC-F1.2
- **步骤**:
  1. 创建组件文件，实现基础结构 → 预期：文件已创建，无语法错误
  2. 实现列表渲染逻辑 → 预期：静态数据可正常渲染
  3. 接入 API 数据 → 预期：真实数据可正常展示
  4. 实现分页功能 → 预期：翻页操作正常
  5. 运行验证 → 预期：相关测试通过
- **状态**: pending
  ​```
````

---

## 4. 根因追溯纪律（Root Cause Tracing）

**来源**: Superpowers `systematic-debugging`

**问题**: 当前 fix-bug skill 的 Phase 1 直接进行"根本原因定位"，但没有强制要求反向追踪数据流、形成单一假设再验证。容易陷入"猜测 → 尝试修复 → 失败 → 再猜"的循环。

**改动方案**:

修改 `skills/fix-bug/SKILL.md` 的 Phase 1.3，替换为假设驱动的调试流程：

```markdown
**1.3 假设驱动的根因追溯**：

**Step 1: 反向追踪**

- 从错误现象出发，沿数据流反向追踪
- 在每个组件边界添加日志/断点，定位错误首次出现的位置
- 记录追踪路径：`错误现象 → 组件A → 组件B → 根因位置`

**Step 2: 形成单一假设**

- 基于追踪结果，形成一个明确的假设
- 假设格式："因为 {原因}，导致 {组件} 在 {条件} 下产生 {错误行为}"
- 禁止同时持有多个假设

**Step 3: 最小化验证**

- 设计最小实验验证假设（不是修复，是验证）
- 如果假设被证伪，回到 Step 1 继续追踪
- 如果假设被证实，进入 Phase 2

**架构质疑规则**：

- 如果连续 3 次修复尝试失败，必须停下来质疑架构
- 输出："已尝试 3 次修复均失败，问题可能不在表层。建议重新审视 {相关模块} 的架构设计。"
- 此时触发 Hard Stop，等待用户决策
```

新增参考文档 `skills/fix-bug/references/root-cause-tracing.md`：

```markdown
# 根因追溯技术参考

## 反向追踪法

从错误现象出发，沿调用链/数据流反向追踪：

1. 确认错误的精确表现（错误消息、错误值、异常行为）
2. 找到产生该错误值的直接代码位置
3. 检查该位置的输入来源
4. 对每个输入重复步骤 2-3，直到找到根因

## 多组件系统诊断

当系统涉及多个组件时：

1. 在每个组件边界记录输入/输出
2. 找到"最后正确"和"首次错误"的边界
3. 根因就在这两个边界之间

## 红旗清单

出现以下情况说明在走捷径：

- "先试试改这个看看" — 没有假设就动手
- "可能是这里的问题" — 模糊定位，没有追踪证据
- "改了好几个地方应该能修好" — 散弹枪式修复
- "跳过测试，手动验证一下" — 逃避自动化验证
```

---

## 5. 双阶段任务审查（Two-Stage Review Per Task）

**来源**: Superpowers `subagent-driven-development`

**问题**: 当前 execute 流程中，任务完成后直接标记为 `completed`，只在质量关卡（`codex_review`）时才做审查。单个任务的实现可能偏离规格但不被发现，直到质量关卡时积累了大量偏差。

**改动方案**:

在 `specs/execute/execution-modes.md` 中，Step 6.5（验证铁律）之后、Step 7 之前，添加 Step 6.7：

```markdown
### Step 6.7：规格合规检查（Spec Compliance Check）

对 `create_file` 和 `edit_file` 类型的任务，在验证通过后执行轻量级规格合规检查：

**检查内容**：

1. **验收项覆盖**：任务关联的验收项（`acceptance_criteria`）是否都被实现覆盖
2. **设计参考一致**：实现是否与 `design_ref` 指向的技术方案章节一致
3. **需求完整性**：`requirement` 描述的功能是否完整实现

**执行方式**：

- 当前模型直接检查（不调用外部模型，保持轻量）
- 读取任务的验收项内容，逐项比对实现代码
- 发现偏差时输出具体差异，不自动修复

**检查结果**：

- 全部覆盖 → ✅ 继续 Step 7
- 存在偏差 → 输出偏差列表，自动修复后重新验证
- 严重偏差（缺失核心功能）→ 标记 `failed`，提示用户

**跳过条件**：

- `run_tests`、`codex_review`、`git_commit` 类型的任务跳过此步骤
- 任务无 `acceptance_criteria` 时跳过
```

---

## 6. 合理化借口表 + 红旗清单（Rationalization Table & Red Flags）

**来源**: Superpowers `writing-skills` + `verification-before-completion`

**问题**: 当前Brief只有检查项，没有防止代理走捷径的机制。代理可能用"手动验证过了"、"这个场景不会发生"等借口跳过验证。

**改动方案**:

在 `specs/start/phase-0.6-brief.md` 的输出文件结构中，在“验收通过标准”之后添加新章节：

```markdown
## 10. 合理化借口表

> 以下是代理/开发者常见的跳过验证的借口，以及为什么不能接受。

| 借口                 | 为什么不能接受                 | 正确做法                     |
| -------------------- | ------------------------------ | ---------------------------- |
| "手动测试过了"       | 手动测试不可重复，无法作为证据 | 运行自动化测试或录制操作步骤 |
| "这个场景不会发生"   | 边界场景往往在生产环境才暴露   | 按清单逐项验证，不做假设     |
| "和之前的实现一样"   | 上下文不同，行为可能不同       | 在当前上下文中重新验证       |
| "时间不够，先跳过"   | 跳过验证的技术债比重写更贵     | 至少完成 Must Pass 项        |
| "测试框架有问题"     | 工具问题不是跳过验证的理由     | 修复工具或使用替代验证方式   |
| "改动太小不需要测试" | 小改动也可能引入回归           | 运行相关测试确认无副作用     |

## 11. 红旗清单

> 出现以下信号时，说明验证流程正在被绕过。

- ⛳ 任务标记为 completed 但没有运行任何验证命令
- ⛳ 验收项被标记为通过但没有对应的测试输出
- ⛳ 使用"应该"、"大概"、"看起来"等模糊措辞描述验证结果
- ⛳ 只验证了正常路径，跳过了所有边界场景
- ⛳ 引用其他任务的验证结果作为当前任务的证据
- ⛳ 验证命令的输出没有被读取就声称通过
```

在 `references/brief.md` 的“注意事项”章节中添加：

```markdown
6. **防绕过机制**：每份Brief自动包含合理化借口表和红旗清单，帮助执行者自检
```

---

## 7. 审查反馈技术验证（Technical Verification Before Implementation）

**来源**: Superpowers `receiving-code-review`

**问题**: 当前 diff-review 的 Deep 模式收到 Codex 的审查意见后，直接整合输出。没有对审查建议本身进行技术验证，可能导致实施不必要的改动或引入新问题。

**改动方案**:

修改 `skills/diff-review/SKILL.md`，在"审查标准"之后添加：

```markdown
## 审查反馈验证（Deep 模式）

收到 Codex 的审查意见后，当前模型必须对每条 P0/P1 建议执行技术验证：

**验证流程**：

1. **理解建议**：完整阅读建议内容，理解其要求
2. **代码库验证**：检索代码库，验证建议所描述的问题是否真实存在
3. **YAGNI 检查**：如果建议要求添加新功能/抽象，检查是否有实际使用场景
4. **副作用评估**：评估实施建议是否会引入新问题

**处理规则**：

- 验证通过 → 保留建议，纳入最终报告
- 问题不存在 → 降级或移除，标注"经验证，该问题在当前代码库中不存在"
- YAGNI 不通过 → 降级为 P3，标注"当前无实际使用场景"
- 有副作用风险 → 保留但补充风险说明

**禁止行为**：

- 不加验证地全盘接受外部模型的所有建议
- 对明显错误的建议表示"完全同意"
- 实施与当前代码库风格/架构不一致的建议
```

同步更新 `skills/diff-review/references/deep-mode.md` 中的整合步骤。

---

## 8. 并行代理独立性验证（Parallel Agent Independence Check）

**来源**: Superpowers `dispatching-parallel-agents`

**问题**: 当前 execute 流程的 Subagent 模式按任务顺序逐个分派，没有检测哪些任务可以并行执行。同时，并行执行时没有验证任务之间是否真正独立。

**改动方案**:

在 `specs/execute/execution-modes.md` 中，为 Subagent 模式添加并行执行支持：

````markdown
### 并行执行预检（Subagent 模式）

当连续多个任务处于同一阶段且无依赖关系时，可以并行执行。但必须先通过独立性验证：

**独立性检查清单**：

1. **文件独立**：任务操作的文件没有交集
2. **依赖独立**：任务之间没有 `depends` 关系
3. **状态独立**：任务不修改共享状态（同一个 Store、同一个配置文件）
4. **导入独立**：任务创建的模块不被同批次其他任务导入

**检查方式**：
​```typescript
function canRunInParallel(taskA: Task, taskB: Task): boolean {
// 1. 文件交集检查
if (taskA.file && taskB.file && taskA.file === taskB.file) return false;

// 2. 依赖关系检查
if (taskA.depends === taskB.id || taskB.depends === taskA.id) return false;

// 3. 共享状态检查（同目录下的 store/config 文件）
const sharedPaths = ['store', 'config', 'constants', 'types'];
const aIsShared = sharedPaths.some(p => (taskA.file || '').includes(p));
const bIsShared = sharedPaths.some(p => (taskB.file || '').includes(p));
if (aIsShared && bIsShared) return false;

return true;
}
​```

**并行执行流程**：

1. 从当前阶段的 pending 任务中，找出所有可并行的任务组
2. 对每组执行独立性检查
3. 通过检查的任务组使用 `run_in_background: true` 并行分派
4. 使用 `TaskOutput` 等待所有任务完成
5. **冲突检测**：并行任务全部完成后，运行全量测试确认无冲突

**降级策略**：

- 独立性检查不通过 → 回退为顺序执行
- 并行执行后冲突检测失败 → 回滚并改为顺序执行
````

---

## 实施顺序

> 已根据审查结论调整批次顺序。#3 暂缓，#7 提前，#8 推迟至状态模型重构后。

**第一批 v3.4.0（核心纪律）** ✅ 已完成：

1. 验证铁律 — 最高 ROI，直接防止虚假完成
2. 设计审批硬门控 — 防止需求理解偏差传播

**第二批 v3.5.0（质量提升）** ✅ 已完成：

3. 任务粒度标准 — 步骤内化到 requirement 字段（方案 B）
4. 根因追溯纪律 — 提升 debug 效率
5. 双阶段任务审查 — 早期发现规格偏差（改为只读检查）
7. 审查反馈技术验证 — 提升代码审查质量

**第三批 v3.6.0（体系完善）** ✅ 已完成：

6. 合理化借口表 — 强化Brief的防绕过能力（放入 references）
8. 并行代理独立性验证 — 渐进式三阶段（状态模型 → 独立性检查 → 并行执行器）

---

## 版本规划

- v3.4.0: 全部 8 项已合并实施
