---
description: 多模型代码审查（Codex + Gemini 并行），无参数时自动审查 git diff HEAD
allowed-tools: Bash(git *), Bash(codeagent-wrapper *), Read(*), Grep(*), Glob(*), TaskOutput
examples:
  - /diff-review-deep
  - /diff-review-deep --staged
  - /diff-review-deep --branch main
---

# 多模型深度代码审查

## Usage

`/diff-review-deep [OPTIONS]`

## Behavior

- **无参数**: 自动审查 `git diff HEAD`
- **--staged**: 仅审查已暂存变更
- **--branch <base>**: 审查相对 base 分支的变更

## Your Role

你是**代码审查协调员**，负责编排多模型审查：
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

OUTPUT FORMAT (override ROLE_FILE default):
- Review comments only, NO scoring report
- Sort by P0→P3 priority (P0=Critical, P1=High, P2=Medium, P3=Low)
- Format: ### [PX] Title\n<description>
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

OUTPUT FORMAT (override ROLE_FILE default):
- Review comments only, NO scoring report
- Sort by P0→P3 priority (P0=Critical, P1=High, P2=Medium, P3=Low)
- Format: ### [PX] Title\n<description>
EOF
```

**说明**:
- 使用 `ROLE_FILE:` 指定提示词文件路径，让子进程自己读取，避免消耗主会话 token
- `OUTPUT FORMAT (override ROLE_FILE default)` 明确覆盖 ROLE_FILE 中的默认评分格式
- 如果 ROLE_FILE 不存在，子进程会使用 TASK 中的 Review Focus 作为角色指引
- 降级策略：模型不可用时自动降级为单模型审查

### Step 3: 综合反馈

使用 `TaskOutput` 获取两个任务的结果，然后：
1. 按 P0→P3 优先级排序
2. 去重合并相同问题
3. 识别两个模型都发现的问题（Consensus，置信度 +0.15）
4. 生成最终 Verdict

## Output Format

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

### [PX] <标题>
...

---

## Statistics
| Metric | Value |
|--------|-------|
| Codex Findings | X |
| Gemini Findings | X |
| Consensus Issues | X |
```

## Verdict Rules

| 场景 | Verdict |
|------|---------|
| 无 P0/P1 | ✅ CORRECT |
| 任一 P0 | ❌ INCORRECT |
| Consensus P1+ | ❌ INCORRECT |
| 模型失败，无 P0 | ✅ CORRECT (degraded) |

## Notes

- **必须使用 `run_in_background: true` 并行执行**
- Codex 擅长后端逻辑，Gemini 擅长前端 UI
- 使用 HEREDOC 语法避免 shell 转义
- 快速检查用 `/diff-review`，本命令用于重要 PR
