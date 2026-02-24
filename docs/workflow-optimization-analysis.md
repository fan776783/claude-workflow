# Workflow Skill 文件分析报告

## 📊 文件大小统计

| 文件 | 行数 | 问题 |
|------|------|------|
| start.md | 2,492 | ⚠️ 严重超标（推荐 <500 行） |
| execute.md | 2,064 | ⚠️ 严重超标 |
| status.md | 677 | ⚠️ 超标 |
| delta.md | 550 | ⚠️ 接近上限 |
| state-machine.md | 350 | ✅ 合理 |
| acceptance-checklist.md | 281 | ✅ 合理 |
| external-deps.md | 276 | ✅ 合理 |
| shared-utils.md | 272 | ✅ 合理 |
| archive.md | 247 | ✅ 合理 |
| SKILL.md | 128 | ✅ 合理 |

## 🔍 start.md 详细分析（2,492 行）

### 内容结构

1. **执行流程**（~300 行）
   - Step 0: 解析参数
   - Step 1: 项目配置检查
   - Step 2: 检测现有任务

2. **Phase 0: 代码分析**（~50 行）

3. **Phase 0.5: 需求结构化提取**（~60 行）

4. **Phase 0.6: 验证清单生成**（~70 行）

5. **Phase 1: 生成技术方案**（~200 行）
   - 包含完整的模板内联代码

6. **Phase 1.5: Intent Review**（~90 行）

7. **Hard Stop 1: 设计方案确认**（~100 行）

8. **Phase 2: 生成任务清单**（~150 行）
   - 包含完整的模板内联代码

9. **Hard Stop 2: 规划完成**（~30 行）

10. **Step 3: 创建工作流状态**（~200 行）

11. **辅助函数**（~1,300 行）⚠️
    - generateIntentSummary()
    - nextChangeId()
    - classifyTaskDependencies()
    - RequirementAnalysis 接口（~70 行）
    - extractStructuredRequirements()（~110 行）
    - renderRequirementDetailSections()（~120 行）
    - AcceptanceChecklist 接口（~90 行）
    - generateAcceptanceChecklist()（~400 行）⚠️
    - renderAcceptanceChecklist()（~220 行）⚠️
    - mapTaskToAcceptanceCriteria()（~100 行）
    - sanitize()
    - loadTemplate()
    - replaceVars()
    - determinePhase()
    - determineActions()
    - findLeverage()

### 冗余问题

1. **内联模板代码**（~200 行）
   - tech-design 模板内联在代码中
   - tasks 模板内联在代码中
   - 应该引用外部模板文件

2. **大型函数定义**（~800 行）
   - generateAcceptanceChecklist() 函数过长（~400 行）
   - renderAcceptanceChecklist() 函数过长（~220 行）
   - 应该拆分到独立文件

3. **接口定义**（~160 行）
   - RequirementAnalysis 接口（~70 行）
   - AcceptanceChecklist 接口（~90 行）
   - 应该移到 shared-utils.md 或独立的 types.md

4. **重复的辅助函数**
   - esc(), groupBy(), sanitize() 等通用函数
   - 应该统一到 shared-utils.md

## 🔍 execute.md 详细分析（2,064 行）

### 内容结构

1. **执行模式说明**（~50 行）
2. **共享工具函数**（~180 行）⚠️ 与 shared-utils.md 重复
3. **执行流程**（~600 行）
4. **动作执行函数**（~500 行）
5. **辅助函数**（~400 行）
6. **Retry 模式**（~100 行）
7. **Skip 模式**（~80 行）
8. **约束系统**（~150 行）

### 冗余问题

1. **共享工具函数重复**（~180 行）
   - resolveUnder(), extractStatusFromTitle(), getStatusEmoji() 等
   - 已经在 shared-utils.md 中定义
   - 应该删除，引用 shared-utils.md

2. **大型函数定义**
   - executeCodexReview() 过长（~150 行）
   - performZeroDecisionAudit() 过长（~100 行）
   - 应该拆分或移到独立文件

3. **约束系统代码**（~150 行）
   - 应该移到独立的 constraints.md 文件


## 💡 优化建议

### 优先级 1：拆分 start.md（2,492 → ~800 行）

#### 1.1 提取验证清单相关代码到独立文件

**新建文件**：`references/acceptance-checklist-generator.md`（~800 行）

**移动内容**：
- `RequirementAnalysis` 接口定义（~70 行）
- `AcceptanceChecklist` 接口定义（~90 行）
- `extractStructuredRequirements()` 函数（~110 行）
- `renderRequirementDetailSections()` 函数（~120 行）
- `generateAcceptanceChecklist()` 函数（~400 行）
- `renderAcceptanceChecklist()` 函数（~220 行）
- `mapTaskToAcceptanceCriteria()` 函数（~100 行）
- 相关辅助函数：`esc()`, `groupBy()`（~20 行）

