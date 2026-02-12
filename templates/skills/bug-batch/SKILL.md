---
name: bug-batch
description: "批量缺陷修复 - 从蓝鲸项目管理平台拉取缺陷清单，逐个独立修复。触发条件：用户调用 /bug-batch，或请求批量修复缺陷、处理待办 Bug 列表、清理缺陷积压等场景。项目 ID 从 project-config.json 的 project.bkProjectId 读取（由 /scan 生成）。每个缺陷在独立 agent 上下文中使用 debug 流程修复。"
---

# 批量缺陷修复

从蓝鲸平台拉取缺陷清单，按优先级逐个修复，每个缺陷使用独立 agent 上下文。

## 用法

```
/bug-batch <operator_user>
/bug-batch fanjj
/bug-batch fanjj --state 待处理 --priority HIGH
```

**参数**：
- `operator_user`（必填）：经办人用户名
- `--state`：缺陷状态筛选，默认 "待处理"
- `--priority`：优先级筛选（HIGH/中/低），默认全部

## 前置条件

读取 `.claude/config/project-config.json` 中的 `project.bkProjectId` 作为蓝鲸项目 ID。

```json
{
  "project": {
    "id": "a1b2c3d4e5f6",
    "name": "...",
    "type": "...",
    "bkProjectId": "v10125"
  }
}
```

若 `project.bkProjectId` 为空或不存在，提示用户先执行 `/scan` 关联蓝鲸项目。

## 执行流程

```
Phase 0: 读取项目配置
Phase 1: 拉取缺陷清单
Phase 2: 获取详情 + 构建任务列表（Hard Stop）
Phase 3: 逐个独立修复（debug 流程）
Phase 4: 汇总报告
```

## Phase 0: 读取项目配置

1. 读取 `.claude/config/project-config.json`
2. 提取 `project.bkProjectId` 作为 `project_id`
3. 若为空：提示 `蓝鲸项目未关联，请先执行 /scan 完成项目关联` 并终止

## Phase 1: 拉取缺陷清单

调用 `mcp__mcp-router__list_issues` 获取缺陷列表：

```
list_issues(
  project_id: "<project.bkProjectId from config>",
  operator_user: ["<经办人>"],
  type_classify: ["BUG"],
  states: ["待处理"],      # 根据 --state 参数
  page_size: 50
)
```

过滤条件：
- 仅保留状态匹配的缺陷
- 按 `--priority` 参数筛选（如指定）

若无匹配缺陷，告知用户并终止。

## Phase 2: 获取详情 + 构建任务列表

**2.1 并行获取每个缺陷详情**：

对每个缺陷调用 `mcp__mcp-router__get_issue(issue_number)`，提取：
- 标题、描述、复现步骤
- 优先级、创建人
- 描述中内嵌的截图（如有）

**2.2 排序规则**：

| 优先级 | 排序 |
|--------|------|
| HIGH / 高 | 1 |
| 中 | 2 |
| 低 | 3 |

同优先级按创建时间正序。

**2.3 展示任务列表并等待确认**：

```
## 缺陷修复清单（项目: <project.bkProjectId>）

| # | 工单号 | 优先级 | 标题 | 经办人 |
|---|--------|--------|------|--------|
| 1 | pXXX_XXXX | HIGH | ... | ... |
| 2 | pXXX_XXXX | 中   | ... | ... |

共 N 个缺陷，按优先级排序。

## 确认开始逐个修复？(Y/N)
```

**立即终止，禁止继续执行任何操作。**

## Phase 3: 逐个独立修复

用户确认后，使用 `TaskCreate` 创建所有任务，然后**按顺序逐个修复**。

每个缺陷的修复流程：

**3.1 标记当前任务为 in_progress**。

**3.2 启动独立 agent 上下文执行 debug 流程**：

使用 `Task` 工具启动 `general-purpose` agent，传入完整的缺陷信息和 debug 流程指令：

```
Task(
  subagent_type: "general-purpose",
  description: "修复缺陷 <工单号>",
  prompt: """
  修复以下缺陷，遵循 debug 流程（问题定位 → 影响分析 → 修复 → 验证）：

  **工单号**: <issue_number>
  **标题**: <title>
  **描述**: <description>
  **优先级**: <priority>

  执行步骤：
  1. 使用 codebase-retrieval 检索相关代码
  2. 分析根本原因
  3. 评估影响范围（依赖链 + 测试覆盖）
  4. 实施最小化修复
  5. 运行相关测试验证
  6. 输出修复摘要（修改文件、根因、方案）

  约束：最小改动原则，禁止大范围重构。
  """
)
```

**3.3 收集修复结果**，标记任务为 completed 或保持 in_progress（如失败）。

**3.4 向用户汇报单个缺陷修复结果后，继续下一个**。

## Phase 4: 汇总报告

全部缺陷处理完成后，输出汇总：

```
## 批量修复报告

### 修复统计
- 总数: N
- 成功: X
- 失败: Y

### 修复详情
| # | 工单号 | 状态 | 修改文件 | 根因摘要 |
|---|--------|------|----------|----------|
| 1 | pXXX   | ✅   | a.ts, b.vue | 状态未重置 |
| 2 | pXXX   | ❌   | -        | 需人工介入 |

### 失败项（如有）
- pXXX_XXXX: <失败原因>
```

## 关键原则

1. **配置驱动** — 项目 ID 从 config 读取，不硬编码
2. **独立上下文** — 每个缺陷在独立 agent 中修复，避免上下文污染
3. **顺序执行** — 按优先级逐个处理，非并行（避免文件冲突）
4. **用户确认** — 任务列表展示后必须获得确认才开始修复
5. **最小改动** — 每个修复遵循 debug 流程的最小改动原则
6. **失败容错** — 单个缺陷修复失败不阻塞后续任务
