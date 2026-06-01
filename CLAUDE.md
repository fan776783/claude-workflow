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
agent-workflow sync      # Sync templates to every detected AI coding tool
agent-workflow link      # Symlink core/ into detected mount-tools (Claude Code & Qoder use Plugin; dev: `claude --plugin-dir <repo>/core` / `qodercli --plugin-dir <repo>/core`)
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
    │   ├── _shared/         # Cross-skill private modules (NOT a skill; _*/ prefix never mounted)
    │   ├── workflow-spec/   # Spec generation entry for /workflow-spec
    │   ├── workflow-plan/   # Plan generation entry for /workflow-plan
    │   ├── workflow-execute/# Execution entry for /workflow-execute
    │   ├── workflow-review/ # Review protocol entry for workflow quality gates
    │   ├── workflow-delta/  # Delta entry for /workflow-delta
    │   ├── workflow-status/ # Status entry for /workflow-status
    │   ├── workflow-archive/# Archive entry for /workflow-archive
    │   ├── scan/            # Project scanning
    │   ├── fix-bug/         # Bug fixing workflow
    │   ├── diff-review/     # Code review
    │   ├── bug-batch/       # Batch bug fixing
    │   ├── dispatching-parallel-agents/ # Parallel dispatch for independent domains
    │   ├── spec-*/          # Code-specs compliance engine (bootstrap/review/update)
    │   ├── ux-elaboration/  # Frontend UX design elaboration (§4.4)
    │   ├── figma-data/      # Figma MCP data acquisition + asset triage
    │   ├── figma-ui/        # Figma to web code (consumes figma-data)
    │   ├── bk/              # MCP wrapper: 蓝鲸 CTeam / vTeam CLI
    │   └── alidocs/         # MCP wrapper: 钉钉文档 / 表格 / AI 表格
    ├── commands/            # Command entry definitions
    ├── utils/               # Internal runtime utilities
    ├── docs/                # Supporting docs and templates
    ├── hooks/               # Hook scripts (installed under .agent-workflow/)
    └── specs/               # Specification documents
```

**`_*/` 前缀目录约定**：`core/skills/` 下划线前缀目录 = 跨 skill 私有共享模块入口，**非 user-facing skill**。`lib/installer.js` / `core/utils/platform_parity.js` / `scripts/validate.js` 三处统一按 `_*` 前缀过滤——不会被 mount 为 skill，也不计入 platform-parity 检查。跨 skill 引用走相对路径（如 `../../_shared/mcp-baseline.mjs`），不要走 npm 包 / canonical 路径。

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
- **Plugin-managed**（原生 Plugin 机制，非 installer mount）：Claude Code（`lib/claude-code-plugin.js`）、Qoder（`lib/qoder-plugin.js`，`qodercli plugins install`）。其余 7 个工具走 installer 逐 skill mount。

**Template Directories:** `core/{skills,commands,utils,specs,hooks,docs}`, with Agent-visible projections limited to `skills/`, `commands/agent-workflow/`, and `.agent-workflow/`

## Available Skills

Skills are the portable unit shipped to each AI tool. The authoritative list lives under `core/skills/` — every directory there is a published skill. A few skill families worth knowing when navigating the repo:

- **Workflow state machine** (`workflow-spec`, `workflow-plan`, `workflow-execute`, `workflow-review`, `workflow-delta`, `workflow-status`, `workflow-archive`) — phased lifecycle with spec/plan artifacts and quality gates. `workflow-spec` handles requirement analysis through spec approval; `workflow-plan` handles plan generation from approved specs. State lives under `~/.claude/workflows/{project-hash}/`.
- **Code Specs** (`spec-bootstrap`, `spec-update`, `spec-review`) — declarative 7-section code-spec contract; `.claude/code-specs/{pkg}/{layer}/` layout + shared `guides/`; no machine-readable blocking rules (review is human-driven).
- **Lightweight planning & review** — `quick-plan` (migrated to skill from command), `diff-review` (supports `--session` mode; replaces old `session-review`), `fix-bug`, `bug-batch`, `diagnose`.
- **Design elaboration** — `ux-elaboration` (前端设计深化: User Flow + Page Hierarchy + Layout Anchors → §4.4). 从 `workflow-spec` Step 5 剥离为独立原子 skill，可被 workflow-spec 委托调用或用户独立触发。
- **Alignment & architecture** — `grill` (interview-until-alignment, replaces `enhance`), `zoom-out` (7-line abstraction escape hatch), `tdd` (red-green-refactor discipline), `write-a-skill` (meta-skill for creating new skills).
- **Dispatch & research** — `dispatching-parallel-agents`, `research` (merged `search-first` + `deep-research`), `collaborating-with-codex`.
- **Figma pipeline** — `figma-data` (MCP 数据获取 + 资源分诊 → Design Package), `figma-ui` (消费 Design Package → Web 代码还原 + 验证)。`ux-elaboration` 的布局提取也调用 `figma-data`。
- **MCP wrappers** — `bk` (蓝鲸 CTeam/vTeam), `alidocs` (钉钉文档/表格/AI 表格), `figma-data` (Figma Dev MCP)。三者通过 `core/skills/_shared/mcp-baseline.mjs` 共享 tool snapshot / shape 解析 / 错误归一化（三桶 `tool_not_found=5` / `enum_invalid=6` / `auth=2`），通过 checkin baseline + `<cli> diff-tools` 主动检测上游漂移。详见 `.claude/code-specs/adr/0001-mcp-wrapper-skill-drift-resilience.md`。
- **Other** — `scan`, `api-smoke` (前端视角从 spec + YApi autogen 生成后端接口冒烟脚本,覆盖正常 + 异常场景).
- **Project-level 3-stage R&D flow** — `design-plan` (Stage 1:跨服务复杂需求 → 8 章节技术方案 → Hard Stop 评审 → 落盘 `docs/designs/{slug}-{YYYYMMDD}.md`), `plan-archive` (Stage 3:实施后跨服务 git log/diff → 对照 `AGENTS.md § Project Doc Update Triggers` 回写架构文档 → Hard Stop 预览后逐文件落盘)。两个 skill 独立于 workflow 状态机,手动触发,典型用户为技术主管 / 资深研发,Stage 2 各模块编码继续走 `/workflow-spec` `/workflow-execute`。
- **Shared protocols (`core/specs/shared/`)** — `glossary.md` / `architecture-language.md` / `business-glossary.md` (terms), `adr-protocol.md` / `hard-stop-templates.md` / `manual-intervention-reasons.md` / `status-readiness.md` / `codex-routing.md` / `impact-analysis-template.md` / `out-of-scope-protocol.md` (跨 skill 协议，引用而非复写), `pre-flight.md` (协议索引) + `workflow-cli.md` (CLI 契约).

`/team` 命令直接走 Claude Code 原生 Agent Teams，不再有独立 skill 或 runtime；`core/commands/team.md` 负责命令契约，`core/hooks/team-idle.js` 与 `core/hooks/team-task-guard.js` 提供任务板守门和 cleanup 协调。

When updating this section, re-check `core/skills/` rather than trusting this list — it drifts.

Workflow state stored at `~/.claude/workflows/{project-hash}/` (user-level, not in git).
