# Plan: 清理已删除的 workflow.md 残留引用

## Summary

`core/commands/workflow.md` 已被删除（workflow 路由层改为由各 skill 直接入口），但 `scripts/validate.js`、`CLAUDE.md`、`README.md` 等文件仍引用它，导致 `npm run prepublishOnly` 校验失败。需要同步清理所有残留引用，使校验恢复通过。

## Metadata

- **Complexity**: Small
- **Confidence**: 9/10
- **Estimated Files**: 4 个（validate.js、CLAUDE.md、README.md、docs/compare.md）
- **Key Risk**: validate.js 中 `overviewFile` 被下游 `doc_contracts.js` 使用，删除后需提供替代或跳过该校验路径

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | `scripts/validate.js` | 213-253 | workflow 校验中对 workflow.md 的两处引用 + overviewFile 传参 |
| P0 | `scripts/validate.js` | 309-315 | overviewFile 作为 --overview 传给 doc_contracts.js |
| P0 | `scripts/validate.js` | 402-417 | team 校验中对 workflow.md 的引用 |
| P0 | `core/utils/workflow/doc_contracts.js` | 81-82,130-137 | overviewFile 的消费方，理解 overview 被移除后的影响 |
| P1 | `CLAUDE.md` | 107 | 文档中声明 workflow.md 入口 |
| P1 | `README.md` | 85-100,125-145,475-495 | 架构图、目录结构、参考列表 |

## Patterns to Mirror

### 无特殊模式

本次仅做删除/更新引用，无需新增代码或模式复用。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `scripts/validate.js` | UPDATE | L214+L220: 从 guardPaths 移除 workflow.md 必要文件检查 |
| `scripts/validate.js` | UPDATE | L253+L309-315: overviewFile 不再指向 workflow.md，改为空字符串或跳过 --overview |
| `scripts/validate.js` | UPDATE | L404+L417: team 校验中移除对 workflow.md 的 guardPaths |
| `core/utils/workflow/doc_contracts.js` | UPDATE | L81-82+L132-137: overviewFile 允许缺失/空值，不抛错 |
| `CLAUDE.md` | UPDATE | L107: 移除 "exposed from `core/commands/workflow.md`" 表述，改为描述 skill 直接入口 |
| `README.md` | UPDATE | L93: 命令路由层描述移除 workflow.md |
| `README.md` | UPDATE | L133: 目录结构移除 workflow.md 行 |
| `README.md` | UPDATE | L483: 参考链接移除 workflow.md |
| `docs/compare.md` | UPDATE | L173: 关键文件列表移除 workflow.md |
| `CHANGELOG.md` | NO-CHANGE | 历史记录，保留原样 |

---

## Tasks

### T1: validate.js — 移除 workflow 校验中的 workflow.md guardPath

- **Action**: L219-220 `guardPaths` 数组移除 `[workflowCommandFile, 'workflow command 入口']`；L214 `workflowCommandFile` 变量声明可保留或删除（看 L253 是否还需要）
- **File**: `scripts/validate.js`
- **Verify**: `node scripts/validate.js` 不再报 "workflow 缺少 workflow command 入口"

### T2: validate.js — 处理 overviewFile 引用

- **Action**: L253 `overviewFile = workflowCommandFile` 需要替代方案。两个选项：
  - **Option A（推荐）**：移除 `--overview` 参数，`doc_contracts.js` 的 `overviewDocContent` 传空串
  - **Option B**：用其他文档（如某个 skill SKILL.md）替代
  - 选 A：删掉 L253 和 L314-315，同时在 doc_contracts.js 中让 `overviewDocContent` 容忍空值
- **File**: `scripts/validate.js` + `core/utils/workflow/doc_contracts.js`
- **Verify**: `node scripts/validate.js` workflow 文档契约校验通过

### T3: validate.js — 移除 team 校验中的 workflow.md guardPath

- **Action**: L404 `workflowCommandFile` 声明删除；L417 从 `guardPaths` 移除 `[workflowCommandFile, 'workflow command 入口']`
- **File**: `scripts/validate.js`
- **Verify**: `node scripts/validate.js` 不再报 "team 缺少 workflow command 入口"

### T4: doc_contracts.js — overview 参数容忍缺失

- **Action**: L132 `args.indexOf('--overview')` 返回 -1 时返回空串而非 undefined；L81 `overviewDocContent` 为空时跳过而非报错
- **File**: `core/utils/workflow/doc_contracts.js`
- **Verify**: 单独运行 `node core/utils/workflow/doc_contracts.js workflow-contracts --cli <cliFile> --spec-template <tpl> --plan-template <tpl>` 不崩溃

### T5: 文档更新 — CLAUDE.md

- **Action**: L107 将 "exposed from `core/commands/workflow.md` and backed by specialized workflow skills" 改为直接描述 skill 入口，如 "backed by specialized workflow skills (workflow-plan, workflow-execute, workflow-delta) plus shared runtime docs"
- **File**: `CLAUDE.md`
- **Verify**: 人工审查描述准确

### T6: 文档更新 — README.md

- **Action**:
  1. L93 架构图中 `commands/workflow.md -> 路由到对应 Skill` 改为描述当前架构（skill 直接入口）
  2. L133 目录结构 `+-- commands/workflow.md` 行删除
  3. L483 参考列表中 `core/commands/workflow.md`（统一 command 入口）行删除
- **File**: `README.md`
- **Verify**: 人工审查无残留

### T7: 文档更新 — docs/compare.md

- **Action**: L173 关键判断依据列表中移除 `core/commands/workflow.md`
- **File**: `docs/compare.md`
- **Verify**: 人工审查

---

## Testing Strategy

- 主验证：`node scripts/validate.js` 全量通过，无任何 workflow/team 缺失报错
- 辅助：`npm run prepublishOnly` 通过
- 文档：确认 CLAUDE.md、README.md、compare.md 无残留 workflow.md 引用

## Risks

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |
| doc_contracts.js 的 overview 空值导致下游 validateWorkflowDocContracts 逻辑异常 | 中 | T4 中明确加空值保护，T2 + T4 联合验证 |
| README 架构图改动后格式错乱 | 低 | 对齐 ASCII art 格式 |
