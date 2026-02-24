---
name: workflow
description: "智能工作流系统 - 需求分析、任务规划与自动化执行。显式调用：/workflow action [args]。Actions: start（启动规划）、execute（执行任务）、delta（增量变更/API同步）、status（查看状态）、archive（归档）。此 skill 不会自动触发，需用户明确调用。v3.3.2 新增：验证清单生成系统，自动将结构化需求转换为可执行的验收项，指导任务实现和验收测试。"
---

# 智能工作流系统 (v3.3.2)

结构化开发工作流：需求分析 → 技术设计 → 任务拆分 → 自动执行。

## 设计理念

```
workflow（功能）  ──▶  figma-ui（视觉）  ──▶  visual-diff（验证）
       │
  api_spec 阻塞
```

**职责分离**：workflow 专注业务逻辑和数据流，只阻塞 API 依赖。设计稿还原通过独立的 `/figma-ui` skill 处理。

## 🆕 v3.3.2 新特性：验证清单生成系统

在需求结构化提取（Phase 0.5）之后，自动生成详细的验证清单（Phase 0.6），包含：

- **表单字段验证**：必填、格式、长度、联动等验证项 + 测试数据
- **角色权限验证**：可见性、可操作性、数据范围等验证项 + 测试步骤
- **交互行为验证**：触发条件、响应行为、提示信息等验证项
- **业务规则验证**：条件判断、联动逻辑、唯一性等验证项 + 测试场景
- **边界场景验证**：空状态、异常处理、降级方案等验证项
- **UI展示验证**：布局、样式、响应式、文本截断等验证项 + 视觉检查点
- **功能流程验证**：步骤完整性、分支逻辑、入口路径等验证项

**验证清单特点**：
- 自动关联到任务：每个任务自动关联相关的验收项
- 结构化组织：按场景、角色、功能模块分组
- 可执行性强：包含测试数据、测试步骤、测试场景
- 持久化存储：生成独立的 `acceptance-checklist.md` 文件

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
需求 ──▶ 代码分析 ──▶ 需求结构化 ──▶ 验证清单 ──▶ tech-design.md ──▶ Intent Review ──▶ tasks.md ──▶ 执行
             │              │              │                   │                │
        codebase-       🛑 确认设计    📋 生成验收项      🔍 审查意图      🛑 确认任务
        retrieval
```

## 文件结构

```
项目目录/
├── .claude/
│   ├── config/project-config.json     ← /scan 生成
│   ├── tech-design/{name}.md          ← 技术方案
│   └── acceptance/{name}-checklist.md ← 验证清单 (v3.3.2)

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
