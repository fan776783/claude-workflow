# 输入归一化

fix-bug 的入参有两种形态，落到后续 Phase 之前统一归一化成 `IssueRecord`。

## 入参是 `issue_number`（例：`p328_600`）

1. 读 `.claude/config/project-config.json`，取 `project.bkProjectId`。为空或文件不存在时终止，输出与 bug-batch 一致的提示：`蓝鲸项目未关联，请先执行 /scan 完成项目关联`。
2. 调用 `mcp__mcp-router__get_issue(issue_number)` 拉取详情。
3. 标准化为 IssueRecord（字段表见下方）。
4. 后续 Phase 的现象描述、根因假设、影响分析均基于这份 IssueRecord。

## 入参是自由描述 `bug`

1. 跳过配置读取与 MCP 调用。
2. 构造最小 IssueRecord：只填 `description`，其它字段留空。
3. 无 `issue_number` 时，`status_transition_ready` 恒为 `false`，最终摘要里标注 `无缺陷单可流转`。

## IssueRecord 字段

单缺陷流程使用的精简字段集（与 bug-batch 的 IssueRecord 同名兼容）：

- `issue_number`
- `title`
- `description`
- `reproduction_steps`
- `priority`
- `state`
- `operator_user`
- `reporter`
- `created_at`
- `screenshots`
- `module_hint`

没有值的字段留空即可，不要自己编造内容填充。
