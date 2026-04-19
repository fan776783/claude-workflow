---
description: 启动 Claude Code 原生 Agent Team，让当前会话充当负责人并行协作
argument-hint: <任务描述，例如：并行审查 PR 的安全/性能/测试三个方向>
examples:
  - /team 并行审查 PR #142 的安全、性能、测试覆盖
  - /team 用竞争假设调试 WebSocket 每 30 秒断连的问题
  - /team 重构 auth 模块，实施前要我批准计划
---

# /team

当前会话收到 `/team <任务描述>` 后，作为 Team Lead 启动一组独立队友并行推进。每位队友是独立 Claude Code 实例，有自己的 context window、任务板条目和 mailbox。

## 触发前做的检查

1. 用户已经显式输入 `/team ...`。任何非显式调用（workflow 识别到多任务、自然语言宽泛请求、`dispatching-parallel-agents`）都**不要**进入这个命令。
2. Preflight：Claude Code 版本必须 ≥ v2.1.32，且环境或 `~/.claude/settings.json` 的 `env` 下必须有 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`。任一条件不满足，直接提示用户补齐后重试，不要启动 team。

## 何时用、何时不用

用：

- 并行审查/研究（多角度调查后综合）
- 独立模块的并行实现（各自拥有不同文件集）
- 竞争假设的 debug（队友互相反驳直到收敛）
- 跨层改动（前端/后端/测试分工同步推进）

不用：

- 单行修复、简单一次性改动（协调开销不划算）
- 顺序强依赖、无法真正并行的任务
- 多个队友会改同一文件的工作（必然覆盖）
- 已经在 `/workflow-*` 状态机里的流程

## 官方硬约束

启动前确认这些边界，用户提出相反要求时需当场解释为何不做：

- **一会话一个 team**：同一 Lead 会话同时只能管理一个 team；启动新 team 前必须先清理当前 team。
- **不可嵌套**：队友不能再生成自己的队友或团队。
- **Lead 固定**：创建 team 的会话在其生命周期内就是 Lead，不能把队友提拔为 Lead，也不能转移领导权。
- **权限 spawn 时继承**：队友继承 Lead 的权限模式，spawn 时不能为单个队友单独设置；生成后可以改个别队友的模式。

## 启动时的决策

从用户描述提取 3 件事并和用户对齐：

1. **队友数量**：默认 3–5 位；15 个独立任务起步给 3 位。再多就只增加 token 和协调成本。
2. **角色分工**：每位队友管一块独立领域/文件集，明确"谁负责什么 + 交付什么"。如果用户提到 `security-reviewer` 这类已有 subagent 名，按 subagent type 生成对应队友。
3. **是否需要计划批准**：当任务影响面大或用户说"实施前给我看方案"，让队友进入只读计划模式。官方机制是队友提交计划后由 **Lead 自主审批**：用户通过 `/team` 提示词给出审批标准（例如"只通过包含测试覆盖的计划""拒绝改数据库 schema 的计划"），Lead 据此决定批准或打回，并不是每份计划都停下来等用户点头。

任务粒度要自包含、可交付——一个函数、一段审查、一个测试文件。粒度过小你会被协调吃掉，过大则队友跑偏难以及时拉回。

## 运行过程中的对话规则

- 用户说"用 N 个 Sonnet 队友" / "用 architect agent type 生成队友" → 按指令调整 spawn
- 用户让等 → **必须等队友做完再自己动手**，不要抢做队友的任务
- 用户让关闭某位队友 → 发送 shutdown 请求，等对方确认退出
- 任务板更新实时发生，你不需要轮询；队友空闲或任务状态变化时系统会通知你

## Hook 反馈的处理

安装时自动注册了两个原生 hook：`team-idle.js`（TeammateIdle）和 `team-task-guard.js`（TaskCreated / TaskCompleted）。看到 stderr 里的 `[team-idle]` 或 `[team-task-guard:*]` 前缀时，按下面规则响应，不要和用户争辩：

- **`任务板仍有 N/M 个未完成任务`**：目标队友立即认领或继续推进，不要空闲。
- **`任务板已清空 ... 给 Team Lead 发一条 message`**：队友侧按提示发 message 通知 Lead，正常 idle；Lead 收到该 message 后触发下面的"收尾"流程。
- **`TaskCreated` 被拒**：补上 `task_subject`（一句能看出交付什么的标题）再重新创建。
- **`TaskCompleted` 被拒**：去掉 `task_subject` / `task_description` 里的 TODO / FIXME / 待验证 / 待补充 类字眼，补上实际验证证据（测试通过、文件已改），再标 completed。

## 收尾

Lead 收到队友的"任务板已清空"message，或自行判断 team 工作完成后，按下面顺序收尾：

1. 确认所有队友已 idle；如仍有活跃队友，先逐个发 shutdown 请求并等待确认退出——`clean up team` 在有活跃队友时会直接失败。
2. 执行 `clean up team`，这会删除共享 team 资源和任务板。
3. 若 `clean up team` 失败（例如官方已知的 shutdown 滞后、resume 状态漂移），调用 `AskUserQuestion` 工具向用户弹出快捷选项，`question` 写"team 清理失败，如何处理？"，`options` 给三个：
   - `retry_cleanup`（重试：再次执行 `clean up team`）
   - `force_cleanup`（强制：先逐个 shutdown 剩余队友再清理）
   - `keep_team`（保留：跳过清理，保留 runtime 目录，后续人工处理）
4. tmux 模式下若有孤立 session，按官方建议用 `tmux ls` + `tmux kill-session -t <name>` 人工收掉。

## 边界

`/team` 只调 Claude Code 原生 agent team 能力，不写入仓库内任何 workflow 状态。`dispatching-parallel-agents` 和 subagent 各自解决单会话内的并行，不在此命令路径上自动触发。
