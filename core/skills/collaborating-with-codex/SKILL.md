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
