---
name: collaborating-with-codex
description: Proactively use when Claude Code is stuck, wants a second implementation or diagnosis pass, needs a deeper root-cause investigation, or should hand a substantial coding task to Codex through the native App Server runtime. Supports multi-turn sessions via --session-id.
---

<CONTEXT>
Codex prompt 中引用的术语应符合 `core/specs/shared/glossary.md`。纯桥接转发可跳过。
</CONTEXT>

## Selection Guidance

- **Proactive Trigger**: Do not wait for the user to explicitly ask for Codex. Use this skill proactively when you encounter complex algorithm issues, hard-to-locate bugs, or have failed at least 2 retry attempts. Hand substantial debugging or implementation tasks to Codex.
- Do not grab simple asks that you can finish quickly on your own.

## Interaction Rhythm

Codex 委托完成分析后,展示方案摘要(不调用 AskUserQuestion),以一句自然语言收尾:"方案可行请回复继续,不行告诉我哪里要改。" 用户回"继续" / "ok" / "go" 进入编码落盘;反对 / 要修改则回到分析阶段。Codex 委托本身不属于真决策点(代码尚未落盘,随时可回头),不使用 AskUserQuestion。

## Forwarding Rules (Thin Forwarder)

- Your only job is to properly formulate the prompt and forward the request to the Codex bridge script.
- Do not inspect the repository, read files, grep, or attempt to solve the task yourself before delegating.
- You may rewrite the prompt to be clearer and provide necessary context, but do not execute any actual modifications.
- Sit back and wait for the `node` script to return Codex's response (foreground) or for the log/status to signal terminal (background).

## Observation Pattern

`--background` 启动后,父 agent **不要盲轮询 `--status`**。按工具能力选择:

### Claude Code (主推:Monitor push 流)

`--background` 响应里带 `logFile` 路径。Monitor 该文件直接拿事件流:

```bash
Monitor "tail -F <logFile>"
```

每条新行 = 一次 push 通知(已截断到 ≤200 字符 + 关键 metadata)。父 agent 在事件触发时响应(命令失败 / finding 出现 / Reviewer 进 finalizing 等),无需任何轮询。完整 reasoning / message body 落在 `<id>.json` 的 `messages[]` / `reasoningSummary[]`,需要时按需 Read。

### 非 Claude Code(Cursor / Codex SDK / Gemini / ...)

无 Monitor → 用 `--status <id> --wait` 阻塞:

```bash
node codex-bridge.mjs --cd "<repo>" --status <id> --wait --tick 30
```

bridge 内部按 tick 轮询 `<id>.json`,直到终态返回 brief JSON。`--tick` 取值 `5–120`,默认 `30` 秒。

或自定义并行 loop(父 agent 自己控节奏,做别的事的同时点检):

```bash
node codex-bridge.mjs --cd "<repo>" --status <id>          # ~200B brief: {id,status,phase,elapsed,lastEvent,logFile}
node codex-bridge.mjs --cd "<repo>" --status <id> --detail # 富快照: + progressPreview / reasoningSummary / ...
```

终态拿结果用 `--result`(中间态会拒绝):

```bash
node codex-bridge.mjs --cd "<repo>" --result <id>
```

Job id 在当前 bucket 内支持 prefix 匹配(`--status job-abc` 命中 `job-abc-xxx`,多匹配会报 ambiguous)。

## Result Triage (Filter Over-Engineering)

Codex output — especially from `--review` and `--adversarial-review` — tends to over-index on defensive coding and speculative abstraction. Before acting on findings or landing code, filter the response against the bars below. Treat Codex as a "dirty prototype" (per the Global `代码主权` protocol), not a verdict.

**Downgrade or discard these finding patterns:**
- Null / undefined / type guards on values that originate from internal code with known shape (trusted inputs, framework guarantees, type-checked boundaries).
- `try`/`catch`, fallbacks, or retries for failure modes that are not actually reachable given the call site.
- Defensive branches for "what if the caller passes X" when no caller does, and no public API contract requires it.
- New abstractions, indirections, config knobs, or helpers introduced for hypothetical future requirements the task did not ask for.
- Refactors, renames, or cleanup bundled into a bug fix or a narrowly scoped change.
- Backwards-compatibility shims, feature flags, or deprecation paths when the change can simply land.
- Style, naming, comment-density, or "readability" feedback without a concrete defect behind it.
- Findings that restate the diff or the task description without naming a failure mode.

**Keep these:**
- Boundary validation (user input, external APIs, deserialization, IPC).
- Concrete failure modes tied to a real code path — race, ordering, partial failure, data loss, auth/tenant boundary, migration hazard.
- Invariants the change violates, or guards the change removed without justification.
- Observability gaps that would hide a real failure the reviewer can name.

**Triage procedure before you act:**
1. For each Codex finding, ask: *is this a reachable failure, or a hypothetical?* Discard hypotheticals.
2. For each suggested edit, ask: *was this in the task scope?* Strip out-of-scope refactors before landing.
3. If Codex proposes adding a guard/handler, confirm the unguarded path can actually be hit from real callers. If not, skip it.
4. When summarizing Codex's response to the user, report the filtered set and note what you dropped and why — do not pass raw findings through.

