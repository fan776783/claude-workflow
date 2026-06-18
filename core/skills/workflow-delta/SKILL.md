---
name: workflow-delta
description: "Use when 用户调用 /workflow-delta, or 已有 workflow 出现需求/PRD/API 变化需要影响分析与并入。"
disable-model-invocation: true
---

> 路径 convention 见 [`../../specs/shared/workflow-cli.md`](../../specs/shared/workflow-cli.md)。当 delta 跨到新 `{pkg}/{layer}` 时,Read 新涉及 layer 的 `.claude/code-specs/{pkg}/{layer}/index.md`。

# workflow-delta

<HARD-GATE>
1. delta 未经用户确认(Hard Stop),不得应用到 spec.md / plan.md(sync 模式例外,自动应用)
2. delta 文档(`delta.json` + `intent.md`)必须在状态 delta 前写入(先审计后生效)
3. 占位路径(`__PLACEHOLDER__`)必须在用户确认前替换为真实路径
</HARD-GATE>

## Checklist

1. ☐ 智能解析输入
2. ☐ 加载 workflow 状态
3. ☐ 初始化 delta 记录(CLI)
4. ☐ 分析 delta 影响
5. ☐ 🛑 delta 确认(Hard Stop,sync 模式跳过)
6. ☐ 应用 delta(CLI)
7. ☐ 生成 delta 摘要

## Step 1: 智能解析输入

| 输入形式 | delta 类型 | 示例 |
|----------|----------|------|
| 无参数 | `sync` — 执行项目配置的 API 同步命令 | `/workflow-delta` |
| `.md` 文件(已存在) | `prd` — PRD 文件更新 | `/workflow-delta docs/prd-v2.md` |
| API 文件路径(`Api.ts` / `autogen/` / `.api.ts`) | `api` — API 规格 delta | `/workflow-delta packages/api/.../teamApi.ts` |
| 其他文本 | `requirement` — 需求描述 | `/workflow-delta 新增导出功能` |

CLI 已内置识别逻辑。意图不明确时调 `AskUserQuestion`,question 写"本次 delta 属于哪种类型?",options 给 4 条:`sync` / `api` / `prd` / `requirement`。收到选择再继续。

## Step 2: 加载 workflow 状态

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
```

前置:workflow 必须存在(非 `archived`);读取 spec.md、plan.md 路径。

## Step 3: 初始化 delta 记录(CLI)

```bash
# sync 模式:一步完成 init + apply + unblock
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta sync --dependency api_spec

# 其他模式:先 init,后续分步
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta init \
  --type <sync|api|prd|requirement> \
  --source <来源文件或描述> \
  --description <变更摘要>
```

CLI 自动:生成 `CHG-XXX` ID → 创建 `changes/CHG-XXX/` → 写入 `delta.json`、`intent.md`、`review-status.json` → 更新 `workflow-state.json` 的 `delta_tracking`。

**sync 模式特殊路径**:
1. 先执行项目配置的 API 同步命令(如 `pnpm ytt`),确认成功
2. 调 `delta sync` 自动完成 init + 解除阻塞 + 写入审计 + 持久化
3. **跳过 Step 4-5**,直接到 Step 7

API 同步命令失败 → 调 `delta fail` 记录失败态后退出。

## Step 4: 分析 delta 影响

AI 负责分析,**不负责持久化**。

### API delta(type: api)

1. 读取指定 API 文件
2. 读取 `state.api_context.interfaces`(旧接口)
3. 对比新旧接口:**新增接口** → 建议新增任务(接入 + 集成);**删除接口** → 建议废弃相关任务;**修改接口** → 建议更新相关任务的 steps
4. 检查已完成任务是否受影响(回归风险 → risk_level 提升为 `high`)

### PRD delta(type: prd)

1. 读取 PRD 文件内容
2. 读取 `spec.md` 的现有需求
3. 对比需求变化:**新增需求** → 按类型生成任务(form_field / business_rule / ui_component);**删除需求** → 建议废弃;**修改需求** → 建议更新
4. 检查已完成任务的回归风险

### 需求描述(type: requirement)

1. 分析需求描述文本
2. 用代码检索能力识别受影响 module 和文件
3. 生成新增/修改任务建议
4. **启发式降级**:代码检索不可用 → 基于现有任务关键词匹配推断受影响文件,risk_level 至少 `medium`

### 记录影响分析

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta impact \
  --change-id CHG-XXX \
  --tasks-added 3 --tasks-modified 2 --tasks-removed 1 \
  --risk-level medium
```

### 输出格式

向用户展示 delta 摘要应包含:新增任务(ID/名称/阶段/文件)、修改任务(ID/delta 说明/before-after)、废弃任务(ID/原因)、受影响文件、风险等级、预估工作量。

**风险估算规则**:删除 > 3 个接口/需求 → `high`;删除 > 0 或修改 > 5 → `medium`;已完成任务受影响 → 无条件 `high`;其他 → `low`。
**工作量估算**:0 任务 → <1h / 1-2 → 1-2h / 3-5 → 2-4h / 6-10 → 4-8h / >10 → 1-2d。

