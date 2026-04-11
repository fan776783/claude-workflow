# Plan Self-Review 检查项

> Plan 生成后立即执行。只检查**无需执行即可判断**的内容（语法、格式、覆盖率）。
> 语义正确性验证推迟到执行阶段的 Verification Iron Law 和质量关卡。
> 发现问题直接修复，无需重审。

## 必检项

### 1. 需求覆盖

逐条检查 Spec 的 in_scope 需求，确认每条都有对应 task。发现缺失立即补充 task。

### 2. PRD Coverage Drift

检查 `prd-spec-coverage.json` 中 partial/uncovered 段落是否在 Plan 的 task 中有落点（通过 spec_ref 匹配）。未覆盖的段落需标注警告。

### 3. Placeholder 扫描

搜索以下禁止内容并修复：
- "TBD"、"TODO"、"implement later"、"fill in details"
- "Add appropriate error handling" / "add validation"
- "Write tests for the above"（未提供实际测试代码）
- "Similar to Task N"（必须重复代码，读者可能乱序阅读）
- 描述"做什么"但不展示"怎么做"的步骤（代码步骤必须有代码块）

### 4. 类型一致性

检查跨 task 的类型名、函数名、属性名是否一致。例如 Task 3 用 `clearLayers()` 但 Task 7 用 `clearFullLayers()` = bug。

### 5. 命令语法 + 路径存在性

- 验证命令格式合理性（括号匹配、管道符使用）
- 引用的文件路径是否在 File Structure 中声明
- **不验证**命令执行后是否通过，语义验证在执行阶段完成

### 6. Discussion Drift Check

若有 `discussion-artifact.json`：
- `selectedApproach` 存在 → 验证 Spec Architecture 章节是否反映该方案
- `unresolvedDependencies` 存在 → 验证 Spec Scope 对应需求标记为 `blocked`
- **偏差 → 回退 Spec 修订，不在 Plan 中补任务**

### 7. Pattern 保真

- `Patterns to Mirror` 中引用的每个源文件是否真实存在
- `keySnippet` 中引用的符号是否在源文件中能找到
- 不存在的引用标记为 unverified 或尝试重新定位

### 8. 零上下文可执行性

- 每个 task 是否有明确的文件路径（而非相对描述）
- 每个代码步骤是否有完整代码块
- 一个没有项目上下文的工程师是否能按 plan 直接执行，无需猜测