## Code Tasks

Codex 也能直接写代码(`task` 默认 sandbox `workspace-write`)。和 review 走不同协作模式。

### When to delegate code to Codex

✅ **Yes**:复杂算法、跨多文件的协调改动、stuck 2+ 次自己解不开的实现、需要更高 reasoning 深度的重构。

❌ **No**:单行 typo / 改一个字段 / 你自己 30 秒能搞定的 — 委托成本高于直接做。

### Sandbox 选择

- **`workspace-write`(默认)**:codex 可以写文件。用于实现 / 重构 / 加测试。
- **`--read-only`**:codex 只能读和分析,不写盘。用于深度调研、给方案,但**不**让它直接动手。比 review 模式多了 `--prompt` 自由度,适合"分析 X 该怎么做"类问题。

### Multi-turn diff-resume 模式

```bash
# 1) 初次委托,workspace-write 模式(model/effort 默认走 ~/.codex/config.toml)
node codex-bridge.mjs task --cd "<repo>" --prompt "Implement <feature> in <files>, no test additions outside scope" \
  --background

# 2) Monitor / --wait 等到终态
# 3) --result <id> 拿 touchedFiles + agentMessages
# 4) Parent agent 做 git diff,识别越界 / 防御代码 / out-of-scope 改动 → 写回 prompt
# 5) Resume 同一 session 让 codex 修
node codex-bridge.mjs task --cd "<repo>" --session-id <sessionId> --prompt "撤掉 src/x.ts 的 try/catch,test 文件不要碰" --background
```

`sessionId` 来自 `--result <id>` 的返回字段,持久 thread 支持任意次 resume。

### `--model` / `--effort` 旋钮

**默认**:不传任何 flag → codex 走 `~/.codex/config.toml` 的 `model` + `model_reasoning_effort`。SKILL 内部委托一律遵循此默认,不硬编码。

**显式 override**(opt-in):
- `--model spark`:`gpt-5.3-codex-spark` 别名,适合复杂重构。
- `--model <full-model-id>`:任意 codex 支持的 model id。
- `--effort <none|minimal|low|medium|high|xhigh>`:reasoning 深度。

仅在 user 当前任务确认需要拔高 / 降低于自身配置时显式传入,否则别动。

### Code Task Triage

Codex 写完代码后,**必须**先 diff 再决定是否落盘。沿用 user CLAUDE.md 的"代码主权"协议(外部模型输出 = 脏原型,parent 重构后落盘),codex 特有的常见越界:

**必须剥掉**:
- **文件越界** — codex 改了 `touchedFiles[]` 之外的"顺手"修改(format / rename / import 排序)。
- **out-of-scope test** — 任务没要求加测试时主动加的;或测试覆盖了 prompt 之外的行为。
- **防御代码** — internal call 上加 try/catch、null guard、类型守卫;新加的 fallback / retry / 默认值。
- **新抽象** — 引入 helper / config / interface 服务于"未来可能的需求"。
- **rename / 清理** — 任务没说要改的命名 / 文件结构调整。

**必须保留 / 验证**:
- 任务范围内的核心实现。
- 边界校验(用户输入 / 外部 API / 反序列化)。
- 真实可达失败路径的处理。

**Triage 流程**(每次 code task 之后):
1. `--result <id>` 拿 `touchedFiles[]`。
2. `git diff` 这些文件(只看这些,其他文件如果 codex 也碰了 — 立即 flag)。
3. 逐 hunk 过上面的"必须剥掉"清单,标记要 revert / 重写的部分。
4. 通过的部分由 parent 重构(命名 / 风格匹配代码库)落盘,不直接 `git add` codex 原稿。
5. 跑测试 / lint 验证。
6. 把变更摘要 + 剥掉了什么 + 为什么 反馈给用户。

## Wait Discipline

Codex review / adversarial-review / 长时编码 jobs commonly run 2-10 minutes. Do **not**:

- Cancel a still-running job because it "feels stuck" — silence ≠ idle.
- Re-spawn a duplicate Codex job to "speed it up" — wait for terminal status before acting.

`codex-bridge.mjs` explicitly passes `-c features.multi_agent_v2.min_wait_timeout_ms=480000` (8 min) on every spawn, so trusted **and** untrusted projects get the same floor regardless of whether `.codex/config.toml`'s `[features]` block is loaded. Cancel a Codex job only when:

- The user explicitly asks you to.
- Elapsed > 8 minutes **and** Monitor / `--status` shows no new event in > 90 s.

## Speak Discipline

Monitor 启动后**默认沉默**。仅在以下 4 类节点发声，其它事件累积合并或忽略：

1. **关键事实验证** — Codex 通过 grep/Read 验证了非平凡的代码事实（例如"已确认字段无 consumer"）
2. **错误或 OOM** — `Codex error` / `out of room` / `Cancelled` / 非零退出
3. **终态拉结果** — `Turn completed` 后拉 `--result` 落地
4. **方向需用户决策** — Codex 提出方案分支，需要用户选边

