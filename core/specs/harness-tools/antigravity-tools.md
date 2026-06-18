# Antigravity Tool Mapping

> Antigravity（`agy` CLI，Gemini CLI 后继者）通过原生 Plugin 机制分发（`lib/antigravity-plugin.js`，`agy plugin install`）。2.0 起 orchestrator 自动分解任务并并行 spawn subagents；CLI 支持 async background subagent。

## Dispatch Tool

| Action | Tool | 说明 |
|--------|------|------|
| Dispatch subagent | orchestrator 自动派发 | 2.0 主 agent（Technical Director）自动拆任务并 clone 为多个 subagent，隔离 context、无共享状态 |
| 异步 subagent | CLI async dispatch | 派 long-running task 到后台 agent，前台继续；完成后 diff 回贴对话 |

## Subagent 支持

- ✅ implementer subagent（subagent 隔离 context，无共享状态）
- ✅ reviewer subagent（单 subagent、AC+质量两 phase）
- ✅ final reviewer subagent（inline 整 branch 终审）

## Fallback

若运行环境无 subagent dispatch，自动降级：controller 主会话扮 implementer + 单段 self-review（按 `reviewer.md` 两 phase 顺序自检）。

> ⚠️ Antigravity 2.0 是 orchestrator **自动**编排模型（主 agent 自主拆分 + spawn），与 workflow 的「controller 显式 fresh-per-task 顺序派发」语义不完全一致；精确 dispatch tool 名以 `agy` CLI 官方文档为准（本表机制层已确认支持 subagent）。

## Hook 机制

- installer 生成 `ANTIGRAVITY.md` 上下文文件
- `agy plugin install` 报告 `✔ context : ANTIGRAVITY.md`

## Instructions File

- `ANTIGRAVITY.md`（installer 生成）
- 全局 memory：`~/.gemini/GEMINI.md`

## 备注

- Gemini CLI 已于 2026-06-18 停服并入 Antigravity CLI
- appDataDir 默认 `~/.gemini/antigravity-cli/`
