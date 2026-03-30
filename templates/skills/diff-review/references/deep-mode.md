# Deep Review Mode (--deep)

Codex 协作审查，适用于重要 PR。

## 角色

**代码审查协调员**，编排 Codex 协作审查：
1. **Codex** — 后端逻辑、安全、性能
2. **Claude (Self)** — 前端 UI/UX、可访问性 + 综合反馈和最终报告

## 流程

### Step 1: 获取 Diff + 分类文件

将变更文件分为两类：
- **后端文件**: `*.js, *.ts, *.py, *.go, *.java, *.rs` 等（非组件）
- **前端文件**: `*.tsx, *.jsx, *.vue, *.svelte, *.css, *.scss` 等

### Step 2: Codex 审查 + 当前模型前端审查

**Codex 审查**：使用 `run_in_background: true`（**不设置** timeout）：

按 `collaborating-with-codex` skill 调用：

```
PROMPT: "ROLE: Code Reviewer. CONSTRAINTS: READ-ONLY, output review comments sorted by P0→P3 priority. Review the following git diff: ## Changed Files: <file_list>. ## Diff Content: <diff_content>. ## Review Focus: Logic correctness, edge cases, error handling; Security vulnerabilities (injection, auth bypass, info leak); Performance issues (N+1, memory leak, unnecessary computation); Concurrency safety, resource management. OUTPUT FORMAT: Review comments only, sort by P0→P3 priority."
```

**当前模型前端审查**：在等待 Codex 结果期间，当前模型独立审查前端文件：
- 组件设计、props 接口、状态管理
- 可访问性（语义 HTML、ARIA、键盘导航）
- 响应式设计、暗色模式支持
- 交互状态（hover、focus、loading、error、empty）

### Step 3: 综合反馈

使用 `TaskOutput` 获取 Codex 结果后：
1. 合并 Codex 和当前模型的审查结果
2. 按 P0→P3 优先级排序
3. 去重合并相同问题
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

**Explanation**: <综合结论>

---

## Critical Issues (P0-P1)

### [PX] <标题>
| File | Lines | Source |
|------|-------|--------|
| `path` | X-Y | Codex/Claude/Both |

<问题说明>

---

## Other Issues (P2-P3)
...

---

## Statistics
| Metric | Value |
|--------|-------|
| Codex Findings | X |
| Claude Findings | X |
| Consensus Issues | X |
```