**在 start.md 中引用**：
```markdown
### Phase 0.6：生成验证清单

> 详细实现请参考 [acceptance-checklist-generator.md](acceptance-checklist-generator.md)

```typescript
// 调用验证清单生成函数（实现见 acceptance-checklist-generator.md）
acceptanceChecklist = generateAcceptanceChecklist(requirementAnalysis, taskName);
```

#### 1.2 提取模板渲染代码到独立文件

**新建文件**：`references/template-renderer.md`（~200 行）

**移动内容**：
- 内联的 tech-design 模板代码（~100 行）
- 内联的 tasks 模板代码（~100 行）
- `loadTemplate()` 函数
- `replaceVars()` 函数

**在 start.md 中引用**：
```markdown
### Phase 1：生成技术方案

> 模板渲染实现请参考 [template-renderer.md](template-renderer.md)

```typescript
const techDesignContent = renderTechDesignTemplate({...});
```

#### 1.3 提取任务分类逻辑到独立文件

**新建文件**：`references/task-classifier.md`（~150 行）

**移动内容**：
- `determinePhase()` 函数（~40 行）
- `determineActions()` 函数（~15 行）
- `findLeverage()` 函数（~20 行）
- `classifyTaskDependencies()` 函数（~40 行）
- 相关常量和配置（~35 行）

#### 1.4 提取 Intent 相关代码到独立文件

**新建文件**：`references/intent-generator.md`（~100 行）

**移动内容**：
- `generateIntentSummary()` 函数（~60 行）
- `nextChangeId()` 函数（~10 行）
- Intent 相关接口定义（~30 行）

**优化后的 start.md 结构**（~800 行）：
```
1. 执行流程说明（~300 行）
2. Phase 0-2 主流程（~400 行）
3. 简化的辅助函数（~100 行）
   - 仅保留 sanitize() 等核心函数
   - 其他函数引用独立文件
```

### 优先级 2：拆分 execute.md（2,064 → ~1,000 行）

#### 2.1 删除重复的共享工具函数

**删除内容**（~180 行）：
- `resolveUnder()`
- `extractStatusFromTitle()`
- `getStatusEmoji()`
- `addUnique()`
- `escapeRegExp()`
- `parseQualityGate()`
- `estimateContextTokens()`
- `calculateDynamicMaxTasks()`
- `detectTaskComplexity()`
- `generateContextBar()`

**替换为引用**：
```markdown
## 共享工具函数

> 详见 [shared-utils.md](shared-utils.md)

本文档使用以下共享函数：
- `resolveUnder()` - 路径安全校验
- `extractStatusFromTitle()` - 状态提取
- `getStatusEmoji()` - 状态 Emoji
- ...
```

#### 2.2 提取约束系统到独立文件

**新建文件**：`references/constraint-system.md`（~200 行）

**移动内容**：
- `Constraint` 接口定义（~20 行）
- `ConstraintSet` 接口定义（~10 行）
- `extractConstraints()` 函数（~20 行）
- `parseStructuredConstraints()` 函数（~20 行）
- `verifyConstraint()` 函数（~30 行）
- `verifyHardConstraints()` 函数（~30 行）
- `mergeConstraints()` 函数（~70 行）

#### 2.3 提取 Zero-Decision 审计到独立文件

**新建文件**：`references/zero-decision-audit.md`（~150 行）

**移动内容**：
- `ZeroDecisionAudit` 接口定义（~10 行）
- `ANTI_PATTERNS` 常量（~30 行）
- `performZeroDecisionAudit()` 函数（~80 行）
- `formatAuditReport()` 函数（~30 行）

#### 2.4 提取动作执行函数到独立文件

**新建文件**：`references/action-executors.md`（~600 行）

**移动内容**：
- `executeCreateFile()` 函数（~30 行）
- `executeEditFile()` 函数（~10 行）
- `executeRunTests()` 函数（~50 行）
- `executeCodexReview()` 函数（~150 行）
- `executeGitCommit()` 函数（~60 行）
- 相关辅助函数（~300 行）

**优化后的 execute.md 结构**（~1,000 行）：
```
1. 执行模式说明（~50 行）
2. 执行流程（~600 行）
3. Retry/Skip 模式（~180 行）
4. 简化的辅助函数（~170 行）
   - 仅保留核心流程函数
   - 其他函数引用独立文件
```

### 优先级 3：优化 status.md（677 → ~400 行）

#### 3.1 提取状态渲染函数到独立文件

**新建文件**：`references/status-renderer.md`（~200 行）

**移动内容**：
- 复杂的状态格式化函数
- 进度条渲染函数
- 统计信息计算函数

