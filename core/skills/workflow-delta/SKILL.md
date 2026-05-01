---
name: workflow-delta
description: "/workflow-delta 入口。delta 的影响分析、用户确认与应用。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。当 delta 跨到新的 `{pkg}/{layer}` 时,必须重新读新涉及 layer 的 code-specs index。
</PRE-FLIGHT>

<PATH-CONVENTION>
所有 CLI 调用使用固定公共路径 `~/.agents/agent-workflow/core/utils/workflow/`。
该路径在 `npm install` 后始终存在，所有 agent 共享，无需动态解析。
</PATH-CONVENTION>

# workflow-delta

> 本 skill 是 `/workflow-delta` 的完整行动指南。

<HARD-GATE>
三条不可违反的规则：
1. delta未经用户确认（Hard Stop），不得应用到 spec.md / plan.md（sync 模式例外，自动应用）
2. delta 文档（delta.json + intent.md）必须在状态delta前写入（先审计后生效）
3. 占位路径（__PLACEHOLDER__）必须在用户确认前替换为真实路径
</HARD-GATE>

## Checklist（按序执行）

1. ☐ 智能解析输入
2. ☐ 加载workflow状态
3. ☐ 初始化delta记录（CLI）
4. ☐ 分析delta影响
5. ☐ 🛑 delta确认（Hard Stop，sync 模式跳过）
6. ☐ 应用delta（CLI）
7. ☐ 生成delta摘要

```
输入 → 解析类型 → 加载状态 → CLI init → 影响分析 → Hard Stop → CLI apply → 摘要
         │                       │          │            │
    sync/api/prd/req          自动创建     声明式分析    用户确认
                              变更目录     无伪代码      (sync 跳过)
```

---

## Step 1: 智能解析输入

解析 `/workflow-delta` 的参数，自动识别delta类型：

| 输入形式 | delta类型 | 示例 |
|----------|----------|------|
| 无参数 | `sync` — 执行项目配置的 API 同步命令 | `/workflow-delta` |
| `.md` 文件（已存在） | `prd` — PRD 文件更新 | `/workflow-delta docs/prd-v2.md` |
| API 文件路径（`Api.ts` / `autogen/` / `.api.ts`） | `api` — API 规格delta | `/workflow-delta packages/api/.../teamApi.ts` |
| 其他文本 | `requirement` — 需求描述 | `/workflow-delta 新增导出功能` |

> CLI 已内置识别逻辑。若用户意图不明确（例如参数无法判定类型、同时满足多种模式），调用 `AskUserQuestion` 收集delta类型，`question` 写"本次delta属于哪种类型？"，`options` 给 4 条：
>
> - `sync` — API 同步（执行项目配置的 API 同步命令，自动解除 `api_spec` 阻塞）
> - `api` — API 规格delta（分析接口差异，生成任务delta）
> - `prd` — PRD 文件更新（对比新旧需求）
> - `requirement` — 需求描述（文本形式）
>
> 收到用户选择后再继续。

---

## Step 2: 加载workflow状态

调用 CLI 读取当前workflow上下文：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js context
```

**前置检查**：
- workflow必须存在（非 `archived`）
- 读取 spec.md、plan.md 路径

---

## Step 3: 初始化delta记录（CLI）

调用 CLI 创建delta记录，**不手动构造任何 JSON**：

```bash
# sync 模式：一步完成 init + apply + unblock
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta sync --dependency api_spec

# 其他模式：先 init，后续分步操作
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta init \
  --type <sync|api|prd|requirement> \
  --source <来源文件或描述> \
  --description <变更摘要>
