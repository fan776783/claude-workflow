# Codex Routing

"前端 / 后端 / 全栈" 的 Codex 路由规则。fix-bug、bug-batch、diff-review、workflow-review 共用此表。

## 决策表

| 问题类型 | 关键词 | review方 | 判据 |
|---|---|---|---|
| **前端** | 白屏 / 渲染 / 样式 / 组件 / 状态 / hook / CSS / 布局 / 交互 / 可访问性 | 当前模型直接review | UI 在当前模型眼前，截图 + 交互可直接验证 |
| **后端** | API / 数据库 / 500 / 超时 / 权限 / migration / auth / 并发 / 事务 / 队列 | Codex review | 后端逻辑常涉及 invariant / race / 隐式contract，需要独立视角 |
| **全栈** | 同时命中前后端关键词 / "混合特征" / 跨层调用链 | Codex review（后端逻辑优先） | 后端问题多为血液源头，前端变化常是症状 |

## 判定workflow

1. 取问题描述 + 根因 + 修改文件扩展名，在决策表匹配关键词。
2. 命中前端类 → 当前模型直接review，产出评审报告。
3. 命中后端类 → 按 `collaborating-with-codex` skill 调用 Codex 桥接脚本，prompt 模板见下。
4. 前后端都命中 → 全栈路径。

## 调用方式（后端 / 全栈）

后台执行，不设 timeout：

```
PROMPT: "ROLE: Code Reviewer. CONSTRAINTS: READ-ONLY, output review comments sorted by P0→P3. Review <变更类型>: <问题描述>. Root cause: <根因>. Fix: <方案摘要>. Diff: <git diff 内容>. Evaluate: root cause resolution, regression risk, edge cases, code quality. HARD CONSTRAINTS: (1) Ignore hypothetical scenarios without a named caller or reachable code path — trust internal code with known shape. (2) Do not recommend refactors, renames, or cleanup outside the diff. (3) Report only P0 (must-fix) and P1 (should-fix); collapse all P2/P3 into a single advisory line, do not expand. OUTPUT FORMAT: Review comments only, sort by P0→P3."
```

其中 `<变更类型>` 按 skill 场景填 `bug fix` / `workflow execute output` / `PR diff` 等。

## 降级

- Codex 不可用 → 当前模型直接review，在摘要里标注 `degraded_review: no_codex`。
- Codex 连续 2 次空响应 → 同降级，不无限重试。

## 使用方式

Skill SKILL.md 里写：

```markdown
### Phase N 审查路由

按 `core/specs/shared/codex-routing.md § 决策表` 判定审查方式：
- 前端问题 → 当前模型直接审查
- 后端 / 全栈 → Codex，调用契约见 `codex-routing.md § 调用方式`
```

不再在每个 skill 里复写三行关键词表和长 prompt 模板。
