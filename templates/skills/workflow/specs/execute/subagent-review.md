# 子 Agent 两阶段审查

## 目的

在满足执行阶段的审查触发条件后，通过独立的子 Agent 执行两阶段审查：先验证代码是否匹配 spec（Spec 合规），再验证代码质量（代码质量）。

> 借鉴 superpowers 的 subagent-driven-development 模式：Fresh subagent per review + 隔离上下文 = 高质量审查。

## 审查流程

```
Task 完成 → Spec 合规审查（子 Agent）→ 通过？ → 代码质量审查（子 Agent）→ 通过？ → 下一 Task
                    ↓ 不通过                              ↓ 不通过
               实现者修复 → 重新审查                  实现者修复 → 重新审查
```

**关键规则：**
- Spec 合规审查必须先通过，才能进入代码质量审查
- 审查发现问题 → 实现者修复 → 审查者重新审查，直到通过
- 不要跳过审查循环

## 阶段 1：Spec 合规审查

### 触发时机

仅在以下条件之一满足时触发完整两阶段审查：
1. 当前 task 的 `actions` 含 `quality_review`
2. 当前 task 是 plan 中的最后一个 task（执行全量完成审查时）

> 每连续完成 3 个常规 task 触发的是**轻量合规检查**，不是完整两阶段审查。详见 `references/execution-checklist.md`。

### 子 Agent Prompt

```markdown
你是一个 Spec 合规性审查员。你的唯一任务是验证实现代码是否匹配 spec 需求。

## 输入

**Spec 文件路径**: {specPath}
**本次改动范围**: {changedFiles 或 git diff}
**对应的 Plan Task**: {taskDescription}
**Spec Section Ref**: {specSectionRef}

## 审查标准

| 类别 | 检查内容 |
|------|---------|
| **需求覆盖** | spec 中本 task 对应的每个需求是否都有代码实现 |
| **行为匹配** | 代码实际行为是否与 spec 描述的用户行为一致 |
| **约束遵循** | spec Constraints 章节中的约束是否被正确实现 |
| **范围控制** | 是否有超出 spec 范围的额外实现（over-building） |
| **验收对齐** | 实现是否满足 spec Acceptance Criteria 章节的验收条件 |
| **页面分层** | 单文件（如 App.tsx）是否承载了过多独立功能模块 |
| **路由结构** | spec 中规划的多页面是否实现了路由/导航，而非全塞进一个页面 |

## 校准规则

**只标记会在实际使用中造成问题的偏差。**
- 不匹配 spec = 必须修复
- 超出 spec 但有价值 = 标记为建议
- 超出 spec 且无价值 = 建议删除
- 风格偏好 = 不标记

**预期 false-positive 率 ~35%**（AI reviewer 的常见问题）。对每个 finding 验证：
1. 是否真的和 spec 不一致（检查实际代码）
2. 是否是信任边界混淆（内部数据当外部输入检查）
3. 是否忽略了代码注释中的设计意图

## 输出格式

**Status:** Compliant | Issues Found

**Issues (if any):**
- [文件:行号]: [偏差描述] — [为什么和 spec 不一致] — [建议修复方式]

**Recommendations (advisory, do not block approval):**
- [建议性改进]

**Spec Coverage Checklist:**
- [x] 需求 X 已实现 ✅
- [ ] 需求 Y 未实现 ❌ — [原因]
```

### 处理审查结果

```typescript
if (specReviewResult.status === 'Compliant') {
  // 进入阶段 2：代码质量审查
  proceedToCodeQualityReview();
} else {
  // 实现者修复
  for (const issue of specReviewResult.issues) {
    await fixIssue(issue);
  }
  // 重新提交 Spec 合规审查
  await rerunSpecComplianceReview();
}
```

## 阶段 2：代码质量审查

### 触发时机

Spec 合规审查通过（Status: Compliant）后立即触发。

### 子 Agent Prompt

```markdown
你是一个代码质量审查员。你的任务是审查代码的工程质量。

## 输入

**本次改动范围**: {changedFiles 或 git diff}
**项目上下文**: {projectConfig — 技术栈、框架、约定}

## 审查标准

| 类别 | 检查内容 |
|------|---------|
| **代码结构** | 函数粒度、文件职责清晰度、模块边界 |
| **命名与可读性** | 变量/函数/类型命名是否清晰且一致 |
| **错误处理** | 异常捕获、边界条件、空值处理 |
| **测试质量** | 测试覆盖充分性、边界用例、测试可读性 |
| **安全性** | 输入验证、权限检查、敏感数据处理 |
| **性能** | 明显的性能问题（N+1、内存泄漏、不必要的重计算） |
| **DRY / YAGNI** | 重复代码、不必要的抽象 |
| **组件复杂度** | 单组件 JSX 是否超过 200 行？是否需要拆分为子组件？ |
| **功能堆砌检测** | 主入口文件是否包含 3+ 个独立功能面板？是否缺少路由？ |

## 校准规则

**只标记 Important 或 Critical 级别的问题。**
- **Critical**: 会导致 bug、安全漏洞或数据丢失
- **Important**: 会影响可维护性或导致未来 bug
- **Minor**: 风格偏好 — **不要标记**

**Approve unless there are Critical or Important issues.**

## 输出格式

**Status:** Approved | Issues Found

**Strengths:**
- [做得好的地方]

**Issues (if any):**
- [Critical/Important] [文件:行号]: [问题描述] — [建议修复]

**Recommendations (advisory, do not block approval):**
- [Minor 级别建议]
```

