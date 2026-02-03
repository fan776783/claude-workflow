# Deep Review Mode (默认)

多模型并行审查，适用于重要 PR。

## 角色

**代码审查协调员**，编排多模型审查：
1. **Codex** — 后端逻辑、安全、性能
2. **Gemini** — 前端 UI/UX、可访问性
3. **Claude (Self)** — 综合反馈和最终报告

## 流程

### Step 1: 获取 Diff + 分类文件

将变更文件分为两类：
- **后端文件**: `*.js, *.ts, *.py, *.go, *.java, *.rs` 等（非组件）
- **前端文件**: `*.tsx, *.jsx, *.vue, *.svelte, *.css, *.scss` 等

### Step 2: 并行审查

**使用 `run_in_background: true` 并行调用**，在单个消息中同时发送：

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

使用 `TaskOutput` 获取两个任务的结果：
1. 按 P0→P3 优先级排序
2. 去重合并相同问题
3. 识别两个模型都发现的问题（Consensus，置信度 +0.15）
4. 生成最终 Verdict

## 输出格式

```markdown
# Deep Review Report

## Summary
| Field | Value |
|-------|-------|
| Verdict | CORRECT / INCORRECT |
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