### 优先级 4：优化 delta.md（550 → ~350 行）

#### 4.1 提取 Delta 处理器到独立文件

**新建文件**：`references/delta-handlers.md`（~200 行）

**移动内容**：
- PRD 更新处理器
- API 变更处理器
- YTT 同步处理器

## 📋 优化后的文件结构

```
templates/skills/workflow/
├── SKILL.md (128 行) ✅
└── references/
    ├── start.md (800 行) ✅ 从 2,492 行优化
    ├── execute.md (1,000 行) ✅ 从 2,064 行优化
    ├── status.md (400 行) ✅ 从 677 行优化
    ├── delta.md (350 行) ✅ 从 550 行优化
    ├── state-machine.md (350 行) ✅
    ├── acceptance-checklist.md (281 行) ✅
    ├── external-deps.md (276 行) ✅
    ├── shared-utils.md (272 行) ✅
    ├── archive.md (247 行) ✅
    │
    ├── acceptance-checklist-generator.md (800 行) 🆕
    ├── template-renderer.md (200 行) 🆕
    ├── task-classifier.md (150 行) 🆕
    ├── intent-generator.md (100 行) 🆕
    ├── constraint-system.md (200 行) 🆕
    ├── zero-decision-audit.md (150 行) 🆕
    ├── action-executors.md (600 行) 🆕
    ├── status-renderer.md (200 行) 🆕
    └── delta-handlers.md (200 行) 🆕
```

## 📊 优化效果对比

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 超标文件数 | 4 个 | 0 个 | ✅ 100% |
| start.md 行数 | 2,492 | 800 | ✅ -68% |
| execute.md 行数 | 2,064 | 1,000 | ✅ -52% |
| status.md 行数 | 677 | 400 | ✅ -41% |
| delta.md 行数 | 550 | 350 | ✅ -36% |
| 总文件数 | 10 | 19 | +9 |
| 平均文件大小 | 703 行 | 342 行 | ✅ -51% |

## 🎯 实施步骤

### Step 1: 提取验证清单生成器（最大收益）

1. 创建 `acceptance-checklist-generator.md`
2. 移动相关代码（~800 行）
3. 更新 start.md 引用
4. 测试验证

**预期收益**：start.md 从 2,492 → 1,692 行（-32%）

### Step 2: 提取模板渲染器

1. 创建 `template-renderer.md`
2. 移动模板代码（~200 行）
3. 更新 start.md 引用

**预期收益**：start.md 从 1,692 → 1,492 行（-12%）

### Step 3: 提取任务分类器和 Intent 生成器

1. 创建 `task-classifier.md` 和 `intent-generator.md`
2. 移动相关代码（~250 行）
3. 更新 start.md 引用

**预期收益**：start.md 从 1,492 → 1,242 行（-17%）

### Step 4: 清理 start.md 中的其他辅助函数

1. 移动通用函数到 shared-utils.md
2. 保留核心流程代码

**预期收益**：start.md 从 1,242 → 800 行（-36%）

### Step 5: 优化 execute.md

1. 删除重复的共享工具函数（-180 行）
2. 提取约束系统（-200 行）
3. 提取 Zero-Decision 审计（-150 行）
4. 提取动作执行函数（-600 行）

**预期收益**：execute.md 从 2,064 → 1,000 行（-52%）

### Step 6: 优化 status.md 和 delta.md

1. 提取状态渲染器（-200 行）
2. 提取 Delta 处理器（-200 行）

**预期收益**：
- status.md 从 677 → 400 行（-41%）
- delta.md 从 550 → 350 行（-36%）

## ⚠️ 注意事项

1. **保持引用清晰**
   - 在主文件中明确说明引用的文件
   - 提供简短的功能说明

2. **避免循环引用**
   - 确保文件依赖关系是单向的
   - 共享工具函数统一放在 shared-utils.md

3. **测试完整性**
   - 每次拆分后测试功能是否正常
   - 确保所有引用都正确

4. **文档同步更新**
   - 更新 SKILL.md 中的 References 表格
   - 更新相关文档中的引用路径

## 📝 总结

workflow skill 的主要问题是：

1. **start.md 和 execute.md 过大**（2,492 和 2,064 行）
2. **大量辅助函数内联**（应该拆分到独立文件）
3. **共享工具函数重复**（应该统一引用）
4. **模板代码内联**（应该引用外部模板）

通过以上优化，可以将：
- start.md 从 2,492 行减少到 800 行（-68%）
- execute.md 从 2,064 行减少到 1,000 行（-52%）
- 所有文件都控制在 500 行以下（除 execute.md 稍大但可接受）

这样可以显著提高代码的可维护性和可读性，同时减少上下文窗口的占用。

