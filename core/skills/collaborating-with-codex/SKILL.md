---
name: collaborating-with-codex
description: Proactively use when Claude Code is stuck, wants a second implementation or diagnosis pass, needs a deeper root-cause investigation, or should hand a substantial coding task to Codex through the native App Server runtime. Supports multi-turn sessions via --session-id.
---

## Selection Guidance

- **Proactive Trigger**: Do not wait for the user to explicitly ask for Codex. Use this skill proactively when you encounter complex algorithm issues, hard-to-locate bugs, or have failed at least 2 retry attempts. Hand substantial debugging or implementation tasks to Codex.
- Do not grab simple asks that you can finish quickly on your own.

## Forwarding Rules (Thin Forwarder)

- Your only job is to properly formulate the prompt and forward the request to the Codex bridge script.
- Do not inspect the repository, read files, grep, or attempt to solve the task yourself before delegating. 
- You may rewrite the prompt to be clearer and provide necessary context, but do not execute any actual modifications.
- Sit back and wait for the `node` script to return Codex's response.

## Quick Start

```bash
# Run from inside the installed skill directory
node scripts/codex-bridge.mjs task --cd "/path/to/project" --prompt "Your task"
```

**Output:** Structured JSON with `success`, `command`, `sessionId`, `turnId`, `agentMessages`, and optional `error`/`stderr`. During execution, the bridge will stream human-readable progress logs to `stderr`.

**Completion model:** The bridge uses an event-driven model — it waits for the App Server's `turn/completed` notification before returning results. There is no polling or fixed delay.

## Parameters

```
Usage:
  node scripts/codex-bridge.mjs task [options]

Options:
  --prompt <text>              Instruction for the task to send to codex. Required for task mode.
  --cd <path>                  Set the workspace root for codex before executing the task.
  --session-id <id>            Resume the specified session of the codex. Only for task mode.
  --review <target>            Run code review via the built-in reviewer. Use `working-tree`
                               for uncommitted changes, or a branch name (e.g. `main`) as baseline.
                               Does NOT accept --prompt or --session-id.
  --adversarial-review <target>  Run adversarial review via turn/start + prompt template.
                               Use --prompt to specify focus areas. Always read-only.
  --read-only                  Run the codex task in read-only sandbox mode (default is workspace-write).
  --background                 Run the task in the background and return a job ID immediately.
  --status <job-id>            Query the status of a background job (requires --cd).
  --cancel <job-id>            Cancel a running background job (requires --cd).
```

## Command Modes

### Task Mode (default)
- Regular Codex task via `turn/start`
- Supports `--session-id` for multi-turn conversations
- Threads are persisted (`ephemeral: false`) to support resume
- `--prompt` is required

### Review Mode (`--review`)
- Uses the built-in reviewer via `review/start`
- Always creates a **fresh read-only thread** (ignores `--session-id`)
- Does **NOT** accept `--prompt` (no custom focus text allowed)

### Adversarial Review Mode (`--adversarial-review`)
- Uses `turn/start` with the `prompts/adversarial-review.md` template
- Always creates a **fresh read-only thread** (ignores `--session-id`)
- Accepts `--prompt` to specify focus areas

## Multi-turn Sessions

**Always capture `sessionId`** from the first response for follow-up:

```bash
# Initial task
node scripts/codex-bridge.mjs task --cd "/project" --prompt "Analyze auth in login.py"

# Continue with session-id (threads are persisted for resume)
node scripts/codex-bridge.mjs task --cd "/project" --session-id "uuid-from-response" --prompt "Write unit tests for that"
```

## Background Jobs

For long-running refactors:

```bash
node scripts/codex-bridge.mjs task --cd "/project" --background --prompt "Refactor deeply coupling modules"
# Returns immediately with a job ID

node scripts/codex-bridge.mjs task --cd "/project" --status <job-id>

# Cancel a running job (terminates the worker process)
node scripts/codex-bridge.mjs task --cd "/project" --cancel <job-id>
```

## Code Review

```bash
# Built-in reviewer (no custom focus)
node scripts/codex-bridge.mjs --cd "/project" --review "working-tree"
node scripts/codex-bridge.mjs --cd "/project" --review "main"

# Adversarial review with focus area
node scripts/codex-bridge.mjs --cd "/project" --adversarial-review "working-tree" --prompt "Focus on data leaks"
node scripts/codex-bridge.mjs --cd "/project" --adversarial-review "main" --prompt "Focus on auth boundary"
```
