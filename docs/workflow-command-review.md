# UX-Focused Code Review: Workflow Commands

## Executive Summary
The workflow commands (`workflow-start` and `workflow-execute`) exhibit significant over-engineering that negatively impacts both the user experience (UX) and developer experience (DX). The current implementation suffers from "dialog fatigue," brittle custom logic (templating, parsing), and redundant safety checks that obscure the core functionality.

## 1. UX Impact Analysis

### 🚨 Critical UX Issues

*   **Dialog Fatigue (High Impact):**
    *   **Observation:** `workflow-start` interrupts the user **4 times** before real work begins (Task Conflict → File Conflict → Design Confirmation → Task Confirmation).
    *   **Impact:** Users will learn to blindly press "Confirm" or "Y", defeating the purpose of safety checks. This stops being a "workflow" and becomes a "wizard" that requires constant babysitting.
    *   **Risk:** Users might accidentally confirm a destructive action because they are conditioned to just "click through."

*   **Fragile "Magic" Behavior (High Impact):**
    *   **Observation:** `workflow-execute` infers actions based on fragile string matching (e.g., checking for "Store" or "Composable").
    *   **Impact:** When the magic fails (e.g., a user writes a task that doesn't use those specific words), the workflow breaks or defaults to the wrong action (`create_file`). This makes the tool feel unpredictable.

*   **Confusing "Backend" Flag (Medium Impact):**
    *   **Observation:** The `--backend` flag is largely redundant since file paths are auto-detected.
    *   **Impact:** Increases cognitive load. Users have to remember *how* to invoke the command rather than just providing their intent. "Why do I need to say --backend if I'm pointing to a file?"

### ⚠️ DX/Maintenance Issues

*   **Dual Template System:** Maintaining two versions of every template (one external, one hardcoded in JS) guarantees drift. The fallback logic is 80+ lines of dead weight.
*   **Custom Template Engine:** Implementing a poor man's Handlebars (Regex-based `{{#each}}`) is error-prone and hard to debug. It lacks proper syntax error reporting.
*   **Hardcoded Phase Logic:** Logic like `id <= 8` for Phase 0 is arbitrary and will break as soon as a project deviates from the "standard" size.

## 2. Simplification Recommendations

### A. Streamline User Interaction
*   **Eliminate Pre-Confirmation:** Remove the "Design Confirmation" and "Task Confirmation" dialogs. The user can review the files *after* generation if they want. If they run the command, they likely want the output.
*   **Use Flags for Safety:** Instead of asking "File exists, overwrite?", default to safe behavior (fail or backup) and allow a `--force` flag.
    *   *Old:* Interactive dialog.
    *   *New:* `Error: 'tech-design.md' exists. Use --force to overwrite.`

### B. Standardize Templating
*   **Remove Custom Engine:** Use JavaScript's native template literals (backticks) for simplicity, or a tiny standard library if logic is complex.
*   **Single Source of Truth:** Embed templates directly in the command file (if small) or strictly require external files. Do not support both. If external files are missing, the command should fail fast (or download them), not fallback to a hardcoded version.

### C. Improve Action Determinism
*   **Explicit Action Definitions:** Require the LLM/User to define actions explicitly in the `tasks.md` frontmatter or metadata, rather than guessing based on keywords like "Store".
*   **Default to "Reasoning":** If an action isn't clear, the default should be to *ask* or *analyze*, not to blind-create a file.

## 3. Priority Ranking

| Rank | Issue | UX Impact | Effort to Fix | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **P0** | **Too Many Dialogs** | 🔴 Critical | 🟢 Low | Remove "Design" & "Task" confirmations. Merge "Existing File" checks. |
| **P1** | **Unreliable Inference** | 🔴 Critical | 🟡 Medium | Remove `inferActions` & `determinePhase`. Rely on LLM generation for metadata. |
| **P2** | **Dual Template System** | 🟡 Medium | 🟢 Low | Delete fallback code. Fail if external template missing. |
| **P3** | **Custom Template Engine** | 🟡 Medium | 🟡 Medium | Replace with JS Template Literals. |
| **P4** | **Redundant `--backend`** | ⚪ Low | 🟢 Low | Remove flag logic; rely purely on file extension detection. |

## 4. Code Organization Suggestions

### Extract Shared Utilities
Create a `workflow-utils.js` (or similar shared module) for:
1.  **Validation:** `validateTaskId`, `validatePath`, `validateProjectConfig`.
2.  **State Management:** Reading/Writing `workflow-state.json`.
3.  **Parsing:** `extractCurrentTask` and `updateTaskStatusInMarkdown`.

### Refactor Action Logic
Instead of `workflow-execute.md` containing all execution logic, simplify it to:
1.  Read Task.
2.  Load Context.
3.  **Delegate to Agent:** Pass the task context to the AI Agent and let *it* decide the tool calls (Create, Edit, Test).
    *   *Current:* Command decides `create_file` -> prints instructions -> AI follows.
    *   *Better:* Command provides context -> AI decides `WriteFile(...)`.

### Example: Simplified `workflow-start` Flow
```javascript
// 1. Parse Args (No --backend flag needed)
const requirement = parseArgs();

// 2. Analyze (Phase 0)
const analysis = await analyzeCodebase(requirement);

// 3. Generate Design (Phase 1)
// No dialogs. If file exists, error out unless --force.
await generateTechDesign(analysis); 

// 4. Generate Tasks (Phase 2)
// No dialogs. 
await generateTasks();

// 5. Done.
console.log("Ready to execute. Run /workflow-execute to start.");
```
