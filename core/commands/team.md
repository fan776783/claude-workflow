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
3. 显示模式由 `~/.claude.json` 的 `teammateMode` 决定：`in-process`（默认，全部在主终端）、`tmux`（每队友一个窗格，需装 tmux 或 iTerm2+it2）、`auto`（已在 tmux 会话里用 split-panes，否则走 in-process）。也可 `claude --teammate-mode in-process` 单会话强制。不做环境检测，第一次用户体感不对再提示切换。

## 何时用、何时不用

用：

- 并行审查/研究（多角度调查后综合）——**第一次用 team 推荐从这里起步**，边界清晰、不写代码、协调成本低
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
- **队友不继承对话历史**：每位队友有独立 context window，加载项目 CLAUDE.md / MCP / skills，但**不继承 Lead 的对话记录**——任务相关背景必须写进 spawn 时的初始 message。
- **subagent 作为队友的行为**：按 subagent type 生成队友时，队友遵守 subagent 的 `tools` 白名单和 `model`；subagent body **追加**到系统提示而不是替换；`SendMessage` 与任务管理工具始终可用，即使 `tools` 未列；subagent frontmatter 里的 `skills` 和 `mcpServers` **在 team 场景不生效**（队友从项目/用户设置加载）。本仓库 `core/agents/` 下已有 `plan-planner`、`plan-reviewer`、`review-architecture-reviewer`、`review-reviewer`、`review-security-reviewer` 可直接作为队友 type 复用。
- **不要手动编辑** `~/.claude/teams/<team>/config.json`：runtime state（sessionId、tmux pane id、members）由系统维护，手改会在下一次状态更新时被覆盖。队友可以**读取**该文件的 `members` 数组发现同伴名字（用于直连 SendMessage），但只读不写。

## 启动时的决策

从用户描述提取 4 件事并和用户对齐：

1. **队友数量**：默认 3–5 位；15 个独立任务起步给 3 位。每位队友背 5–6 个任务能维持产出且留出 Lead 重派空间，明显多于或少于这个区间就该调整数量。
2. **角色分工**：每位队友管一块独立领域/文件集，明确"谁负责什么 + 交付什么"。如果用户提到 `security-reviewer` 这类已有 subagent 名，按 subagent type 生成对应队友。
3. **队友命名**：在 spawn 指令里显式指定每位队友的名字（例如 `security`、`perf`、`tests`），后续对话按名字引用 SendMessage 才可预测。不指定则系统随机命名。
4. **是否需要计划批准**：当任务影响面大或用户说"实施前给我看方案"，让队友进入只读计划模式。官方机制是队友提交计划后由 **Lead 自主审批**：用户通过 `/team` 提示词给出审批标准（例如"只通过包含测试覆盖的计划""拒绝改数据库 schema 的计划"），Lead 据此决定批准或打回，并不是每份计划都停下来等用户点头。打回时队友**保持在计划模式**，按反馈修订后重新提交，可以多轮往返直到批准；批准后队友退出计划模式开始实施。

任务粒度要自包含、可交付——一个函数、一段审查、一个测试文件。粒度过小你会被协调吃掉，过大则队友跑偏难以及时拉回。

## Spawn 队友的初始 message 必须包含

这是让队友真正互相协作、而不是退化为并行 subagent 的关键。每位队友 spawn 时的 prompt 至少覆盖以下 6 点（缺失任何一条都会让队友回落到"只向 Lead 汇报"的默认行为）：

1. **任务上下文自带**：队友不继承 Lead 的对话历史，把任务目标、相关文件路径、已知约束、交付标准写进 prompt。别指望"CLAUDE.md 里有"——CLAUDE.md 只给项目视角，任务视角必须现写。
2. **直连规则**：告诉队友可以按名字 `SendMessage` 给任意其他队友，不用绕 Lead。典型场景：dev 完成后直接把代码指给 reviewer，researcher 把结论直接交给 dev。这是 team 相对 subagent 的核心差异，默认不开口就不会用。
3. **任务板自认领**：完成当前任务后，从共享任务板自行认领下一个 `pending` 且未被 `addBlockedBy` 阻塞的任务。任务三态（pending / in_progress / completed）由文件锁防竞态，不必问 Lead 要活。
4. **完成交付格式**：带证据——文件路径 + 行号 + 验证输出（测试通过、grep 命中、diff 摘要）。不要只写 "done" / "已完成" / 含 TODO / FIXME / 待验证 占位符，`team-task-guard.js` 会在 TaskCompleted 时直接退回这类标记。
5. **权限与资源获取**：需要超出当前权限的操作先 `SendMessage` 给 Lead 申请，不要在循环里反复触发权限提示；需要 Lead 协调的跨队友依赖也走 message，不要自己等。
6. **按 subagent type 生成时的告知**：在 prompt 里明确"你的 subagent body 已追加到系统提示，tools 白名单生效，skills/mcpServers frontmatter 在 team 场景不生效"，避免队友误以为自己能用 subagent 定义里写的 skills。

## 运行过程中的对话规则

- 用户说"用 N 个 Sonnet 队友" / "用 architect agent type 生成队友" → 按指令调整 spawn
- 用户让等 → **必须等队友做完再自己动手**，不要抢做队友的任务。Lead 开始抢做是常见故障模式，一句 "Wait for your teammates to complete their tasks before proceeding" 就能拉回
- 用户让关闭某位队友 → 发送 shutdown 请求，等对方确认退出。队友可能**拒绝并给出理由**（例如还有未完成的关键步骤），把解释转达给用户再决定强制关闭还是让它做完
- 任务板更新实时发生，你不需要轮询；队友空闲或任务状态变化时系统会通知你
- 队友权限请求会冒泡到 Lead 造成中断。启动前建议用户在 `~/.claude/settings.json` 的 `permissions.allow` 里预批常用操作（Read、常用 Bash 子集），避免每个队友都单独确认一次
- 显示模式操作（in-process）：`Shift+Down` 循环队友、`Enter` 查看某队友会话、`Esc` 中断当前轮、`Ctrl+T` 切任务板；split-panes 下直接点窗格交互

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
4. tmux 模式下若有孤立 session，按官方建议人工收掉：

   ```bash
   tmux ls
   tmux kill-session -t <session-name>
   ```

## 已知限制

启动前告诉用户这几条是 Claude Code 原生 team 的**系统级限制**，不是本命令的问题：

- **in-process 队友不支持 `/resume` 和 `/rewind`**：会话恢复后 Lead 可能向不再存在的队友发消息，此时让 Lead 重新 spawn 同名队友。
- **任务状态可能滞后**：队友偶尔忘记把任务标 `completed`，阻塞依赖任务。卡住时直接让 Lead 推队友更新，或手动改任务状态。
- **shutdown 较慢**：队友会先完成当前工具调用再退出，不要按 Ctrl+C 硬断。
- **token 成本显著高于单会话**：每位队友都是独立 Claude 实例，日常小任务优先用单会话或 subagent。

## 故障排除

- **队友未出现**：in-process 模式下按 `Shift+Down` 循环检查；多数情况下队友已起来但当前视图是 Lead。
- **队友出错停顿**：`Shift+Down` / 点窗格看输出 → 直接给它补一条指示，或 spawn 替代队友接手。
- **Lead 提前宣布团队完成**：告诉它继续，必要时重复一次 "Wait for your teammates to complete their tasks"。

## 边界

`/team` 只调 Claude Code 原生 agent team 能力，不写入仓库内任何 workflow 状态。`dispatching-parallel-agents` 和 subagent 各自解决单会话内的并行，不在此命令路径上自动触发。
