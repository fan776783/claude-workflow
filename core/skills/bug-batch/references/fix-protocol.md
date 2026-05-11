# 内部修复协议

bug-batch Phase 5 subagent 执行规范。替代 fix-bug skill 调用，避免嵌套 Hard Stop。

## 输入 contract

subagent 收到经 Phase 3-4 确认的根因和方案，不需要独立分析。

| 字段 | 必填 | 说明 |
|------|------|------|
| `unit_id` | 是 | FixUnit 标识符 |
| `primary_issue` | 是 | 主缺陷编号 |
| `included_issues` | 是 | 直接修复的缺陷列表 |
| `duplicate_issues` | 否 | 重复缺陷列表，需验证覆盖 |
| `shared_root_cause` | 是 | 已确认的根因描述 |
| `confirmed_root_cause_location` | 是 | 根因所在 file + function + description |
| `root_cause_confidence` | 是 | `high` / `medium` |
| `alternative_hypotheses` | 否 | medium 时提供，供 Step 1 排除 |
| `confirmed_fix_plan` | 是 | approach + files_to_modify + test_command |
| `affected_scope` | 是 | 受影响 module 路径 |
| `validation_scope` | 是 | 需验证的功能点 |
| `worktree_path` | 否 | worktree 隔离时的路径 |

## 执行步骤

### Step 1: 根因复核（只读）

在 `confirmed_root_cause_location` 指定位置验证根因成立。

复核力度按 confidence 分级：
- `high`：快速确认——打开文件，检查描述的问题是否仍在
- `medium`：主动验证——沿调用链追踪是否确实触发症状。若有 `alternative_hypotheses`，逐一排除后才确认

三种"无需实施修复"的情况（互斥）：

| 情况 | 输出信号 |
|------|---------|
| 定位失败 / 语义模糊 | `root_cause_mismatch: true` |
| 问题已被批次外修复 / 函数已移除 | `root_cause_obsolete: true` |
| 被本批次其他 FixUnit 覆盖（必须指名 unit_id） | `covered_by_other_unit: <unit_id>` |

### Step 2: 实施修复

按 `confirmed_fix_plan.approach` 最小化修改，只改 `files_to_modify` 中的文件。

### Step 3: 运行验证

执行 `test_command`。无自动化测试时输出手动验证步骤。验证 duplicate_issues 是否被覆盖。

### Step 4: 输出结构化结果

## 输出 contract

| 字段 | 必填 | 说明 |
|------|------|------|
| `unit_id` | 是 | 对应输入 |
| `root_cause_mismatch` | 是 | 无法定位根因 |
| `root_cause_obsolete` | 是 | 根因已被批次外修复 |
| `covered_by_other_unit` | 条件 | 被覆盖时填 unit_id |
| `root_cause_confirmed` | 是 | 根因验证成立且仍需修复 |
| `files_changed` | 是 | 实际修改的文件列表 |
| `issues_fixed_directly` | 是 | 直接修复的缺陷编号 |
| `issues_covered_as_duplicates` | 是 | 重复归并覆盖的缺陷编号 |
| `verification_summary` | 是 | 验证结论 |
| `residual_risks` | 是 | 残余风险 |
| `status_transition_ready` | 是 | 是否允许进入状态流转 |
| `materialization_artifact` | 条件 | files_changed 非空时提供物化入口 |

### materialization_artifact

根据执行环境选择一种：

```yaml
# worktree 执行
materialization_artifact:
  kind: "worktree"
  worktree_path: "<path>"
  branch: "<branch name>"
  head_commit: "<sha>"
  diff_base: "<branch or sha>"

# 主工作树执行
materialization_artifact:
  kind: "working-tree"
  diff_base: "<branch or sha>"

# patch 文件
materialization_artifact:
  kind: "patch"
  patch_path: "<path>"
  diff_base: "<branch or sha>"
```

## 失败终止

以下情况立即停止，输出 `status_transition_ready: false`：
- `root_cause_mismatch` / `root_cause_obsolete` / `covered_by_other_unit`
- 验证命令连续失败 3 次
- 需要修改 `files_to_modify` 之外的文件
- 需要修改 `shared_root_cause` 或拆分 FixUnit
