# Hard Coding Rules 自检清单

> 由 `/design-plan` Step 3 使用。技术方案落盘前对 5 条 Hard Coding Rules + 1 条数据可见性(共 6 项)逐条标注"是否触及 / 如何遵循 / 例外说明"。
>
> 红线源:`AGENTS.md § Hard Coding Rules`(若该文件不存在,fallback 到 `docs/engineering/rules.md`)。第 6 项数据可见性是 **design-plan 设计期补充自检**,不在 AGENTS.md 红线正文内 —— 因涉用户数据的设计最易漏"子账号 / 跨租户能看到什么"(实战已出现预设隔离漏设计)。

| # | 规则 | 是否触及 | 如何遵循 | 例外(如有) |
| --- | --- | --- | --- | --- |
| 1 | 大表查询必须带 `wsid` 分区键;`task` 表加 `rm_task_id`;`episode_parse_*` 加 `ep_parse_id` | □ | 列出所有 SQL 都带的分区键字段名 | — |
| 2 | 跨服务读 OK,跨服务**写非权威表**默认拒绝;废弃资产(`rmincsrv` / `ws_tm_core*`)不承接新需求 | □ | 列出本方案是否动了非本服务权威的表;若动了,说明走 mtrsrv / 服务间 HTTP / MQ | — |
| 3 | 业务任务状态只向前流转(`success` / `fail` / `cancel` 终态);失败 / 取消 / 超时**必须**退还预扣积分,流水对齐操作日志 / 场景日志 / 资金流水三类记录 | □ | 列出本方案的任务状态机 + 是否对齐三类记录 | — |
| 4 | Python Agent 不直连前端,必须经 `rmagsrv`;Agent 扣积分调 `rmdfsrv` 的 `mtrsrv` 入口,**不直写** MySQL;Agent 溯源落 `media_agent` PG,不迁回 MySQL | □ | 列出本方案是否动 Agent;若动,确认链路经 rmagsrv 且积分走 mtrsrv | — |
| 5 | 密钥 / AI Key / DB 密码 / 回调 URL 不进代码,全走 Apollo;`if env == "prod"` 类硬分支禁止;`conf/*.yml` 仅本地 fallback | □ | 列出本方案新增的密钥 / 配置项,确认全部在 Apollo;无 env 硬分支 | — |
| 6 | **数据可见性 / 越权**(设计期补充,非 AGENTS.md 红线):涉用户数据查询时显式回答子账号 / 团队 / 跨租户分别能看到 / 操作什么 | □ | 列出按 `wsid` / `op_user_id` / `space_id` 的可见性边界;子账号隔离逻辑(如 `op_user_id != 0 && != wsid`)写清;哪些实体隔离、哪些 wsid 内全员可见 | — |

## 例外审批

任何"例外"必须:
1. 在风险章节明示
2. 给出补偿措施(灰度 / 监控 / 人工兜底)
3. 在阶段二实施时由资深研发或技术主管 review

## 自检失败的处理

任一条**触及但未给遵循方案**且**无明确例外审批**:
- skill 在 Hard Stop 展示时把该条标红
- 不阻断落盘,但用户必须显式确认"接受不合规风险"才进入 Step 5
- 阶段三 `/plan-archive` 会重新检查实际代码是否合规
