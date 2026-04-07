# `/team archive`

`/team archive` 只归档当前 team runtime 与相关团队编排工件。

## 归档原则

- 不改变普通 `/workflow archive` 的现有语义
- 只清理 team runtime、team task board、team review / fix loop 记录
- 保留 `spec.md` / `plan.md` 与共享 workflow artifacts 的可追溯性

## 前置检查

- 若 `team_phase` 仍为 `team-exec` 或 `team-fix`，应先提示用户确认是否归档未完成团队
- 若存在未解决失败边界，应在归档前明确提示