## Step 5: 🛑 delta 确认(Hard Stop)

**sync 模式跳过**。

执行安全检查:阅读 [`references/delta-safety-checklist.md`](references/delta-safety-checklist.md) 并逐项检查。

展示 delta 摘要后调 `AskUserQuestion`,question 写"如何处理本次 delta?",options 三条:
- `apply` — 应用 delta:进入 Step 6(占位路径必须先替换)
- `manual_edit` — 手动编辑:暂停,用户编辑 `intent.md` 后重新执行
- `cancel` — 取消:调 `delta fail` 标记失败,退出

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta fail \
  --change-id CHG-XXX --error "用户取消"
```

## Step 6: 应用 delta

### 6.1 更新机器 task 源(task-dir)与 spec.md

> ⚠️ **Spec-Normative 约束**:若 delta 涉及 spec 中已定义的章节(需求范围、架构 module、验收标准),必须**先更新 spec.md 对应章节**,再改 task。不得绕过 spec 直接在 task 中新增或修改 spec 层面语义。
>
> 允许不改 spec 的场景:纯执行层 delta(调整步骤顺序、更新文件路径、添加验证命令)。

机器 task 源 = task-dir。按影响分析**算出更新后的完整 task 数组 → `task-write --from-file` 整集重写**(原子替换 + 自动清孤儿 + 渲染 task.md;字段含 v2 rich：patterns/mandatory_reading/constraints/files/task_text,见 task-dir-schema.md)：

```bash
CLI=~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js
node "$CLI" task-write --from-file /tmp/delta-tasks.json    # 整集 = 现有存活 task + 新增/修改后的 task
```

- **新增任务**:加进数组(新 `Tn`,带完整 v2 字段)
- **修改任务**:就地改该 task 字段(files / depends / verification / patterns / …)
- **废弃任务**:从数组**移出** → `replaceAllTasks` 自动清孤儿(含 context.jsonl)彻底消失;变更留痕只在 `changes/CHG-*`,task 源**不留 deprecated 态**
- **更新 spec.md / plan.md 叙述**:有 PRD delta 追加 spec 章节;plan.md 叙述可选同步,**不承载机器 task 字段**

> ⚠️ 不要把 task 增删改写进 plan.md task block——execute 读 task-dir 不读 plan.md,写 plan.md 的改动对执行不可见。

### 6.2 调用 CLI 应用

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta apply --change-id CHG-XXX
```

CLI 自动:更新 `delta.json` 状态为 `applied` → 更新 `review-status.json` 为 `approved` → 持久化 `workflow-state.json`。task 增删改已在 6.1 经 `task-write` 落 task-dir,**`delta apply` 不再触碰 task 源**(只做审计推进 + blocked 反查)。

## Step 7: 生成 delta 摘要

```
📋 变更 CHG-XXX 已应用
- 类型：{type}
- 新增任务：{n}
- 修改任务：{n}
- 废弃任务：{n}
- 受影响文件：{n}
- 下一步：使用 /workflow-execute 继续执行
```

## Delta 类型速查

| 模式 | 用途 | 完整 workflow |
|------|------|---------|
| `sync`(无参数) | 后端接口就绪,执行 API 代码生成并解除 `api_spec` 阻塞 | Step 1 → 2 → 3(`delta sync`) → 7 |
| `api`(指定 API 文件) | 单个 API 文件 delta,分析接口差异生成任务 delta | Step 1 → 2 → 3(`delta init`) → 4 → 5 → 6 → 7 |
| `prd`(PRD 文件路径) | PRD 版本更新,对比新旧需求生成任务 delta | 同 api 模式 |
| `requirement`(文本描述) | 快速需求 delta,分析受影响 module 生成任务建议 | 同 api 模式 |

> sync 模式自动应用,跳过 Hard Stop。API 同步命令和配置属于项目特定 convention,见 [`../../specs/workflow-runtime/external-deps.md`](../../specs/workflow-runtime/external-deps.md)。

## 渐进式 workflow 集成

- **API 同步后**:自动解除 `api_spec` 阻塞,被阻塞任务从 `progress.blocked` 移除（重新参与 `findNextTask` 调度）
- **需求 delta 后**:新增任务自动检测依赖,如需 API 或设计稿则加入 `progress.blocked`
- **delta 应用后**:workflow 级状态从 `halted`（`halt_reason: 'dependency'`）恢复为 `running`（若无其他阻塞）

手动解除阻塞:
```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dependency>
```

## CLI 命令速查

```bash
delta init    --type <type> --source <src> --description <desc>
delta impact  --change-id CHG-XXX --tasks-added N --tasks-modified N --tasks-removed N --risk-level <level>
delta apply   --change-id CHG-XXX
delta fail    --change-id CHG-XXX --error <message>
delta sync    --dependency api_spec
status
unblock <dependency>
```

(以上均通过 `node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js` 调用。)
