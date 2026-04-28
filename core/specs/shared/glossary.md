# Glossary

Canonical vocabulary for this repo. All **normative** documents must use the canonical English spellings below. Chinese narrative prose (CLAUDE.md, README, `core/docs/**`) is exempt and may use natural translations.

Inspired by `mattpocock/skills` 的 `improve-codebase-architecture/LANGUAGE.md` — 一致的术语是 skill 体系可读性的前提。

## Scope

**Normative (lint will scan)**:
- `core/skills/**/SKILL.md`
- `core/skills/**/references/**.md`
- `core/commands/*.md`
- `core/specs/**/*.md`

**Exempt (lint will skip)**:
- `core/CLAUDE.md`
- `README.md`, `CHANGELOG.md`
- `core/docs/**`
- Fenced code blocks, URLs, `` `inline code` ``, and lines ending with `// glossary-allow`

## Escape hatch

If a specific occurrence is intentional (e.g. quoting an external source, historical comment), append `// glossary-allow` to the end of the line.

## Terms

### workflow
**Definition**: One full plan → execute → review → archive lifecycle; state persisted under `~/.claude/workflows/{projectId}/`.
**Forbidden synonyms**: `工作流`, `流程`
**See**: `core/specs/workflow/state-machine.md`

### skill
**Definition**: Smallest distributable unit under `core/skills/<name>/`, containing `SKILL.md` + optional `references/`.
**Forbidden synonyms**: `插件`
**Note**: `模板` means "template" in this repo (e.g. layer-index-template) — it is **not** a synonym for skill and is not flagged.
**See**: `core/specs/platform-parity.md`

### subagent
**Definition**: A child Claude session spawned via the Agent tool, with an isolated context window.
**Forbidden synonyms**: `子 agent`, `子代理`, `child agent`
**See**: `core/specs/workflow/subagent-routing.md`

### pkg
**Definition**: Top-level organizational unit under `.claude/code-specs/{pkg}/`; maps to one package in a monorepo (or the repo root for single-package projects).
**Forbidden synonyms**: (none — narrative 包 is allowed)
**See**: `core/specs/spec-templates/index-template.md`

### layer
**Definition**: Second-level organizational unit under `.claude/code-specs/{pkg}/{layer}/`; maps to an architectural layer inside a pkg (controller / service / repo / etc.).
**Forbidden synonyms**: `分层`
**Note**: In architectural context within normative docs, prefer `layer`. Narrative Chinese `层` in exempt files is fine.
**See**: `core/specs/spec-templates/layer-index-template.md`

### module
**Definition**: A unit of code with an interface and implementation — function, class, package slice. Not the same as `pkg` (which is a code-specs organizational concept).
**Forbidden synonyms**: `模块` (in normative sections only)
**See**: `core/specs/guides/code-reuse-checklist.md`

### convention
**Definition**: A `convention.md` file under code-specs describing *how to write* something in this project (style, pattern).
**Forbidden synonyms**: `约定`
**See**: `core/specs/spec-templates/convention-template.md`

### contract
**Definition**: A `contract.md` file under code-specs describing *input/output guarantees* of a module — validation, error matrix, invariants.
**Forbidden synonyms**: `契约` (in normative sections only)
**See**: `core/specs/spec-templates/code-spec-template.md`

### quality-gate
**Definition**: Automatic validation gate at the end of each execute task (verification, review, spec compliance).
**Forbidden synonyms**: `门禁`, `质量检查`
**See**: `core/specs/workflow/quality-gate.md`

### post-execute
**Definition**: Pipeline triggered after each task completes — runs verification, commit, formatting, cleanup.
**Forbidden synonyms**: `后置`, `after-hook`
**See**: `core/specs/workflow/state-machine.md`

### spec
**Definition**: The document produced by `/workflow-plan` describing what a workflow will build. Distinct from "code-spec" (entries under `.claude/code-specs/`).
**Forbidden synonyms**: (none — but do not conflate with "code-spec")
**See**: `core/specs/workflow-templates/spec-template.md`

### plan
**Definition**: The document produced after spec approval describing the executable task list. Distinct from implementation planning in conversation.
**Forbidden synonyms**: (none)
**See**: `core/specs/workflow-templates/plan-template.md`

### hook
**Definition**: A shell/script callback registered in `settings.json` and executed by the agent harness on lifecycle events (PreToolUse, SessionStart, etc.).
**Forbidden synonyms**: `钩子` (in normative sections only)
**See**: `core/hooks/`

### delta
**Definition**: An incremental change to an existing workflow's spec/plan, handled by `/workflow-delta`.
**Forbidden synonyms**: `增量`, `变更`
**See**: `core/skills/workflow-delta/SKILL.md`

### archive
**Definition**: The terminal state of a workflow after `/workflow-archive`; workflow state moved to `~/.claude/workflows/{projectId}/archive/`.
**Forbidden synonyms**: `归档` (in normative sections only)
**See**: `core/skills/workflow-archive/SKILL.md`

### review
**Definition**: The quality audit step — either mid-execute (`workflow-review`) or PR-scoped (`diff-review` / `session-review`).
**Forbidden synonyms**: `审查` (in normative sections only)
**See**: `core/specs/workflow/review-loop.md`

### glossary
**Definition**: This file. Framework-level canonical vocabulary.
**Forbidden synonyms**: `术语表` (in normative sections only)

### pre-flight
**Definition**: The read-before-touch-code protocol in `core/specs/shared/pre-flight.md`. Distinct from `workflow-runtime/preflight.md`, which is runtime startup checks.
**Forbidden synonyms**: `前置协议`
**Note**: `预检` is the legitimate Chinese term used by the runtime preflight file and its references; it is **not** flagged. Use `pre-flight` when referring specifically to the shared read-before-code protocol in this file.
**See**: `core/specs/shared/pre-flight.md`

## Fixing a drift warning

If `scripts/validate.js` emits `[glossary-drift] path:line — "X" should be "Y"`:

1. Replace `X` with `Y` on that line.
2. If the occurrence is intentional (quoting external material, historical reference), append ` // glossary-allow` to the line.
3. If you believe the forbidden synonym should become canonical, open a PR that edits this file, not just the individual hit.
