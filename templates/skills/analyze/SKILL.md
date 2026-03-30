---
name: analyze
description: "Codex 技术分析 + Claude 自身前端分析，交叉验证后综合见解。触发条件：用户调用 /analyze，或请求架构分析、性能分析、需求拆解、代码探索、依赖审计等分析类任务。此命令仅分析，不产生代码变更。"
---

# 智能技术分析

## 用法

`/analyze <QUESTION_OR_TASK>`

此命令触发技术分析，**不产生代码变更**。

## 角色

**分析协调员**，编排多模型研究：
1. **Auggie** — 代码库上下文检索
2. **Codex** — 后端/逻辑/架构分析
3. **Claude (Self)** — 前端/UI/UX 分析 + 综合洞察

## 流程

### Step 1: 上下文检索 + 场景识别

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 理解相关代码
2. 识别关键文件、模式和架构
3. 根据用户输入识别分析重点（详见 [references/scenario-router.md](references/scenario-router.md)）

### Step 2: Codex 分析

**使用 `run_in_background: true` 调用**（**不设置** timeout），根据场景调整分析侧重：

按 `collaborating-with-codex` skill 调用：

```
PROMPT: "ROLE: Technical Analyst. CONSTRAINTS: READ-ONLY, output analysis report only. Analyze: <用户问题>. Context: <从 Step 1 获取的相关代码和架构信息>. Focus: <根据场景识别结果调整>. OUTPUT: Detailed technical analysis with recommendations."
```

**降级策略**：Codex 不可用时由当前模型独立分析。

### Step 3: Claude 自身分析 + 交叉验证

使用 `TaskOutput` 获取 Codex 结果后：
1. 当前模型从前端/UI/UX 视角补充分析
2. 对比 Codex 技术视角与自身分析
3. 识别共识和分歧点
4. 客观评估权衡取舍

### Step 4: 综合输出

整合 Codex 技术分析与当前模型前端视角，生成统一分析报告。

## 输出格式

```markdown
# 分析报告

## 分析目标
<用户输入>

## 上下文概览
<相关代码库元素>

## Codex 视角（技术/逻辑）
<后端架构、性能、安全性分析>

## 前端/UI 分析
<前端设计、用户体验分析>

## 综合洞察
<整合两个视角的关键发现和权衡>

## 建议
<可操作的下一步>
```

## 注意

- **必须使用 `run_in_background: true` 实现异步执行**
- Codex 通过 `--PROMPT` 内联角色，不再使用 `ROLE_FILE`
- 前端/UI 分析由当前模型直接完成
