# dispatching-parallel-agents 放宽到 writable fan-out（对齐 superpowers）

ADR 0002 删除 worktree-per-task 可写并行子系统时，顺手把 `dispatching-parallel-agents` 钉成「只读 fan-out only / Never dispatch multiple implementation subagents in parallel」。现决定放宽这一条 consequence：对齐 superpowers `dispatching-parallel-agents`，允许 **writable fan-out** —— 多个 subagent 并行写，**硬前提是写文件集两两不相交 + 无共享状态**，主会话回收后做 conflict check + 跑全量验证 + 统一 commit。理由：ADR 0002 删的是「重型基建」（worktree-per-task + merge_strategist + 独立性自动检测 + 集成 worktree + 配置门），那套维护成本高且 plan 形状抗并行；而 superpowers 式 writable fan-out 是「轻量手动判定」—— 不需要任何运行时基建，由主会话在拿到具体场景时人工判定「文件是否不重叠」，命中即并行，拿不准即退回顺序。两者是不同量级的东西，放宽轻量路径不等于恢复重型路径。

## Status

accepted（2026-05-26）。Refines ADR 0002 的 dispatching consequence（见 0002 末尾指针）。

## 边界（哪些**没**变）

- **plan 执行仍顺序**：`workflow-execute` 的 plan task 默认有依赖 / 共享文件，继续走 fresh-subagent-per-task 顺序主路径。writable fan-out **不接管** plan 执行。superpowers 自己也是 plan 执行串行（`subagent-driven-development` 明确 Never parallel）、并行只在 `dispatching-parallel-agents`，本 ADR 与之一致。
- **不恢复 ADR 0002 删的任何代码**：无 worktree-per-task、无 `merge_strategist` / `batch_orchestrator` writable 路径、无 `parallel_execution.enabled` 配置门、无 `findParallelGroups` 自动独立性检测。隔离机制 = superpowers 原版「同工作目录 + 文件不重叠 + 返回后 conflict check」，纯靠主会话人工判定，零新增 runtime。

## Considered Options

- **维持 ADR 0002 的只读 only** — 拒绝。真实场景里「N 个独立失败测试文件，各自一个文件、互不重叠」很常见，强制顺序纯属浪费；superpowers 的实战例子（6 failures across 3 files → 3 agents 并行修）证明轻量 writable fan-out 有收益且无需基建。
- **恢复 ADR 0002 的 worktree-per-task 可写并行** — 拒绝。那套被删的核心理由（plan 形状抗并行 + 维护成本）未变；恢复重型基建解决的是「有依赖 plan 的并行」这个伪需求。
- **把 writable fan-out 引入 workflow-execute plan 执行** — 拒绝（用户 2026-05-26 决策「只放宽 dispatching skill」）。超出 superpowers 范围，且 plan task 普遍文件重叠 / 有依赖，不满足硬前提。

## Consequences

- **判定主权在主会话、人工、零基建**：是否走 writable fan-out 由主会话在具体场景判「写文件集是否两两不相交」。没有自动检测、没有配置开关。拿不准 → 退回顺序（成本远低于写竞争 + 错误 merge）。
- **新增主会话义务**：writable fan-out 回收后**必须** ① 用各 agent `files_changed` 做 conflict check（出现交集 = 独立性误判 → 回退顺序重做该组）② 跑全量验证 ③ 主会话统一 commit（subagent 不自行 commit，守代码主权）。
- **subagent prompt 契约扩展**：writable fan-out 的 dispatch prompt 必须显式给 `allowed_write_paths` + 「禁止编辑其他 agent 文件」；output schema 增 `files_changed` / `verification`。
- **文档同步面**：`core/CLAUDE.md`「并行与 Team」段、`dispatching-parallel-agents/SKILL.md`（description + 全文）、`workflow-execute/references/subagent-driven.md`（2 处边界）、`core/specs/workflow-runtime/hook-skill-alignment.md`（skill 职责表）已同步。
- **平台 fallback**：无 subagent 平台（opencode / antigravity / droid / gemini）writable fan-out 自动降级为主会话顺序执行各域，无并行收益，不阻塞。
