---
name: debug
description: "Bug 修复流程：问题定位 → 影响分析 → 确认方案 → 修复 → 模型审查。触发条件：用户调用 /debug，或描述 Bug 修复、问题排查、错误诊断等场景。修复完成后根据问题类型路由到 Codex（后端）或 Gemini（前端）进行单模型审查。"
---

# 调试与修复

从问题定位到修复验证的完整流程，修复后按场景路由单模型审查。

## 用法

`/debug <问题描述>`

## 执行流程

```
Phase 1: 检索上下文 + 问题分析
Phase 2: 影响分析 + 确认方案（Hard Stop）
Phase 3: 修复实施 + 验证方案
Phase 4: 模型审查（Codex 或 Gemini 二选一）
```

## Phase 1: 检索上下文 + 问题分析

**1.1 检索上下文**：

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 检索相关代码
2. 收集错误日志、堆栈信息、复现步骤

**1.2 识别问题类型**：

| 关键词 | 类型 | 审查模型 |
|--------|------|----------|
| 白屏、渲染、样式、组件、状态 | 前端 | Gemini |
| API、数据库、500、超时、权限 | 后端 | Codex |
| 混合特征 | 全栈 | Codex（优先后端视角） |

**1.3 问题分析**：

当前模型直接分析：
1. 根本原因定位
2. 代码逻辑、数据流、异步问题
3. 修复方案（至少 2 个）
4. 推荐方案及理由

## Phase 2: 影响分析 + 确认方案（Hard Stop）

**2.1 影响分析**：

详见 [references/impact-analysis.md](references/impact-analysis.md) — 修复前必须完成。

**2.2 展示诊断结果并等待用户确认**：

```
## 诊断结果

### 问题分析
**根本原因**：<具体诊断>
**问题类型**：前端 / 后端 / 全栈

### 修复方案
**推荐方案**：<方案描述>
**备选方案**：<方案描述>

### 影响分析
**风险等级**：高/中/低
**直接影响**：<文件/函数>
**测试覆盖**：<现有测试 / 需补充>

## 是否继续执行此修复方案？(Y/N)
```

**立即终止，禁止继续执行任何操作。**

## Phase 3: 修复实施 + 验证方案

用户确认后执行：
- 遵循推荐方案，最小化改动
- 处理边界条件

修复完成后，输出验证方案：

```
## 验证方案

### 复现验证
- 复现步骤：<原始 Bug 的复现路径>
- 预期结果：<修复后的正确行为>

### 回归检查
- 相关功能：<需验证未被破坏的功能点>
- 现有测试：<运行命令，如 npm test -- --grep "xxx">

### 边界场景
- <场景 1>：<预期行为>
- <场景 2>：<预期行为>
```

如有可执行的测试命令，直接运行验证；无自动化测试时，列出手动验证步骤供用户确认。

## Phase 4: 模型审查

修复完成后，根据 Phase 1 识别的问题类型选择**一个**模型审查：

**路由规则**：
- 前端问题 → Gemini 审查
- 后端问题 → Codex 审查
- 全栈问题 → Codex 审查（后端逻辑优先）

```bash
# Codex 审查（后端/逻辑问题）
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/reviewer.md

<TASK>
Review bug fix:
**Bug**: {{问题描述}}
**Root cause**: {{根本原因}}
**Fix**: {{方案摘要}}

## Diff
{{git diff 内容}}

Evaluate: root cause resolution, regression risk, edge cases, code quality
</TASK>

OUTPUT FORMAT: Review comments only, sort by P0→P3
EOF
```

```bash
# Gemini 审查（前端/UI 问题）
codeagent-wrapper --backend gemini - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/reviewer.md

<TASK>
Review bug fix:
**Bug**: {{问题描述}}
**Root cause**: {{根本原因}}
**Fix**: {{方案摘要}}

## Diff
{{git diff 内容}}

Evaluate: UI consistency, user experience, component impact, accessibility
</TASK>

OUTPUT FORMAT: Review comments only, sort by P0→P3
EOF
```

**降级策略**：模型不可用时由当前模型直接审查。

综合审查意见，确认问题解决。

## 关键原则

1. **先验证，不假设** — 所有假设需证据支持
2. **分析影响** — 修复前评估回归风险
3. **用户确认** — 修复前必须获得确认
4. **最小改动** — 优先局部修复，避免大范围重构
5. **按需审查** — 根据问题类型路由到对应专家模型
