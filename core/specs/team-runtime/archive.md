# `/team archive` / `/team cleanup`

`/team archive` 与 `/team cleanup` 分别承担 team runtime 的逻辑归档与物理清理职责。

## 归档原则

- 不改变普通 `/workflow archive` 的现有语义
- `/team archive` 只把 team runtime 标记为 `archived` 终态，不删除 runtime 目录
- `/team cleanup` 只清理已归档的 team runtime 目录，不删除 repo 内 `spec.md` / `plan.md` 与共享 workflow artifacts
- 保留 `spec.md` / `plan.md` 与共享 workflow artifacts 的可追溯性

## 前置检查

### `/team archive`

- 若 `team_phase` 仍为 `team-exec` 或 `team-fix`，应先提示用户确认是否归档未完成团队
- 若存在未解决失败边界，应在归档前明确提示

### `/team cleanup`

- 仅允许清理 `status === archived` 或 `team_phase === archived` 的 team runtime
- cleanup 前必须已经通过显式 `/team` / `team-workflow` 入口解析到目标 runtime，并显式提供 `teamId`
- 若 runtime 尚未 archive，应明确提示先执行 `/team archive`
- cleanup 只删除 `~/.claude/workflows/{projectId}/teams/{teamId}/`，不删除 repo 内规划工件