```

CLI 自动完成：
- 生成 `CHG-XXX` delta ID
- 创建 `changes/CHG-XXX/` 目录
- 写入 `delta.json`、`intent.md`、`review-status.json`
- 更新 `workflow-state.json` 的 `delta_tracking`

**sync 模式特殊路径**：
1. **先执行项目配置的 API 同步命令**（如 `pnpm ytt`），确认成功
2. 调用 `delta sync` 命令，自动完成 init + 解除阻塞 + 写入审计记录 + 持久化
3. **跳过 Step 4-5**，直接到 Step 7

> 如果 API 同步命令失败，调用 `delta fail` 记录失败态后退出。

---

## Step 4: 分析delta影响

根据 Step 1 识别的delta类型，执行影响分析。**AI 负责分析，不负责持久化。**

### API delta分析（type: api）

1. 读取指定的 API 文件
2. 读取 `state.api_context.interfaces`（旧接口信息）
3. 对比新旧接口，识别：
   - **新增接口** → 建议新增任务（接口接入 + 组件集成）
   - **删除接口** → 建议废弃相关任务
   - **修改接口** → 建议更新相关任务的 steps
4. 检查已完成任务是否受影响（回归风险 → risk_level 提升为 `high`）

### PRD delta分析（type: prd）

1. 读取 PRD 文件内容
2. 读取 `spec.md` 的现有需求
3. 对比需求变化，识别：
   - **新增需求** → 根据需求类型生成任务（form_field / business_rule / ui_component）
   - **删除需求** → 建议废弃相关任务
   - **修改需求** → 建议更新相关任务
4. 检查已完成任务的回归风险

### 需求描述分析（type: requirement）

1. 分析需求描述文本
2. 使用代码检索能力识别受影响的module和文件
3. 生成新增/修改任务建议
4. **启发式降级**：代码检索不可用时，基于现有任务的关键词匹配推断受影响文件。降级模式下 risk_level 至少为 `medium`

### 记录影响分析结果

分析完成后，调用 CLI 记录：

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta impact \
  --change-id CHG-XXX \
  --tasks-added 3 \
  --tasks-modified 2 \
  --tasks-removed 1 \
  --risk-level medium
```

### 影响分析输出格式

向用户展示的delta摘要应包含：

| 字段 | 说明 |
|------|------|
| 新增任务 | 任务 ID、名称、阶段、文件列表 |
| 修改任务 | 任务 ID、delta说明、before/after 对比 |
| 废弃任务 | 任务 ID、废弃原因 |
| 受影响文件 | 文件路径列表 |
| 风险等级 | low / medium / high |
| 预估工作量 | 基于任务总数估算（参见风险估算规则） |

**风险估算规则**：
- 删除 > 3 个接口/需求 → `high`
- 删除 > 0 或修改 > 5 → `medium`
- 已完成任务受影响 → 无条件 `high`
- 其他 → `low`

**工作量估算**：0 任务 → <1h / 1-2 任务 → 1-2h / 3-5 任务 → 2-4h / 6-10 任务 → 4-8h / >10 任务 → 1-2d

---

## Step 5: 🛑 delta确认（Hard Stop）

**sync 模式跳过此步骤。**

执行安全检查：阅读 [`references/delta-safety-checklist.md`](references/delta-safety-checklist.md) 并逐项检查。

展示delta摘要后，调用 `AskUserQuestion` 收集决策，`question` 写"如何处理本次delta？"，`options` 给三条：

- `apply` — 应用delta：进入 Step 6（占位路径必须先替换）
- `manual_edit` — 手动编辑：暂停，用户编辑 `intent.md` 后重新执行
- `cancel` — 取消：调用 `delta fail` 标记delta失败，退出

取消时调用 CLI：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta fail \
  --change-id CHG-XXX \
  --error "用户取消"
```

---

## Step 6: 应用delta

用户确认后，执行两步操作：

### 6.1 更新 spec.md 和 plan.md

> ⚠️ **Spec-Normative 约束**：任何对 plan.md 的修改，如果涉及 spec 中已定义的章节
> （需求范围、架构module、验收标准），必须**先更新 spec.md 对应章节**，再修改 plan.md。
> 不得绕过 spec 直接在 plan 中新增或修改 spec 层面的语义。
>
> 允许不改 spec 的场景：纯执行层delta（调整步骤顺序、更新文件路径、添加验证命令）。

根据影响分析结果直接编辑文件：

- **新增任务**：追加为 `## Tn:` WorkflowTaskV2 任务块到 plan.md
- **修改任务**：更新任务的 files / actions / steps / verification 字段
- **废弃任务**：标记为 deprecated 或移出执行范围
- **更新 spec.md**：追加delta章节（如有 PRD delta）

### 6.2 调用 CLI 应用delta

```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta apply \
  --change-id CHG-XXX
```

CLI 自动完成：
- 更新 `delta.json` 状态为 `applied`
- 更新 `review-status.json` 为 `approved`
- 持久化 `workflow-state.json`

---

## Step 7: 生成delta摘要

显示delta应用结果：

