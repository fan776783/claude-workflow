# collaborating-with-codex

A Claude Code **Agent Skill** that bridges Claude with OpenAI Codex CLI for multi-model collaboration on coding tasks, leveraging the native Codex App Server RPC protocol.

## Overview

This Skill enables Claude to delegate coding tasks to Codex CLI, combining the strengths of multiple AI models. Codex handles algorithm implementation, debugging, and code analysis while Claude orchestrates the workflow and refines the output.

## Features

- **App Server Native**: Communicates via JSON-RPC stream directly with the `codex app-server`.
- **Event-driven Completion**: Waits for the real `turn/completed` notification instead of polling or sleeping — the bridge returns results only after Codex has fully finished processing.
- **Streaming Live Progress**: Real-time status logs of Codex executing tools, commands, and edits are piped to `stderr` preventing silent timeouts.
- **Multi-turn sessions**: Maintain conversation context across multiple interactions via `--session-id`. Task threads are persisted (`ephemeral: false`) to support cross-process resume.
- **Separated Review Modes**: Built-in review (`--review`) and adversarial review (`--adversarial-review`) are distinct command modes with proper isolation.
- **Background Job Engine**: Fork Codex into a detached process so Claude doesn't have to wait (`--background`). Cancel via `--cancel` using worker PID termination.

## Installation

1. Ensure [Node.js](https://nodejs.org/) (≥ 18) and [Codex CLI](https://github.com/openai/codex) are installed. 
2. Copy this Skill to your Claude Code skills directory:
   - User-level: `~/.claude/skills/collaborating-with-codex/`
   - Project-level: `.claude/skills/collaborating-with-codex/`

## Usage

### Basic Task

```bash
node scripts/codex-bridge.mjs task --cd "/path/to/project" --prompt "Analyze the authentication flow"
```

### Multi-turn Session

```bash
# Start a session (threads are persisted for resume)
node scripts/codex-bridge.mjs task --cd "/project" --prompt "Review login.py for security issues"
# Response includes sessionId

# Continue the session
node scripts/codex-bridge.mjs task --cd "/project" --session-id "uuid-from-response" --prompt "Suggest fixes for the issues found"
```

### Built-in Review

Run the Codex built-in reviewer. **Does not accept `--prompt`** — for focused review, use adversarial mode below.

```bash
# Review uncommitted changes
node scripts/codex-bridge.mjs --cd "/project" --review "working-tree"

# Review current branch vs main
node scripts/codex-bridge.mjs --cd "/project" --review "main"
```

### Adversarial Review

Run a robust, adversarial code review using the `prompts/adversarial-review.md` template. Accepts `--prompt` for focus areas.

```bash
# Adversarial review with custom focus
node scripts/codex-bridge.mjs --cd "/project" --adversarial-review "working-tree" --prompt "Focus on data leaks"

# Adversarial review vs branch baseline
node scripts/codex-bridge.mjs --cd "/project" --adversarial-review "main" --prompt "Focus on auth boundary"
```

### Background Jobs

Push a heavy refactor task into the background:
```bash
node scripts/codex-bridge.mjs task --cd "/project" --background --prompt "Refactor legacy modules"
# Returns immediately with a jobId

# Later, check status (must include --cd for the same project):
node scripts/codex-bridge.mjs task --cd "/project" --status <jobId>

# Cancel a running job:
node scripts/codex-bridge.mjs task --cd "/project" --cancel <jobId>
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task` | Yes | Run command (default subcommand) |
| `--prompt` | Task: Yes, Adversarial: Optional, Review: No | Task instruction or review focus |
| `--cd` | Yes | Workspace root directory. Required for all operations |
| `--read-only` | No | Security level: `read-only` (default is `workspace-write`, only for task mode) |
| `--session-id` | No | Resume a previous session (task mode only, not allowed for reviews) |
| `--review <target>` | No | Built-in code review. No `--prompt`, no `--session-id` |
| `--adversarial-review <target>` | No | Adversarial review via prompt template. Accepts `--prompt` for focus |
| `--background` | No | Run detached in the background |
| `--status <jobId>` | No | Query status of a background job (requires `--cd`) |
| `--cancel <jobId>` | No | Cancel a running background job (requires `--cd`) |

### Output Format

```json
{
  "success": true,
  "command": "task",
  "sessionId": "uuid",
  "turnId": "turn-uuid",
  "agentMessages": "Codex response text.",
  "target": { "input": "main", "type": "baseBranch", "branch": "main", "label": "branch diff vs main" }
}
```

On failure:
```json
{
  "success": false,
  "command": "task",
  "error": "Error message",
  "errorDetail": { "message": "...", "code": -32000 },
  "stderr": "codex app-server stderr output (last 2000 chars)"
}
```

### Protocol Details

The bridge implements the Codex App Server JSON-RPC protocol:

1. **Handshake**: `initialize` → `initialized` notification (with `optOutNotificationMethods` to filter noisy delta events)
2. **Thread lifecycle**:
   - Task: `thread/start` with `ephemeral: false` + `approvalPolicy: "never"` (persisted for resume)
   - Review: `thread/start` with `ephemeral: true` + `sandbox: "read-only"` (isolated, fresh)
3. **Turn completion**: Event-driven via `turn/completed` notification (not polling or delays)
4. **Review modes**:
   - `--review` → `review/start` (built-in reviewer, no instructions)
   - `--adversarial-review` → `turn/start` with `prompts/adversarial-review.md` template
5. **Multi-thread support**: Tracks subagent threads and infers completion when all subagent turns drain

## Migration from v1 (Python)

v2 完全重写了桥接脚本（Python → Node.js），旧入口 `scripts/codex_bridge.py` 已删除。

| v1 (Python) | v2 (Node.js) |
|---|---|
| `python scripts/codex_bridge.py` | `node scripts/codex-bridge.mjs task` |
| `--PROMPT "..."` | `--prompt "..."` |
| `--SESSION_ID <id>` | `--session-id <id>` |
| `--WORKING_DIR <path>` | `--cd <path>` |
| `--READ_ONLY` | `--read-only` |
| *N/A* | `--review <target>` |
| *N/A* | `--adversarial-review <target>` |
| *N/A* | `--background` / `--status` / `--cancel` |

**Breaking changes**:
- 所有参数改为 kebab-case 小写（`--PROMPT` → `--prompt`）
- 输出格式从纯文本改为结构化 JSON
- 新增 review 模式和后台任务管理

## License

MIT License. See [LICENSE](LICENSE) for details.
