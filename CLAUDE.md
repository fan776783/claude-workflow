# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@justinfan/agent-workflow` is an npm package that installs workflow templates to multiple AI coding tools. It provides a CLI tool (`agent-workflow`) and automatic postinstall setup using a canonical + managed-links architecture with a package root at `core/`.

当执行阶段涉及**同阶段 2+ 独立任务 / 独立问题域的并行分派**时，优先复用 `/dispatching-parallel-agents` skill；单任务 subagent 或单 reviewer 子 agent 不属于该 skill 的适用场景。

**Key Architecture**: Skills-based system supporting multiple AI coding tools through a single source of truth at `~/.agents/agent-workflow/`. Managed skills are mounted one-by-one under each tool's `skills` directory, command entry files are mounted under `commands/agent-workflow/`, and internal resources are mounted under each tool's `.agent-workflow/` namespace.

## Commands

```bash
# Development - validate before publish
npm run prepublishOnly    # Runs scripts/validate.js (the only validation gate)

# CLI commands (after npm install -g)
agent-workflow status    # Show installation status
agent-workflow sync      # Sync templates to AI coding tools
agent-workflow sync -a claude-code,cursor  # Install to specific agents
agent-workflow link      # Refresh managed links without re-copying canonical payload
agent-workflow init      # Init project config in current directory
agent-workflow doctor    # Diagnose configuration issues

# Release (auto: version bump + publish + git tag + push)
npm run release:patch     # Bug fixes: 1.0.0 -> 1.0.1
npm run release:minor     # Features: 1.0.0 -> 1.1.0
npm run release:major     # Breaking: 1.0.0 -> 2.0.0
```

Notes:
- No test suite or linter — `prepublishOnly` running `scripts/validate.js` is the sole pre-publish check.
- `scripts/release.sh` is a bash script. On Windows, run the `release:*` scripts from Git Bash / WSL.

## Architecture

```
├── bin/agent-workflow.js   # CLI entry point (commander-based)
├── lib/
│   ├── index.js             # Package exports
│   ├── installer.js         # Core install/upgrade logic
│   ├── agents.js            # Agent detection and configuration
│   ├── interactive-installer.js  # Interactive install UI
│   └── menu.js              # Interactive menu system
├── scripts/
│   ├── postinstall.js       # Auto-runs on npm install
│   ├── validate.js          # Pre-publish validation
│   └── release.sh           # Release automation
└── core/                    # Files synced to agents
    ├── skills/              # Skill definitions (portable across tools)
    │   ├── workflow-plan/ # Planning entry for /workflow-plan
    │   ├── workflow-execute/ # Execution entry for /workflow-execute
    │   ├── workflow-review/ # Review protocol entry for workflow quality gates
    │   ├── workflow-delta/  # Delta entry for /workflow-delta
    │   ├── workflow-status/ # Status entry for /workflow-status
    │   ├── workflow-archive/ # Archive entry for /workflow-archive
    │   ├── scan/            # Project scanning
    │   ├── fix-bug/         # Bug fixing workflow
    │   ├── write-tests/     # Test writing
    │   ├── diff-review/     # Code review
    │   ├── bug-batch/       # Batch bug fixing
    │   ├── dispatching-parallel-agents/ # Parallel dispatch for independent domains
    │   ├── knowledge-*/     # Knowledge compliance engine (bootstrap/check/review/update)
    │   └── figma-ui/        # Figma to code
    ├── commands/            # Command entry definitions
    ├── utils/               # Internal runtime utilities
    ├── docs/                # Supporting docs and templates
    ├── hooks/               # Hook scripts (installed under .agent-workflow/)
    └── specs/               # Specification documents
```

## Key Concepts

**Canonical + Managed Links Architecture:**

1. Single source of truth at `~/.agents/agent-workflow/`
2. Canonical package payload lives under `~/.agents/agent-workflow/core/`
3. Each AI tool keeps its own `skills` root directory, while managed skills are mounted individually from the canonical package
4. Commands are mounted into `commands/agent-workflow/` instead of taking over the entire commands root
5. Internal resources (`utils`, `specs`, `hooks`, `docs`) are mounted under the tool-local `.agent-workflow/` namespace
6. Supports both global (`~/.agents/`) and project-level (`.agents/`) installation

**Installation Flow:**

1. `postinstall.js` triggers on npm install
2. Detects installed AI coding tools (Claude Code, Cursor, Codex, etc.)
3. Copies `core/` into canonical storage
4. Creates managed links for each tool (`skills` per-skill, `commands/agent-workflow/*` for command entries, `.agent-workflow/*` for internal resources)
5. Tracks version in `.meta/meta.json`

**Upgrade Flow:**

1. Compares installed version with package version
2. Updates canonical location
3. All managed links automatically reflect changes
4. Backups saved to `.meta/backups/`

**Supported Agents:**

- Claude Code, Cursor, Codex, Antigravity, Droid, Gemini CLI, GitHub Copilot, OpenCode, Qoder

**Template Directories:** `core/{skills,commands,utils,specs,hooks,docs}`, with Agent-visible projections limited to `skills/`, `commands/agent-workflow/`, and `.agent-workflow/`

## Available Skills

Skills are the portable unit shipped to each AI tool. The authoritative list lives under `core/skills/` — every directory there is a published skill. A few skill families worth knowing when navigating the repo:

- **Workflow state machine** (`workflow-plan`, `workflow-execute`, `workflow-review`, `workflow-delta`, `workflow-status`, `workflow-archive`) — phased lifecycle with spec/plan artifacts and quality gates. State lives under `~/.claude/workflows/{project-hash}/`.
- **Knowledge** (`knowledge-bootstrap`, `knowledge-update`, `knowledge-review`) — declarative 7-section code-spec contract aligned with Trellis; `{pkg}/{layer}/` layout + shared `guides/`; no machine-readable blocking rules (review is human-driven).
- **Lightweight planning & review** — `plan` (quick 4-step planning), `session-review`, `diff-review`, `fix-bug`, `bug-batch`, `write-tests`.
- **Dispatch & research** — `dispatching-parallel-agents`, `search-first`, `deep-research`, `collaborating-with-codex`.
- **Other** — `scan`, `figma-ui`.

`/team` 命令直接走 Claude Code 原生 Agent Teams，不再有独立 skill 或 runtime；`core/commands/team.md` 负责命令契约，`core/hooks/team-idle.js` 与 `core/hooks/team-task-guard.js` 提供任务板守门和 cleanup 协调。

When updating this section, re-check `core/skills/` rather than trusting this list — it drifts.

Workflow state stored at `~/.claude/workflows/{project-hash}/` (user-level, not in git).