```
📋 变更 CHG-XXX 已应用
- 类型：{type}
- 新增任务：{n}
- 修改任务：{n}
- 废弃任务：{n}
- 受影响文件：{n}
- 下一步：使用 /workflow-execute 继续执行
```

---

## delta类型速查

### sync 模式（无参数）

**用途**：后端接口就绪，执行 API 代码生成并解除 `api_spec` 阻塞。

**完整workflow**：Step 1 → Step 2 → Step 3（`delta sync`） → Step 7

> sync 模式自动应用，跳过 Hard Stop。执行项目配置的 API 同步命令（如 `pnpm ytt`），成功后自动解除阻塞。CLI 会写入完整审计记录。
>
> API 同步命令和配置属于项目特定convention，参见 [`../../specs/workflow-runtime/external-deps.md`](../../specs/workflow-runtime/external-deps.md)。

### api 模式（指定 API 文件）

**用途**：单个 API 文件delta，分析接口差异并生成任务delta。

**完整workflow**：Step 1 → Step 2 → Step 3（`delta init`） → Step 4 → Step 5 → Step 6 → Step 7

### prd 模式（PRD 文件路径）

**用途**：PRD 版本更新，对比新旧需求并生成任务delta。

**完整workflow**：Step 1 → Step 2 → Step 3（`delta init`） → Step 4 → Step 5 → Step 6 → Step 7

### requirement 模式（文本描述）

**用途**：快速需求delta，分析受影响module并生成任务建议。

**完整workflow**：同 prd 模式

---

## 渐进式workflow集成

Delta 命令与渐进式workflow无缝集成：

- **API 同步后**：自动解除 `api_spec` 阻塞，更新被阻塞任务状态（`blocked` → `pending`）
- **需求delta后**：新增任务自动检测依赖，如需 API 或设计稿则标记为 `blocked`
- **delta应用后**：workflow级状态从 `blocked` 恢复为 `running`（若无其他阻塞）

手动解除阻塞：
```bash
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dependency>
```

---

## 产物路径速查

| 产物 | 路径 |
|------|------|
| delta目录 | `~/.claude/workflows/{projectId}/changes/CHG-XXX/` |
| delta记录 | `changes/CHG-XXX/delta.json` |
| delta意图 | `changes/CHG-XXX/intent.md` |
| review状态 | `changes/CHG-XXX/review-status.json` |
| 状态文件 | `~/.claude/workflows/{projectId}/workflow-state.json` |

## CLI 命令速查

```bash
# 初始化变更
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta init --type <type> --source <src> --description <desc>

# 记录影响分析
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta impact --change-id CHG-XXX --tasks-added N --tasks-modified N --tasks-removed N --risk-level <level>

# 应用变更
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta apply --change-id CHG-XXX

# 标记失败
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta fail --change-id CHG-XXX --error <message>

# API 同步（一步完成）
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js delta sync --dependency api_spec

# 查看状态
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js status

# 解除阻塞
node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js unblock <dependency>
```

## 协同 Skills

| Skill | 职责 | 入口 |
|-------|------|------|
| `workflow-spec` | Spec 生成 + 设计深化 + 用户审批 | [`../workflow-spec/SKILL.md`](../workflow-spec/SKILL.md) |
| `workflow-plan` | Plan 扩写（在已审批 Spec 上） | [`../workflow-plan/SKILL.md`](../workflow-plan/SKILL.md) |
| `workflow-execute` | 按 Plan 执行 | [`../workflow-execute/SKILL.md`](../workflow-execute/SKILL.md) |
| `workflow-review` | 全量完成review（execute 完成后独立执行） | [`../workflow-review/SKILL.md`](../workflow-review/SKILL.md) |
| `workflow-status` | 状态查看 | [`../workflow-status/SKILL.md`](../workflow-status/SKILL.md) |
| `workflow-archive` | workflowarchive | [`../workflow-archive/SKILL.md`](../workflow-archive/SKILL.md) |
| `api-smoke` | 同步完 API 后可手动调用,从 spec + autogen 生成后端接口冒烟脚本 | [`../api-smoke/SKILL.md`](../api-smoke/SKILL.md) |

> CLI 入口：`~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js`
>
> 外部依赖语义参见 [`../../specs/workflow-runtime/external-deps.md`](../../specs/workflow-runtime/external-deps.md)
>
> 状态机参见 [`../../specs/workflow-runtime/state-machine.md`](../../specs/workflow-runtime/state-machine.md)
