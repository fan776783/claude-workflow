# Memory Helper Functions 实施总结

## 背景

基于之前对 Codex 两个建议的分析，决定对 Suggestion 2（步骤级别的 hooks）进行 **部分采纳**：
- ❌ **不实施**：复杂的 hook 框架
- ✅ **实施**：轻量级的 helper functions + 文档约定

## 实施内容

### 1. 核心 Helper Functions

在 `workflow-execute.md` 中新增了以下 helper functions：

| Helper | 用途 | 主要调用场景 |
|--------|------|------------|
| `updateRequirements()` | 更新需求理解 | analyze_requirements, ask_user |
| `addDecision()` | 添加关键决策 | ask_user, codex_review_design, optimize_design |
| `addIssue()` | 添加发现的问题 | explore_code, codex_review_design, codex_review_code |
| `updateUserPreferences()` | 更新用户偏好 | ask_user, explore_code |
| `updateDomainContext()` | 更新领域上下文 | analyze_requirements, explore_code |
| `resolveIssue()` | 解决已记录的问题 | optimize_design, executeCode |

### 2. Action 文档更新

为以下 action 添加了 "⭐ Memory 更新指南" 注释：

#### analyze_requirements
- 何时调用 `updateRequirements()`
- 何时调用 `updateDomainContext()`
- 包含实际使用示例

#### ask_user
- 记录用户决策 → `addDecision()`
- 更新用户偏好 → `updateUserPreferences()`
- 补充需求细节 → `updateRequirements()`
- 包含 JWT 认证选择的示例

#### explore_code
- 发现问题 → `addIssue()`
- 识别架构约束 → `updateDomainContext()`
- 包含发现 User 表缺少字段的示例

#### codex_review_design
- 从审查结果中提取问题 → `addIssue()`
- 记录优化建议 → `addDecision()`
- 包含租户权限验证问题的示例

#### codex_review_code
- 记录代码质量问题 → `addIssue()`
- 包含权限绕过和错误处理问题的示例

### 3. 使用约定表

添加了清晰的使用约定表，说明：
- 每个 action 应该调用哪些 helpers
- 调用的具体说明
- 明确这些是**可选工具**，非强制要求

## 设计原则

1. **轻量级**
   - 不引入复杂的 hook 系统
   - helper functions 仅提供便捷的更新方法
   - 保持代码简洁性

2. **可选性**
   - helpers 是辅助工具，不是强制要求
   - 只在有明确信息需要保存时调用
   - 避免为了调用而调用

3. **文档驱动**
   - 通过注释和示例指导使用
   - 清晰的条件判断逻辑（"如果 XXX，则调用 YYY"）
   - 真实的使用场景示例

## 与之前功能的配合

### 上下文恢复（Step 1.5）
- Helper functions 更新的数据会在上下文恢复时显示
- 确保 `requirements`, `userPreferences`, `decisions`, `issues` 等字段的完整性

### 智能上下文清理（Step 2.5）
- 清理上下文后，通过 helper 更新的信息能够完整恢复
- 避免清理导致的信息丢失

## v1 vs v2 功能对比

| 功能 | v1 实施 | v2 计划 |
|------|---------|---------|
| Memory helper functions | ✅ 已实施 | - |
| Action 文档指南 | ✅ 已实施 | - |
| 使用示例 | ✅ 已实施 | - |
| Assumptions/Risks 字段 | ❌ 延迟 | 如需求明确则实施 |
| 正式 Hook 框架 | ❌ 不实施 | 如出现复杂场景再评估 |
| 自动化测试 | ❌ 延迟 | v2 |

## 文件修改清单

- ✅ `templates/commands/workflow-execute.md`
  - 新增 "🧰 Memory 更新 Helper Functions" 部分（6 个 helpers）
  - 新增 "使用约定" 表格
  - 更新 5 个 action 函数的文档注释

## 使用效果预期

### Before（未实施时）
- ❌ 需求分析后信息散落在对话中
- ❌ 上下文清理后难以恢复关键决策
- ❌ 没有统一的更新方式

### After（实施后）
- ✅ 关键信息结构化保存在 memory
- ✅ 上下文恢复时完整展示
- ✅ 统一的 helper functions，降低心智负担
- ✅ 清晰的文档指导，知道何时调用

## 总结

通过轻量级的 helper functions 和文档约定，而非复杂的 hook 框架：
- ✅ 达到了保持信息完整性的目标
- ✅ 保持了代码的简洁性
- ✅ 降低了维护成本
- ✅ 提供了清晰的使用指导

这是 Suggestion 2 的**最佳平衡方案**，适合当前 v1 版本的需求。
