# 工件参考

> 规划阶段产出的 JSON 工件概览。除 `analysis-result.json` 外，其余工件由 CLI 自动创建和管理。

## 工件总览

| 工件 | 产出阶段 | 创建方式 | 路径 |
|------|---------|---------|------|
| analysis-result.json | Step 2 代码分析 | **AI 写入** | `~/.claude/workflows/{projectId}/` |
| discussion-artifact.json | Step 3 需求讨论 | CLI `start` 自动创建 | `~/.claude/workflows/{projectId}/` |
| ux-design-artifact.json | Step 4 UX 设计 | CLI `start` 自动创建 | `~/.claude/workflows/{projectId}/` |
| prd-spec-coverage.json | Step 5 Spec 生成 | CLI `start` 自动创建 | `~/.claude/workflows/{projectId}/` |

---

## analysis-result.json（AI 写入）

代码分析后由 AI 持久化到工作流目录，后续阶段从文件加载避免重复分析。

```json
{
  "created_at": "2026-04-10T10:00:00Z",
  "source": "phase-0-code-analysis",
  "relatedFiles": [
    { "path": "src/services/auth.ts", "purpose": "需修改以支持 OAuth", "reuseType": "modify" }
  ],
  "reusableComponents": [
    { "path": "src/utils/validators.ts", "description": "通用校验函数", "purpose": "可复用" }
  ],
  "patterns": [
    { "name": "Repository Pattern", "description": "数据访问层使用 *Repo 类封装" }
  ],
  "constraints": ["数据库 PostgreSQL 15 + Prisma"],
  "dependencies": [
    { "name": "prisma", "type": "external", "reason": "ORM" }
  ]
}
```

`relatedFiles[].reuseType`: `modify | reference | extend`。`dependencies[].type`: `internal | external`。

---

## CLI 自动管理的工件

以下工件由 `node utils/workflow/workflow_cli.js start` 自动创建，AI **不需要手动构造 JSON**。

### discussion-artifact.json

需求讨论产物。CLI 通过 `planning_gates.js → buildDiscussionArtifact()` 创建。

包含：`clarifications`（澄清列表，每项有 dimension/question/answer/impact）、`selectedApproach`（选定方案，含 rejectedAlternatives）、`unresolvedDependencies`（未就绪依赖）。

### ux-design-artifact.json

UX 设计审批产物。CLI 自动创建骨架，含 `flowchart`（Mermaid 流程图 + ≥3 场景）、`pageHierarchy`（L0/L1/L2 页面分层 + 导航结构）、`detectedWorkspaces`。

### prd-spec-coverage.json

PRD↔Spec 覆盖率报告。CLI 通过 `lifecycle_cmds.js → buildPRDCoverageReport()` 创建。

包含：`totalSegments`、`covered`/`partial`/`uncovered` 统计、`coverageRate`（目标 ≥ 0.9）、`segments[]`（每段的状态、匹配章节、缺失细节、高风险标记）。

> 读取这些工件时直接 `JSON.parse()` 即可。字段结构见 CLI 源码 `utils/workflow/planning_gates.js` 和 `utils/workflow/lifecycle_cmds.js`。
