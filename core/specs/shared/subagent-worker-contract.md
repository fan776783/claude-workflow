# Subagent Worker Contract

This contract defines the shared worker-level rules used by skills that launch a subagent, Codex task, or other isolated worker. Scenario-specific files may add stricter rules, but must not weaken these invariants.

## Roles

| Role | Purpose | Mutation policy |
|---|---|---|
| `read_only_worker` | Independent investigation, evidence collection, or verification. | Never mutates files, dependencies, git state, runtime state, or external systems. |
| `write_serial_worker` | One bounded implementation unit. | May mutate only declared `allowed_write_paths`; only one writer may run at a time. |
| `oracle_advisor` | Read-only second opinion for hard reasoning, risk analysis, or alternative design evaluation. | Produces candidate findings only; never patches directly. |
| `reviewer` | Read-only quality or acceptance audit. | Reviews scoped diff/evidence; never edits, formats, commits, or broadens scope. |

## Prompt Required Fields

Every worker prompt should make these fields explicit when the role applies:

- `Outcome`: the concrete result expected from the worker.
- `Scope`: included files, domains, task ids, or diff range.
- `Allowed actions`: read-only, write-serial, verification-only, or other explicit action set.
- `Non-goals`: what the worker must not inspect, change, or decide.
- `Evidence requirements`: file:line, command output, diff range, or other proof expected in the final response.
- `Final output schema`: machine-readable shape or compact report format.
- `Stop conditions`: `BLOCKED`, `NEEDS_CONTEXT`, scope expansion, verification failure, or schema failure.

## Invariants

- Read-only workers never mutate files, dependencies, git state, long-running runtime state, or external systems.
- Write workers are single-writer and must declare `allowed_write_paths` before editing.
- A worker that needs to exceed its scope must stop and report the scope gap instead of expanding silently.
- Oracle outputs are candidate findings, not verdicts; the controller verifies before action.
- Reviewer outputs are audit results, not implementation authority.
- The controller owns context curation, verification, integration, and the final user-facing result.
- Parallelism is allowed for independent read-only work only. Writable work stays serial unless a scenario-specific document declares an explicit, user-approved exception.