### 处理审查结果

```typescript
if (codeQualityResult.status === 'Approved') {
  // 标记 task 完成，进入下一个 task
  markTaskComplete(currentTask);
} else {
  // 实现者修复
  for (const issue of codeQualityResult.issues) {
    await fixIssue(issue);
  }
  // 重新提交代码质量审查（不需要重新走 Spec 合规）
  await rerunCodeQualityReview();
}
```

## 全量完成审查

所有 plan task 完成后，执行一次全量审查：

```markdown
你是最终代码审查员。验证整个实现是否完整、一致且可合并。

**Spec 文件**: {specPath}
**Plan 文件**: {planPath}
**所有改动文件**: {allChangedFiles}

## 检查内容
1. 所有 plan task 是否都已实现
2. 跨 task 的集成是否正确
3. 是否有遗漏的 spec 需求
4. 整体代码质量是否达到合并标准
5. 页面结构是否与 spec 中的信息架构一致
6. 首次使用流程是否已实现（如 spec 中有描述）
7. 是否存在功能堆砌问题（主页面 > 4 个独立模块）

## 输出
**Status:** Ready to Merge | Issues Found
**Missing Requirements:** [如果有]
**Integration Issues:** [如果有]
```

## 平台适配

### Claude Code / Cursor
使用 `Task` 工具分派审查子 Agent，提供完整 prompt 和上下文。

### Codex
映射到 `spawn_agent` / `wait` / `close_agent`。

### 不支持子 Agent 的平台（降级执行 — 具体步骤）

当不支持子 Agent 时，**不得跳过审查**。按以下步骤在当前会话中执行：

**阶段 1：Spec 合规审查（降级）**

1. 输出分隔符：`━━━ 切换角色：Spec 合规审查员 ━━━`
2. 读取 spec 文件中当前 task 对应的章节（`spec_ref` 字段指向的章节）
3. 读取当前 task 变更的文件内容（或 `git diff` 输出）
4. 逐条检查 spec 需求是否被实现覆盖：
   - 需求覆盖（spec 需求有对应实现）
   - 行为匹配（代码行为与 spec 描述一致）
   - 约束遵循（Constraints 章节约束被正确实现）
   - 验收对齐（Acceptance Criteria 满足）
5. 输出审查结果：
   ```
   **Status:** Compliant / Issues Found
   **Issues:** [如有，列出偏差]
   **Coverage:** [x/y 需求已覆盖]
   ```
6. 输出分隔符：`━━━ 退出 Spec 合规审查员角色 ━━━`

**阶段 2：代码质量审查（降级）**

> 仅当阶段 1 Status = Compliant 时执行。

1. 输出分隔符：`━━━ 切换角色：代码质量审查员 ━━━`
2. 检查当前 task 变更文件的：
   - 代码结构（函数粒度、职责清晰度）
   - 错误处理（异常捕获、空值处理）
   - 安全性（输入验证）
   - DRY/YAGNI（重复代码、不必要抽象）
3. 只标记 **Critical** 和 **Important** 级别问题
4. 输出审查结果：
   ```
   **Status:** Approved / Issues Found
   **Issues:** [如有，列出问题及严重级别]
   ```
5. 输出分隔符：`━━━ 退出代码质量审查员角色 ━━━`

> ⚠️ 即使降级执行，也 **不可跳过审查**。角色切换标记是强制的，用于审计追溯。

## 轻量合规检查（每 3 个常规 task 触发）

当连续执行 3 个常规 task（不含 `quality_review` action）后未执行审查时，触发轻量版合规检查：

1. 读取最近 3 个 task 对应的 spec 章节
2. 读取这 3 个 task 修改的文件
3. 快速检查：spec 需求是否有对应代码实现
4. 输出结果：`轻量合规检查：通过 / N 项偏差`
5. 偏差列表（如有）写入 `workflow-state.json` 的 `quality_gates` 字段（旧字段 `execution_reviews` 迁移规则参见 `references/state-machine.md` → `execution_reviews` 迁移策略）

> 轻量检查不阻塞执行。发现偏差时输出警告，继续下一个 task。

## 强制规则

- 每个质量关卡 task（`actions` 含 `quality_review`）完成后必须执行完整两阶段审查，不可跳过
- 每连续 3 个常规 task 未审查时，必须执行轻量合规检查
- Spec 合规审查必须先通过，才能进入代码质量审查
- 审查发现的 Critical/Important 问题必须修复后重新审查
- 不接受"接近合规"（almost compliant）— 不匹配 spec = 未通过
- 全量完成审查在所有 task 完成后执行一次
- 不支持子 Agent 时必须使用降级执行步骤，不得跳过审查
