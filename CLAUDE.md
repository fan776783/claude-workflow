# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@justinfan/agent-workflow` is an npm package that installs workflow templates to multiple AI coding tools. It provides a CLI tool (`agent-workflow`) and automatic postinstall setup using a canonical + managed-links architecture with a package root at `core/`.

当执行阶段涉及**同阶段 2+ 独立任务 / 独立问题域的并行分派**时，优先复用 `/dispatching-parallel-agents` skill；单任务 subagent 或单 reviewer 子 agent 不属于该 skill 的适用场景。

**Key Architecture**: Skills-based system supporting multiple AI coding tools through a single source of truth at `~/.agents/agent-workflow/`. Managed skills are mounted one-by-one under each tool's `skills` directory, command entry files are mounted under `commands/agent-workflow/`, and internal resources are mounted under each tool's `.agent-workflow/` namespace.

## Commands

```bash
# Development - validate before publish
npm run prepublishOnly    # Runs scripts/validate.js

# CLI commands (after npm install -g)
agent-workflow status    # Show installation status
agent-workflow sync      # Sync templates to AI coding tools
agent-workflow sync -a claude-code,cursor  # Install to specific agents
agent-workflow init      # Init project config in current directory
agent-workflow doctor    # Diagnose configuration issues

# Release (auto: version bump + publish + git tag + push)
npm run release:patch     # Bug fixes: 1.0.0 -> 1.0.1
npm run release:minor     # Features: 1.0.0 -> 1.1.0
npm run release:major     # Breaking: 1.0.0 -> 2.0.0
```

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
    │   ├── workflow-planning/ # Planning entry for /workflow start
    │   ├── workflow-executing/ # Execution entry for /workflow execute
    │   ├── workflow-reviewing/ # Review protocol entry for workflow quality gates
    │   ├── workflow-delta/  # Delta entry for /workflow delta
    │   ├── team/            # Explicit /team entry skill (routing only)
    │   ├── team-workflow/   # Heavy runtime contract for /team start|execute|status|archive
    │   ├── scan/            # Project scanning
    │   ├── fix-bug/         # Bug fixing workflow
    │   ├── write-tests/     # Test writing
    │   ├── diff-review/     # Code review
    │   ├── bug-batch/       # Batch bug fixing
    │   ├── dispatching-parallel-agents/ # Parallel dispatch for independent domains
    │   ├── figma-ui/        # Figma to code
    │   └── perf-budget/     # Performance budget validation
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

The package includes the following skills (all portable across AI coding tools):

**Core Workflow:**

- `/workflow` - Public workflow command entrypoint for command-capable agents (stable `/workflow start|execute|delta|status|archive` surface exposed from `core/commands/workflow.md` and backed by specialized workflow skills plus shared runtime docs)
  - `start` - Routed to `workflow-planning`
  - `execute` - Routed to `workflow-executing`
  - `delta` - Routed to `workflow-delta`
  - `status` - Still served from shared workflow runtime docs
  - `archive` - Still served from shared workflow runtime docs
- `/team` - Explicit team orchestration entrypoint for command-capable agents (stable `/team start|execute|status|archive` surface exposed from `core/commands/team.md`, with the `team` entry skill plus `team-workflow` runtime skill backed by `core/specs/team-runtime/` docs)
  - `start` - Bootstraps team-specific planning/runtime artifacts
  - `execute` - Runs team-exec → team-verify / team-fix loop
  - `status` - Served from shared team runtime docs
  - `archive` - Served from shared team runtime docs
- `workflow-planning` - Planning skill for `/workflow start` (analysis → discussion → UX gate → Spec → Plan)
- `workflow-executing` - Execution skill for `/workflow execute` (continuation governance + validation + quality gates + implementation report)
- `workflow-reviewing` - Review skill used by workflow quality gates (spec compliance + code quality)
- `workflow-delta` - Delta skill for `/workflow delta` (PRD/API/requirement changes)
- `team` - `/team` command entry skill for explicit routing/boundary semantics only; never auto-triggered by `/workflow`, `/quick-plan`, `dispatching-parallel-agents`, or natural-language broad-task detection
- `team-workflow` - Heavy team runtime skill for explicit `/team start|execute|status|archive`, owning phase/state contracts while preserving the same public `/team` command surface

**Planning:**

- `/quick-plan` - Lightweight quick planning (4-step: understand → analyze → plan → confirm, no state machine)

**Development Tools:**

- `/scan` - Project scanning (tech stack detection + context report generation)
- `/fix-bug` - Bug fixing workflow (locate → analyze → fix → review)
- `/write-tests` - Test writing expert (unit + integration tests)

**Code Review:**

- `/diff-review` - Code review (Quick by default, `--deep` for Codex-assisted, `--pr` for GitHub PR review)
- `/bug-batch` - Batch bug fixing (pull from Blueking project management)
- `/dispatching-parallel-agents` - Parallel dispatch for independent domains (independence check + boundary grouping + conflict fallback)

**Research:**

- `/search-first` - Search before implementing (codebase + npm/PyPI + GitHub → Adopt/Extend/Build decision)
- `/deep-research` - Multi-source cited research (firecrawl/exa MCP + read_url_content fallback)

**UI Development:**

- `/figma-ui` - Figma design to code (visual fidelity validation)

**Performance:**

- `/perf-budget` - Performance budget validation (page load, bundle size, API response)

Workflow state stored at `~/.claude/workflows/{project-hash}/` (user-level, not in git)

Team state stored at `~/.claude/workflows/{project-hash}/teams/{team-id}/team-state.json` and is only created by explicit `/team ...` commands.
