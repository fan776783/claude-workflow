---
description: 代码审查 - 默认多模型并行审查，--quick 使用单模型快速审查
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git *), Bash(codeagent-wrapper *), TaskOutput
examples:
  - /diff-review
  - /diff-review --staged
  - /diff-review --quick
  - /diff-review --branch main
---

# 代码审查

## Usage

`/diff-review [OPTIONS]`

## Options

| 参数 | 说明 |
|------|------|
| (无) | 审查 `git diff HEAD`，多模型并行（Codex + Gemini） |
| `--staged` | 仅审查已暂存变更 |
| `--branch <base>` | 审查相对 base 分支的变更 |
| `--quick` | 单模型快速审查（仅 Claude） |

## Mode Detection

检查 `$ARGUMENTS` 是否包含 `--quick`：
- **包含**: 执行 Quick Review（Claude 单模型）
- **不包含**: 执行 Deep Review（多模型并行）**← 默认**

---

# Quick Review Mode (--quick)

适用于日常快速检查。

## Process

### Step 1: 获取 Diff

```bash
git diff HEAD
git status --short
```

### Step 2: 审查

按以下标准识别问题：
1. 影响准确性、性能、安全性或可维护性
2. 问题具体且可操作
3. 是本次变更引入的（非预先存在）
4. 如认为破坏其他部分，必须找到具体受影响代码

**忽略**: 琐碎风格、纯格式、拼写、文档补充

### Step 3: 输出报告

```markdown
# Review Report

## Summary
| Field | Value |
|-------|-------|
| Verdict | ✅ CORRECT / ❌ INCORRECT |
| Confidence | 0.XX |

**Explanation**: <1-3 句>

---

## Findings

### [PX] <标题>
| Field | Value |
|-------|-------|
| File | `<路径>` |
| Lines | <start>-<end> |

<问题说明>
```

---

# Deep Review Mode (默认)

多模型并行审查，适用于重要 PR。

## Your Role

你是**代码审查协调员**，编排多模型审查：
1. **Codex** – 后端逻辑、安全、性能审查
2. **Gemini** – 前端 UI/UX、可访问性审查
3. **Claude (Self)** – 综合反馈和最终报告

## Process

### Step 1: 获取 Diff + 分类文件

```bash
git diff HEAD
git status --short
```

将变更文件分为两类：
- **后端文件**: `*.js, *.ts, *.py, *.go, *.java, *.rs` 等（非组件）
- **前端文件**: `*.tsx, *.jsx, *.vue, *.svelte, *.css, *.scss` 等

### Step 2: 并行审查

**使用 `run_in_background: true` 并行调用 Codex 和 Gemini**

在单个消息中同时发送两个 Bash 工具调用：

```bash
# Codex 审查（后台执行）
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/reviewer.md

<TASK>
Review the following git diff:

## Changed Files
<file_list>

## Diff Content
```diff
<diff_content>
```

## Review Focus
- Logic correctness, edge cases, error handling
- Security vulnerabilities (injection, auth bypass, info leak)
- Performance issues (N+1, memory leak, unnecessary computation)
- Concurrency safety, resource management
</TASK>

OUTPUT FORMAT: Review comments only, sort by P0→P3 priority
EOF
```

```bash
# Gemini 审查（后台执行）
codeagent-wrapper --backend gemini - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/reviewer.md

<TASK>
Review the following git diff (UI files only):

## Changed Files
<ui_file_list>

## Diff Content
```diff
<ui_diff_content>
```

## Review Focus
- Component design, props interface, state management
- Accessibility (semantic HTML, ARIA, keyboard navigation)
- Responsive design, dark mode support
- Interaction states (hover, focus, loading, error, empty)
</TASK>

OUTPUT FORMAT: Review comments only, sort by P0→P3 priority
EOF
```

### Step 3: 综合反馈

使用 `TaskOutput` 获取两个任务的结果，然后：
1. 按 P0→P3 优先级排序
2. 去重合并相同问题
3. 识别两个模型都发现的问题（Consensus，置信度 +0.15）
4. 生成最终 Verdict

## Deep Review Output Format

```markdown
# Deep Review Report

## Summary
| Field | Value |
|-------|-------|
| Verdict | ✅ CORRECT / ❌ INCORRECT |
| Files | X files (+Y/-Z lines) |
| Codex Status | success / failed |
| Gemini Status | success / failed |

**Explanation**: <综合结论>

---

## Critical Issues (P0-P1)

### [PX] <标题>
| File | Lines | Source |
|------|-------|--------|
| `path` | X-Y | Codex/Gemini/Both |

<问题说明>

---

## Other Issues (P2-P3)
...

---

## Statistics
| Metric | Value |
|--------|-------|
| Codex Findings | X |
| Gemini Findings | X |
| Consensus Issues | X |
```

---

## Priority Levels

| 级别 | 含义 |
|------|------|
| P0 | 阻塞发布 |
| P1 | 应尽快处理 |
| P2 | 最终需修复 |
| P3 | 有则更好 |

## Verdict Rules

| 场景 | Verdict |
|------|---------|
| 无 P0/P1 | ✅ CORRECT |
| 任一 P0 | ❌ INCORRECT |
| Consensus P1+ | ❌ INCORRECT |
| 模型失败，无 P0 | ✅ CORRECT (degraded) |
