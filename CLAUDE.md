# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@justinfan/agent-workflow` is an npm package that installs workflow templates (skills, commands, prompts, utils) to multiple AI coding tools. It provides a CLI tool (`agent-workflow`) and automatic postinstall setup using a canonical + managed-links architecture.

当执行阶段涉及**同阶段 2+ 独立任务 / 独立问题域的并行分派**时，优先复用 `/dispatching-parallel-agents` skill；单任务 subagent 或单 reviewer 子 agent 不属于该 skill 的适用场景。

**Key Architecture**: Skills-based system supporting 10+ AI coding tools through a single source of truth at `~/.agents/agent-workflow/`. Managed skills are mounted one-by-one under each tool's `skills` directory, while `commands`, `prompts`, `utils`, and `specs` remain directory-level links.

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
npm run release 2.0.0     # Explicit version
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
└── templates/               # Files synced to agents
    ├── skills/              # Skill definitions (portable across tools)
    │   ├── workflow/        # Intelligent workflow system
    │   ├── scan/            # Project scanning
    │   ├── analyze/         # Code analysis (Codex + Claude)
    │   ├── debug/           # Bug fixing workflow
    │   ├── write-tests/     # Test writing
    │   ├── diff-review/     # Code review
    │   ├── bug-batch/       # Batch bug fixing
    │   ├── dispatching-parallel-agents/ # Parallel dispatch for independent domains
    │   ├── figma-ui/        # Figma to code
    │   ├── visual-diff/     # Visual diff comparison
    │   └── perf-budget/     # Performance budget validation
    ├── commands/            # Command definitions (Claude Code specific)
    ├── prompts/             # Multi-model collaboration prompts
    │   ├── codex/           # Codex role prompts
    │   └── gemini/          # Gemini role prompts
    ├── utils/               # Utility templates
    └── specs/               # Specification documents
```

## Key Concepts

**Canonical + Managed Links Architecture:**
1. Single source of truth at `~/.agents/agent-workflow/`
2. Each AI tool keeps its own `skills` root directory, while managed skills are mounted individually from the canonical location
3. `commands`, `prompts`, `utils`, and `specs` are linked at the directory level
4. Supports both global (`~/.agents/`) and project-level (`.agents/`) installation

**Installation Flow:**
1. `postinstall.js` triggers on npm install
2. Detects installed AI coding tools (Claude Code, Cursor, Codex, etc.)
3. Copies templates to canonical location
4. Creates managed links for each tool (`skills` per-skill, other directories as direct links)
5. Tracks version in `.meta/meta.json`

**Upgrade Flow:**
1. Compares installed version with package version
2. Updates canonical location
3. All managed links automatically reflect changes
4. Backups saved to `.meta/backups/`

**Supported Agents:**
- Claude Code, Cursor, Codex, Antigravity, Droid, Gemini CLI, GitHub Copilot, Kilo Code, OpenCode, Qoder

**Template Directories:** `DIRECT_LINK_DIRS = ['commands', 'prompts', 'utils', 'specs']`, `SKILLS_DIR = 'skills'`

## Available Skills

The package includes the following skills (all portable across AI coding tools):

**Core Workflow:**
- `/workflow` - Intelligent workflow system (requirement analysis → task planning → auto execution, with planning-side review loops and execution quality gates)
  - `start` - Analyze requirements and create execution plan
  - `execute` - Run next pending task (supports `--retry`, `--skip`)
  - `delta` - Handle incremental changes (PRD updates, API sync)
  - `status` - Show workflow progress
  - `archive` - Archive completed workflows

**Development Tools:**
- `/scan` - Project scanning (tech stack detection + context report generation)
- `/analyze` - Codex-assisted analysis (Codex + Claude review)
- `/debug` - Bug fixing workflow (locate → analyze → fix → review)
- `/write-tests` - Test writing expert (unit + integration tests)

**Code Review:**
- `/diff-review` - Code review (Quick by default, `--deep` for Codex-assisted review)
- `/bug-batch` - Batch bug fixing (pull from Blueking project management)
- `/dispatching-parallel-agents` - Parallel dispatch for independent domains (independence check + boundary grouping + conflict fallback)

**UI Development:**
- `/figma-ui` - Figma design to code (visual fidelity validation)
- `/visual-diff` - UI visual diff comparison (pixel-level + semantic)

**Performance:**
- `/perf-budget` - Performance budget validation (page load, bundle size, API response)

Workflow state stored at `~/.claude/workflows/{project-hash}/` (user-level, not in git)
