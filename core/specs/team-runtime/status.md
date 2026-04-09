# `/team status`

`/team status` 用于查看当前 team runtime 的聚合状态。

建议至少展示：
- `team_id` / `team_name`
- `status` / `team_phase`
- 当前边界任务、claim 角色与当前 owner
- 已完成 / 失败 / 待回流边界
- 最近一次 verify 结论
- 可认领的未阻塞边界
- 下一步建议（继续 execute、进入 fix、archive，或在 archived 后执行 cleanup）

## 边界

- 只读取 team runtime，不替代普通 `/workflow status`
- 只有显式 `/team` command surface 才允许在缺少 `teamId` 时自动定位 active team runtime；普通 workflow/session 不消费该能力
- 若不存在 team state，应明确提示用户尚未启动 `/team start`
- 状态报告中应明确展示显式触发治理：`explicit_invocation_only = true`、`auto_trigger_allowed = false`、`parallel_dispatch_mode = internal-team-only`
- 若 `team_phase === archived`，下一步建议应允许进入 cleanup，而不是继续 execute
- idle worker 是正常信号，不等于失败；只有长时间无进度或被显式标记 blocked/failed 才视为异常
