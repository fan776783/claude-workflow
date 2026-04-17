# 内部修复协议参考

本文件为 bug-batch Phase 5 子 agent 提供执行规范。该协议替代了原先对 fix-bug skill 的调用，避免嵌套 Hard Stop 和重复分析。

## 1. 输入契约

子 agent 收到的上下文已包含经 bug-batch Phase 3-4 确认的根因和方案，不需要独立分析。

| 字段 | 必填 | 说明 |
|------|------|------|
| `unit_id` | 是 | FixUnit 标识符 |
| `primary_issue` | 是 | 主缺陷编号 |
| `included_issues` | 是 | 直接修复的缺陷列表 |
| `duplicate_issues` | 否 | 重复缺陷列表，需验证覆盖 |
| `shared_root_cause` | 是 | 已确认的根因文字描述 |
| `confirmed_root_cause_location` | 是 | 根因所在文件和函数（file + function + description） |
| `confirmed_fix_plan` | 是 | 已确认的修复方案（approach + files_to_modify + test_command） |
| `affected_scope` | 是 | 受影响模块路径 |
| `validation_scope` | 是 | 需要验证的功能点列表 |
| `worktree_path` | 否 | 若使用 worktree 隔离，提供路径 |
| `execution_constraints` | 是 | 执行禁止项列表 |

### 输入示例

```yaml
unit_id: "FU-001"
primary_issue: "p003"
included_issues: ["p003", "p001"]
duplicate_issues: ["p002"]
shared_root_cause: "token 刷新链路失效，TokenRefreshService.refresh() 未处理 401 重试"
confirmed_root_cause_location:
  - file: "src/auth/TokenRefreshService.ts"
    function: "refresh"
    description: "缺少 401 响应的重试逻辑"
confirmed_fix_plan:
  approach: "在 refresh() 中增加 401 重试拦截，最多重试 1 次，失败后清除 session"
  files_to_modify: ["src/auth/TokenRefreshService.ts"]
  test_command: "npm test -- --grep 'TokenRefresh'"
affected_scope: ["src/auth/", "src/store/session-store.ts"]
validation_scope:
  - "登录态刷新主流程"
  - "历史重复问题 p002 回归"
execution_constraints:
  - "只实施 confirmed_fix_plan 中的方案，不做独立分析"
  - "不向用户发起确认"
  - "不调用 collaborating-with-codex"
  - "不修改 shared_root_cause 或关系结论"
```

## 2. 子 agent 执行步骤

### Step 1: 根因复核（只读）

在 `confirmed_root_cause_location` 指定的文件和函数中，验证根因在代码中成立。

这不是重新分析——只需打开文件，定位函数，检查代码是否仍存在描述的问题。

若代码与描述不符（已被其他修复覆盖、逻辑已重构、函数已不存在），输出 `root_cause_mismatch: true` 并停止。

### Step 2: 实施修复

按 `confirmed_fix_plan.approach` 最小化修改，只改 `files_to_modify` 中的文件。

### Step 3: 运行验证

执行 `test_command`。无自动化测试时，输出手动验证步骤清单。

验证 `duplicate_issues` 是否被主修复覆盖——如果某个 duplicate_issue 的症状在修复后仍可复现，应在结果中标注。

### Step 4: 输出结构化结果

按输出契约格式输出，不包含独立诊断报告、用户确认请求、codex review 调用记录。

## 3. 输出契约

| 字段 | 必填 | 说明 |
|------|------|------|
| `unit_id` | 是 | 对应输入的 unit_id |
| `root_cause_mismatch` | 是 | true 表示代码与描述不符，需主会话介入 |
| `root_cause_confirmed` | 是 | 根因是否在代码中验证成立 |
| `files_changed` | 是 | 实际修改的文件列表 |
| `issues_fixed_directly` | 是 | 直接修复的缺陷编号列表 |
| `issues_covered_as_duplicates` | 是 | 重复归并覆盖的缺陷编号列表 |
| `verification_summary` | 是 | 验证结论（含测试命令输出摘要或手动步骤） |
| `residual_risks` | 是 | 残余风险描述 |
| `status_transition_ready` | 是 | 是否允许进入状态流转 |

### 输出示例

```yaml
unit_id: "FU-001"
root_cause_mismatch: false
root_cause_confirmed: true
files_changed: ["src/auth/TokenRefreshService.ts"]
issues_fixed_directly: ["p003", "p001"]
issues_covered_as_duplicates: ["p002"]
verification_summary: "npm test 通过，4/4 相关用例全部绿"
residual_risks: "低 — 高并发下重试风险未覆盖"
status_transition_ready: true
```

## 4. 失败终止规则

以下情况必须立即停止，输出 `status_transition_ready: false` 及诊断原因：

| 触发条件 | 处理 |
|---------|------|
| `root_cause_mismatch: true` | 代码与描述不符，停止修复，等主会话介入 |
| 验证命令连续失败 3 次 | 停止重试，输出失败原因 |
| 修改文件范围超出 `files_to_modify` | 停止修改，说明为什么需要改额外文件 |
| 发现需要修改 `shared_root_cause` 或拆分 FixUnit | 停止，建议退回重编排 |

不得尝试自行解决上述情况。子 agent 的职责是执行已确认的方案，不是做决策。
