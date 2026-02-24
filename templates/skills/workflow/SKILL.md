---
name: workflow
description: "智能工作流系统 - 需求分析、任务规划与自动化执行。显式调用：/workflow action [args]。Actions: start（启动规划）、execute（执行任务）、delta（增量变更/API同步）、status（查看状态）、archive（归档）。此 skill 不会自动触发，需用户明确调用。"
---

# 智能工作流系统 (v3.1)

结构化开发工作流：需求分析 → 技术设计 → 任务拆分 → 自动执行。

## 设计理念

```
workflow（功能）  ──▶  figma-ui（视觉）  ──▶  visual-diff（验证）
       │
  api_spec 阻塞
```

**职责分离**：workflow 专注业务逻辑和数据流，只阻塞 API 依赖。设计稿还原通过独立的 `/figma-ui` skill 处理。

## 调用方式

```bash
/workflow start "需求描述"              # 启动新工作流
/workflow start docs/prd.md            # 自动检测 .md 文件
/workflow start -f "需求"              # 强制覆盖已有文件

/workflow execute                       # 执行下一个任务（默认阶段模式）
/workflow execute --retry              # 重试失败的任务
/workflow execute --skip               # 跳过当前任务（慎用）

/workflow status                        # 查看当前状态
/workflow status --detail              # 详细模式

# 增量变更（自动识别类型，统一入口）
/workflow delta                                 # 执行 ytt 生成 API
/workflow delta docs/prd-v2.md                  # PRD 更新
/workflow delta 新增导出功能，支持 CSV 格式     # 需求补充
/workflow delta packages/api/.../teamApi.ts     # API 变更 → 自动解除阻塞

/workflow archive                       # 归档已完成的工作流
```

## 自然语言控制

执行时可描述意图：

| 用户说 | 系统理解 |
|--------|----------|
| "单步执行" | step 模式 |
| "继续" / "下一阶段" | phase 模式（默认） |
| "执行到质量关卡" | quality_gate 模式 |
| "重试" / "跳过" | retry / skip 模式 |

## 工作流程

```
需求 ──▶ 代码分析 ──▶ 需求结构化 ──▶ tech-design.md ──▶ Intent Review ──▶ tasks.md ──▶ 执行
             │              │                   │                │
        codebase-       🛑 确认设计        🔍 审查意图      🛑 确认任务
        retrieval
```

## 文件结构

```
项目目录/
└── .claude/
    ├── config/project-config.json     ← /scan 生成
    └── tech-design/{name}.md          ← 技术方案

~/.claude/workflows/{projectId}/
├── workflow-state.json                ← 运行时状态
├── tasks-{name}.md                    ← 任务清单
└── changes/                           ← 增量变更
    └── CHG-001/
        ├── delta.json
        ├── intent.md
        └── review-status.json
```

## 状态机

| 状态 | 说明 |
|------|------|
| `planned` | 规划完成，等待执行 |
| `running` | 执行中 |
| `blocked` | 等待外部依赖 |
| `failed` | 任务失败 |
| `completed` | 全部完成 |

## References

| 模块 | 路径 |
|------|------|
| start | [references/start.md](references/start.md) |
| execute | [references/execute.md](references/execute.md) |
| delta | [references/delta.md](references/delta.md) |
| status | [references/status.md](references/status.md) |
| archive | [references/archive.md](references/archive.md) |
| 外部依赖 | [references/external-deps.md](references/external-deps.md) |
| 状态机 | [references/state-machine.md](references/state-machine.md) |
| 共享工具 | [references/shared-utils.md](references/shared-utils.md) |

## 前置条件

执行 `/workflow start` 前需确保：
1. **项目已扫描**: 执行 `/scan` 生成 `.claude/config/project-config.json`
2. **需求明确**: 提供清晰的需求描述或 PRD 文档
