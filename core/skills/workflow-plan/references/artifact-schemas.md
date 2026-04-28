# 工件参考

> 规划阶段产出的 JSON 工件概览。当前仅保留 `analysis-result.json` 一份工件；讨论记录、UX 设计、PRD 覆盖率已改为写入 spec.md 或即时计算，不再落盘为独立 JSON。

## 工件总览

| 工件 | 产出阶段 | 创建方式 | 路径 |
|------|---------|---------|------|
| analysis-result.json | Step 2 代码分析 | **AI 写入** | `~/.claude/workflows/{projectId}/` |

**已废弃工件**（历史归档，不再生成）：

- ~~`discussion-artifact.json`~~ → 合并入 spec.md § 9 Open Questions & Dependencies
- ~~`ux-design-artifact.json`~~ → 合并入 spec.md § 4.4 UX Design；触发标记通过 `workflow-state.json` 的 `ux_design.ux_gate_required` 读取
- ~~`prd-spec-coverage.json`~~ → self-review 时即时计算 PRD ↔ Spec 覆盖率，不再持久化

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

