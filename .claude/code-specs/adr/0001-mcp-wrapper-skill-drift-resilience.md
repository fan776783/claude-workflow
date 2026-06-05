# MCP wrapper skills 通过 baseline + 归一化错误抵御 server 漂移

`bk` / `alidocs` / `figma-data` 包装的 MCP server 工具集会变（增删工具、改 required、漂移 enum、改输出 shape），三个 CLI 现状抗变能力不一（alidocs 有 schema cache + fingerprint + auto-refresh-on-miss，bk/figma-data 缺）。决定采取一组配套机制让漂移成为**显式信号**而非静默故障：(1) 双层 baseline——`core/skills/<skill>/baseline-schema.json` checkin 做权威 + 本地 `~/.cache/<cli>/` 做 runtime 热缓存；(2) baseline 落 **L3** 粒度（tool name + required + 静态 enum），动态 enum（如 bk `target_state`、aitable 字段 enum）走 SKILL.md snapshot 时间戳注释 + 调用前内省纪律；(3) 三个 CLI 统一 `tool_not_found` / `enum_invalid` / `auth` 三个错误桶（固定 exit code + structured stderr）让 agent 能自我修复对齐；(4) CLI 加 `raw <toolName>` 透传子命令承接未来 MCP 新工具。理由：枚举漂移是当下唯一**静默**失败模式，主动 diff + agent 反馈循环是必须的；checkin baseline 让 drift 全员可见，cache 仅服务 runtime；归一化错误三桶限定范围避免推全的成本。

## Status

accepted（2026-05-15，via `/grill`）

## Considered Options

- **维持现状** — 拒绝。枚举漂移静默，下游 skill（bug-batch / fix-bug 消费 bk，figma-ui 消费 figma-data）会静默炸
- **L4 全量 inputSchema diff** — 拒绝。description 改错别字都报警，CI 红久了大家会无视
- **probe 机制抓动态 enum**（CLI 主动用样本 issue 跑 `--list_states`） — 拒绝。样本 ID 自己会漂移，新增 drift 链
- **diff-tools auto-promote baseline** — 拒绝。CI 自我安抚会掩盖 drift
- **CLI auto-retry on tool_not_found** — 拒绝。把 server 删/改工具的暴露窗口缩短，反而坏事；drift 信号必须冒出来才能进 baseline diff
- **bk `get_issue` 永久维护透传 + normalize 两条路** — 拒绝。over-engineering，没第二个长期客户。改用 `--shape issue-record` flag，下游显式 opt-in normalize

## Consequences

非直观下游警示：

- 三个 CLI 共享 baseline 模块 → 跨 skill 依赖关系变紧，发版要联动测；曾经各自独立可单独 ship 的优势消失
- 下游 skill（`bug-batch` / `fix-bug` / `figma-ui` / `ux-elaboration`）的消费契约要切到稳定 shape（`bk --shape issue-record`、`Design Package schemaVersion`），未切的下游会被 server 字段重命名静默炸
- `diff-tools` 不自动 promote baseline → 需要人 review 流程承接 drift 信号；如果没人看 CI 报警，drift 仍会积压
- SKILL.md 硬编码 enum / 工具清单需配套 snapshot 时间戳注释，`spec-review` 加规则提示超 N 天核对——这是抓动态 enum 漂移的唯一防线，规则缺失则机制失效

实施细节（CLI flag、归一化字段、降级路径、危险前缀清单等）走后续 spec / plan，不在本 ADR 范围。
