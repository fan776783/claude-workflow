---
name: analyze
description: "双模型技术分析（Codex + Gemini 并行），交叉验证后综合见解。触发条件：用户调用 /analyze，或请求架构分析、性能分析、需求拆解、代码探索、依赖审计等分析类任务。此命令仅分析，不产生代码变更。"
---

# 双模型智能分析

## 用法

`/analyze <QUESTION_OR_TASK>`

此命令触发双模型分析，**不产生代码变更**。

## 角色

**分析协调员**，编排多模型研究：
1. **Auggie** — 代码库上下文检索
2. **Codex** — 后端/逻辑/架构分析
3. **Gemini** — 前端/UI/UX 分析
4. **Claude (Self)** — 综合洞察

## 流程

### Step 1: 上下文检索 + 场景识别

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 理解相关代码
2. 识别关键文件、模式和架构
3. 根据用户输入识别分析重点（详见 [references/scenario-router.md](references/scenario-router.md)）

### Step 2: 并行分析

**使用 `run_in_background: true` 并行调用**，根据场景调整分析侧重：

```bash
# Codex 分析（后台执行）
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/analyzer.md

<TASK>
Analyze: <用户问题>

Context:
<从 Step 1 获取的相关代码和架构信息>

Focus: <根据场景识别结果调整，如"后端性能问题"或"安全漏洞">
</TASK>

OUTPUT: Detailed technical analysis with recommendations.
EOF
```

```bash
# Gemini 分析（后台执行）
codeagent-wrapper --backend gemini - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/analyzer.md

<TASK>
Analyze: <用户问题>

Context:
<从 Step 1 获取的相关代码和设计信息>

Focus: <根据场景识别结果调整，如"前端性能问题"或"组件结构">
</TASK>

OUTPUT: Detailed design analysis with recommendations.
EOF
```

**降级策略**：模型不可用时自动降级为单模型分析。

### Step 3: 交叉验证

使用 `TaskOutput` 获取结果：
1. 比较两个模型的视角
2. 识别共识和分歧点
3. 客观评估权衡取舍

### Step 4: 综合输出

整合两个视角，生成统一分析报告。

## 输出格式

```markdown
# 分析报告

## 分析目标
<用户输入>

## 上下文概览
<相关代码库元素>

## Codex 视角（技术/逻辑）
<后端架构、性能、安全性分析>

## Gemini 视角（UI/UX）
<前端设计、用户体验分析>

## 综合洞察
<整合两个视角的关键发现和权衡>

## 建议
<可操作的下一步>
```

## 注意

- **必须使用 `run_in_background: true` 实现并行执行**
- 使用 HEREDOC 语法 (`<<'EOF'`) 避免 shell 转义问题
- Codex 擅长后端/逻辑，Gemini 擅长前端/设计
