---
name: debug
description: "多模型调试（Codex 后端诊断 + Gemini 前端诊断），支持从问题定位到修复验证的完整 Bug 修复流程。触发条件：用户调用 /debug，或描述 Bug 修复、问题排查、错误诊断等场景。支持自动检测问题类型（前端/后端/全栈）并路由到对应诊断模型。"
---

# 多模型调试

双模型并行诊断（Codex 后端 + Gemini 前端），从问题定位到修复验证的完整流程。

## 用法

`/debug <问题描述>`

## 执行流程

```
Phase 1: 检索上下文
Phase 2: 并行诊断（Codex ∥ Gemini）
Phase 3: 整合假设 + 分析影响
Phase 4: 确认方案（Hard Stop）
Phase 5: 修复 + 审查
```

## Phase 1: 检索上下文

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 检索相关代码
2. 收集错误日志、堆栈信息、复现步骤
3. 识别问题类型（前端/后端/全栈）

**问题类型检测**：

| 关键词 | 类型 | 主要诊断模型 |
|--------|------|--------------|
| 白屏、渲染、样式、组件、状态 | 前端 | Gemini |
| API、数据库、500、超时、权限 | 后端 | Codex |
| 全栈、页面+接口、数据不同步 | 全栈 | 并行 |

## Phase 2: 并行诊断

**同时启动两个后台任务**（`run_in_background: true`），在单个消息中发送：

```bash
# Codex 后端诊断（后台执行）
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/debugger.md

<TASK>
诊断问题: {{问题描述}}

## 上下文
{{从 Phase 1 获取的相关代码}}

## 错误信息
{{错误日志、堆栈信息}}

分析要点:
1. 根本原因
2. 代码逻辑、数据流、异步问题
3. 修复方案（至少 2 个）
4. 推荐方案及理由
5. 影响范围
</TASK>

OUTPUT: Structured diagnostic report. No code modifications.
EOF
```

```bash
# Gemini 前端诊断（后台执行）
codeagent-wrapper --backend gemini - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/debugger.md

<TASK>
诊断问题: {{问题描述}}

## 上下文
{{从 Phase 1 获取的相关代码}}

## 错误信息
{{错误日志、堆栈信息}}

分析要点:
1. UI 渲染、状态管理问题
2. 组件生命周期、事件处理问题
3. 修复方案（至少 2 个）
4. 推荐方案及理由
5. 影响范围
</TASK>

OUTPUT: Structured diagnostic report. No code modifications.
EOF
```

**降级策略**：模型不可用时自动降级为单模型或 Claude 直接分析。

## Phase 3: 整合假设 + 分析影响

使用 `TaskOutput` 收集两个模型的诊断报告。

**3.1 交叉验证**：
1. 一致观点（强信号）
2. 分歧点（需权衡）
3. 互补见解
4. Top 假设排序

**3.2 分析影响**：

详见 [references/impact-analysis.md](references/impact-analysis.md) — 修复前必须完成。

## Phase 4: 确认方案（Hard Stop）

**展示诊断结果并等待用户确认**：

```
## 诊断结果

### Codex 分析（后端视角）
<摘要>

### Gemini 分析（前端视角）
<摘要>

### 综合诊断
**最可能原因**：<具体诊断>
**推荐修复方案**：<方案>

### 影响分析
**风险等级**：高/中/低
**直接影响**：<文件/函数>
**测试覆盖**：<现有测试 / 需补充>

## 是否继续执行此修复方案？(Y/N)
```

**立即终止，禁止继续执行任何操作。**

## Phase 5: 修复与审查

用户确认后执行。

**5.1 实施修复**：
- 遵循推荐方案，最小化改动
- 处理边界条件

**5.2 双模型审查**（`run_in_background: true`）：

```bash
# Codex 审查（后端/逻辑）
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/reviewer.md

<TASK>
审查修复代码：
**问题**: {{问题描述}}
**修复方案**: {{方案摘要}}

## Diff
{{git diff 内容}}

评估: 根因解决、回归风险、边界条件、代码质量
</TASK>

OUTPUT FORMAT: Review comments only, sort by P0→P3
EOF
```

```bash
# Gemini 审查（前端/UI）- 仅涉及前端时执行
codeagent-wrapper --backend gemini - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/reviewer.md

<TASK>
审查修复代码：
**问题**: {{问题描述}}
**修复方案**: {{方案摘要}}

## Diff
{{git diff 内容}}

评估: UI 一致性、用户体验、组件影响、可访问性
</TASK>

OUTPUT FORMAT: Review comments only, sort by P0→P3
EOF
```

**5.3** 综合审查意见，确认问题解决。

## 关键原则

1. **先验证，不假设** — 所有假设需证据支持
2. **并行诊断** — 充分利用双模型不同视角
3. **分析影响** — 修复前评估回归风险
4. **用户确认** — 修复前必须获得确认
5. **最小改动** — 优先局部修复，避免大范围重构
