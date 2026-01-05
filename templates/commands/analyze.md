---
description: 双模型技术分析（Codex + Gemini 并行），交叉验证后综合见解
allowed-tools: mcp__auggie-mcp__codebase-retrieval, Bash(codeagent-wrapper *), Read(*), Grep(*), Glob(*), TaskOutput
examples:
  - /analyze "这个架构设计合理吗"
  - /analyze "性能瓶颈在哪里"
  - /analyze "这个需求怎么拆解"
---

# 双模型智能分析

## Usage

`/analyze <QUESTION_OR_TASK>`

## Context

- 分析任务: $ARGUMENTS
- 此命令触发双模型分析，**不产生代码变更**
- Codex 和 Gemini 提供不同视角进行交叉验证

## Your Role

你是**分析协调员**，负责编排多模型研究：
1. **Auggie** – 代码库上下文检索
2. **Codex** – 后端/逻辑/架构分析
3. **Gemini** – 前端/UI/UX 分析
4. **Claude (Self)** – 综合洞察

## Process

### Step 1: 上下文检索

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 理解相关代码
2. 识别关键文件、模式和架构

### Step 2: 并行分析

**使用 `run_in_background: true` 并行调用 Codex 和 Gemini**

在单个消息中同时发送两个 Bash 工具调用：

```bash
# Codex 分析（后台执行）
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/analyzer.md

<TASK>
Analyze: <用户问题>

Context:
<从 Step 1 获取的相关代码和架构信息>
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
</TASK>

OUTPUT: Detailed design analysis with recommendations.
EOF
```

**说明**:
- 使用 `ROLE_FILE:` 指定提示词文件路径，让子进程自己读取，避免消耗主会话 token
- 如果 ROLE_FILE 不存在，子进程会使用 TASK 中的上下文作为分析指引
- 降级策略：模型不可用时自动降级为单模型分析

### Step 3: 交叉验证

使用 `TaskOutput` 获取两个任务的结果，然后：
1. 比较两个模型的视角
2. 识别共识和分歧点
3. 客观评估权衡取舍

### Step 4: 综合输出

整合两个视角，生成统一分析报告。

## Output Format

```markdown
# 分析报告

## 分析目标
<用户输入的描述>

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

## Notes

- 此命令仅用于分析，**不产生代码变更**
- **必须使用 `run_in_background: true` 实现并行执行**
- Codex 擅长后端/逻辑，Gemini 擅长前端/设计
- 使用 HEREDOC 语法 (`<<'EOF'`) 避免 shell 转义问题