**禁止**：
- "等。" / "继续等" / "Codex 在跑" 等单字或重复性回复 — 用户已经知道在等
- 把每个 `Running command:` / `Command completed:` 事件当作发声触发点
- system-reminder（TaskCreate 提醒等）在单一阻塞任务期间反复回应

**物理减噪**：Monitor 命令用 `grep -E --line-buffered` 过滤事件流，让噪声事件根本不到达 LLM：

```bash
Monitor "tail -F <logFile> | grep -E --line-buffered \"Assistant message|Turn completed|error|out of room|Cancelled\""
```

**节奏基线**：10 分钟内 Codex 委托发声次数 ≤ 5。超出说明纪律没生效，复盘 Monitor 过滤模式。

**承认约束**：发声纪律的执行者是 LLM 而非确定性脚本，无法通过 lint/test 强制；本节是协议层防御 + 工具层减噪两重组合，治本靠重复实践建立反射。

## Quick Start

```bash
# Foreground task (workspace-write 默认,会写代码)
node scripts/codex-bridge.mjs task --cd "/path/to/project" --prompt "Implement X in src/x.ts"

# Background task + Monitor
node scripts/codex-bridge.mjs task --cd "/project" --prompt "Refactor Y" --background
# → returns { jobId, logFile, ... }
# Then in Claude Code: Monitor "tail -F <logFile>"
```

**Output:** Structured JSON. `--background` returns `{jobId, logFile, ...}`. `--status` returns brief snapshot (or `--detail` for rich). `--result` returns terminal aggregation. During execution, the bridge streams human-readable progress logs to `stderr` (foreground) or appends them to `<id>.log` (always).

**Completion model:** event-driven via `turn/completed` notification, no polling, no fixed delay.

## Parameters

```
Usage:
  node scripts/codex-bridge.mjs task [options]
  node scripts/codex-bridge.mjs --review <target> [options]
  node scripts/codex-bridge.mjs --adversarial-review <target> [options]
  node scripts/codex-bridge.mjs --status <id> [--detail] [--wait [--tick N]]
  node scripts/codex-bridge.mjs --result <id>
  node scripts/codex-bridge.mjs --cancel <id>

Options:
  --prompt <text>              Instruction for the task. Required for task mode.
  --cd <path>                  Workspace root for codex.
  --session-id <id>            Resume the specified codex session (task mode only).
  --review <target>            Built-in reviewer. `working-tree` or branch name. No --prompt.
  --adversarial-review <target>  Adversarial review via prompt template. Accepts --prompt for focus.
  --read-only                  Read-only sandbox (default: workspace-write for task).
  --model <name>               Codex model (e.g. `spark` → gpt-5.3-codex-spark).
  --effort <level>             Reasoning effort: none|minimal|low|medium|high|xhigh.
  --background                 Spawn detached worker, return jobId + logFile immediately.
  --status <id>                Brief snapshot: {id,status,phase,elapsed,lastEvent,logFile}.
  --status <id> --detail       Rich snapshot incl. progressPreview / reasoningSummary.
  --status <id> --wait         Block until terminal, then return brief.
  --tick <seconds>             Poll interval for --wait (5–120, default 30).
  --result <id>                Terminal aggregation: agentMessages, touchedFiles, etc.
  --cancel <id>                Cancel a running background job.
```

## Command Modes

### Task Mode (default)
- Regular task via `turn/start`.
- Supports `--session-id` for multi-turn resume (ephemeral=false).
- `--prompt` required (or `--session-id` for resume).
- Default sandbox: `workspace-write` (use `--read-only` for analysis-only).

### Review Mode (`--review`)
- Built-in reviewer via `review/start`.
- Always fresh read-only thread (ignores `--session-id`).
- No `--prompt` (built-in reviewer has no custom focus).

### Adversarial Review Mode (`--adversarial-review`)
- `turn/start` with `prompts/adversarial-review.md` template.
- Always fresh read-only thread.
- Accepts `--prompt` to specify focus areas.

## Multi-turn Sessions

Capture `sessionId` from the first response for resume:

```bash
node scripts/codex-bridge.mjs task --cd "/project" --prompt "Analyze auth in login.py"
# → sessionId returned in --result or final JSON
node scripts/codex-bridge.mjs task --cd "/project" --session-id "<uuid>" --prompt "Write unit tests for that"
```

## Code Review

```bash
# Built-in reviewer
node scripts/codex-bridge.mjs --cd "/project" --review "working-tree"
node scripts/codex-bridge.mjs --cd "/project" --review "main"

# Adversarial with focus
node scripts/codex-bridge.mjs --cd "/project" --adversarial-review "working-tree" --prompt "Focus on data leaks"
node scripts/codex-bridge.mjs --cd "/project" --adversarial-review "main" --prompt "Focus on auth boundary"
```

## State Location

Job state lives at `~/.claude/tmp/codex-jobs/<basename>-<sha8(realpath(cwd))>/`:
- `<id>.json` — full snapshot (status, messages, reasoning, fileChanges, ...)
- `<id>.log` — append-only single-line event stream (≤200 chars each, ISO timestamp)

GC runs on each `--background` spawn: prunes terminal jobs in the current bucket where count > 20 **or** mtime > 14d.
