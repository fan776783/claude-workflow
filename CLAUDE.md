# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@pic/claude-workflow` is an npm package that installs Claude Code workflow templates (commands, agents, docs, utils) to `~/.claude/`. It provides a CLI tool (`claude-workflow`) and automatic postinstall setup.

## Commands

```bash
# Development - validate before publish
npm run prepublishOnly    # Runs scripts/validate.js

# CLI commands (after npm install -g)
claude-workflow status    # Show installation status
claude-workflow sync      # Sync templates to ~/.claude
claude-workflow sync -f   # Force overwrite all files
claude-workflow init      # Init project config in current directory
claude-workflow doctor    # Diagnose configuration issues

# Release (auto: version bump + publish + git tag + push)
npm run release:patch     # Bug fixes: 1.0.0 -> 1.0.1
npm run release:minor     # Features: 1.0.0 -> 1.1.0
npm run release:major     # Breaking: 1.0.0 -> 2.0.0
npm run release 2.0.0     # Explicit version
```

## Architecture

```
├── bin/claude-workflow.js   # CLI entry point (commander-based)
├── lib/
│   ├── index.js             # Package exports
│   └── installer.js         # Core install/upgrade logic
├── scripts/
│   ├── postinstall.js       # Auto-runs on npm install
│   └── validate.js          # Pre-publish validation
└── templates/               # Files copied to ~/.claude/
    ├── commands/            # Slash command definitions (.md)
    ├── prompts/             # Multi-model collaboration prompts
    ├── docs/                # Documentation templates
    └── utils/               # Utility templates
```

## Key Concepts

**Template Installation Flow:**
1. `postinstall.js` triggers on npm install
2. Checks `CLAUDE_WORKFLOW_SKIP_POSTINSTALL` env var
3. Compares versions via `meta.json` in `~/.claude/.claude-workflow/`
4. Fresh install: copies all templates, saves originals for diff
5. Upgrade: 3-way merge (original → user modified → new version), conflicts saved as `.new` files
6. Downgrades: skipped (manual sync required)

**Version Tracking:**
- `~/.claude/.claude-workflow/meta.json` - installed version info
- `~/.claude/.claude-workflow/originals/` - pristine copies for upgrade diffing
- `~/.claude/.claude-workflow/backups/` - pre-upgrade backups

**Template Directories:** `TEMPLATE_DIRS = ['commands', 'agents', 'docs', 'utils']`

## Workflow Templates

The `/workflow-*` commands implement a structured development workflow:
- `/workflow-start` - Analyzes requirements, creates execution plan in `workflow-memory.json`
- `/workflow-execute` - Runs next pending step
- `/workflow-status` - Shows current progress
- Workflow state stored at `~/.claude/workflows/{project-hash}/` (user-level, not in git)
