# workflow delta - 增量变更概览 (v3.1)

统一入口：处理需求更新、API 变更等外部规格变化。

## 快速导航

- 想先判断输入会被识别成什么：看 Step 0
- 想看 change id / delta 文档结构：看 Step 2 / Step 4
- 想看 PRD / requirement 影响分析：看 Step 3 与 `specs/delta/impact-analysis.md`
- 想看 API 同步与 unblock 规则：看 Step 5 与 `specs/delta/api-sync.md`
- 想确认哪些示例是项目特定约定：看 `references/external-deps.md`

## 何时读取

- 用户调用 `/workflow delta`
- 需要处理 PRD 变化、需求变更、API 文件变化或批量 API 同步时
- 需要确认 delta 文档、状态迁移与 unblock 语义时

## 使用方法

```bash
/workflow delta                             # 执行 ytt 生成/同步 API
/workflow delta docs/prd-v2.md              # PRD 文件更新
/workflow delta 新增导出功能，支持 CSV 格式   # 需求描述
/workflow delta packages/api/.../teamApi.ts  # API 文件变更
```

**自动识别规则**：
- 无参数 → 执行 `pnpm ytt` 同步全部 API
- `.md` 结尾且存在 → PRD 文件
- `Api.ts` / `autogen/` 路径 → API 规格
- 其他 → 需求描述文本

---

## 🎯 执行流程概览

### Step 0：智能解析输入

自动识别输入类型：
- `sync`: 无参数，执行 `pnpm ytt` 同步全部 API
- `api`: API 文件路径（`Api.ts` / `autogen/` / `.api.ts`）
- `prd`: PRD 文件路径（`.md` 结尾且存在）
- `requirement`: 需求描述文本

**详细实现**: 参见 `specs/delta/impact-analysis.md`

---

### Step 1：加载工作流状态

读取工作流状态和相关文件：
- 项目配置（`.claude/config/project-config.json`）
- 工作流状态（`workflow-state.json`）
- Spec 文档（`spec_file`）
- Plan 文档（`plan_file`）

---

### Step 2：生成变更 ID

生成唯一的变更 ID：
- 格式：`CHG-XXX`（XXX 为 3 位数字，左补零）
- 递增计数器：`state.delta_tracking.change_counter`
- 创建变更目录：`~/.claude/workflows/{projectId}/changes/{changeId}/`

---

### Step 3：分析变更影响

根据变更类型分析影响：

**API 变更**：
- 对比新旧 API 接口
- 识别新增/删除/修改的接口
- 分析受影响的任务和文件

**PRD 变更**：
- 提取新需求
- 对比现有 `spec.md`
- 识别需要新增/修改的 `plan.md` 任务块

**需求变更**：
- 分析需求描述
- 识别受影响的模块
- 生成 WorkflowTaskV2 兼容的任务变更建议

**详细实现**: 参见 `specs/delta/impact-analysis.md`

---

### Step 4：生成 Delta 文档

生成两个文档：

**delta.json**（机器可读）：
- 变更 ID 和父变更
- 触发信息（类型、来源、描述）
- 影响分析（新增/修改/废弃任务）
- 规格变更（spec_deltas）
- 任务变更（task_deltas）

**intent.md**（人类可读）：
- 变更意图说明
- 变更内容摘要
- 影响分析详情
- 审查状态

---

### Step 5：API 变更 / 同步处理

**sync 模式**（详见 `specs/delta/api-sync.md` Step 1-8）：
1. 检查 `ytt.config.ts` 是否存在
2. 生成变更 ID（`CHG-XXX`）并创建变更目录
3. 执行 `pnpm ytt` 同步全部 API（失败时记录失败态 delta 并退出）
4. 解析生成的 API 文件
5. 对比接口变化
6. 更新 API 上下文
7. 解除 `api_spec` 阻塞 + 工作流状态迁移（`blocked` → `running`）+ 持久化
8. 写入 `delta.json`、`intent.md`、`review-status.json`（在阻塞解除后写入，确保 `unblockedTasks` 准确）

> **注意**：sync 模式自动应用，跳过 Step 6（Hard Stop 变更确认）。但同样经过变更 ID 生成和 delta 文档写入，确保审计链完整。

**api 模式**：
1. 解析指定 API 文件
2. 对比新旧接口变化
3. 生成 API 变更详情
4. 更新 `state.api_context`

**详细实现**: 参见 `specs/delta/api-sync.md`

---

### Step 6：Hard Stop - 变更确认

显示变更摘要，等待用户确认：

**前置检查**：
- **占位路径检测**（P9）：扫描 `tasksToAdd` 中的 `files` 字段，若包含 `__PLACEHOLDER__` 前缀路径，在摘要中用 `⚠️` 高亮标注，强制要求用户提供真实路径后才可应用
- **已完成任务回归风险**（P10）：扫描 `tasksToModify` / `tasksToRemove` 中的 `completedWarning` 字段，若存在则用 `⚠️` 高亮标注回归风险

```typescript
// 前置安全检查
const placeholderTasks = impact.tasksToAdd.filter(t =>
  Object.values(t.files || {}).flat().some(f => f.startsWith('__PLACEHOLDER__'))
);
if (placeholderTasks.length > 0) {
  console.log(`⚠️ 以下任务包含占位路径，请在确认前修改：`);
  placeholderTasks.forEach(t => console.log(`  - ${t.id}: ${t.name}`));
}

const regressionRisks = [
  ...impact.tasksToModify.filter(t => t.completedWarning),
  ...impact.tasksToRemove.filter(t => t.completedWarning)
];
if (regressionRisks.length > 0) {
  console.log(`⚠️ 以下变更涉及已完成任务，可能导致回归：`);
  regressionRisks.forEach(t => console.log(`  - ${t.completedWarning}`));
}
```

**用户选择**：
1. **应用变更**: 更新 `spec.md` 和 `plan.md`（占位路径必须先替换）
2. **手动编辑**: 暂停，编辑 intent.md 后重新执行
3. **取消**: 放弃本次变更

---

### Step 7：应用变更

**更新设计与规划工件**：
- 追加变更章节
- 必要时更新 `spec.md`
- 必要时更新 `plan.md`
- 记录变更历史

**更新实施计划**：
- 新增任务（追加为 `## Tn:` WorkflowTaskV2 任务块）
- 修改任务（更新 `files` / `actions` / `steps` / `verification` 等字段）
- 废弃任务（标记为 deprecated 或移出执行范围）

**更新工作流状态**：
- 记录应用的变更 ID
- 更新任务进度
- 解除相关阻塞

---

### Step 8：生成变更摘要

显示变更应用结果：
- 变更 ID 和类型
- 新增/修改/废弃任务统计
- 受影响文件列表
- 下一步操作建议

---

## 变更类型详解

### 1. API 同步（sync）

**触发**: `/workflow delta`（无参数）

**行为**:
- 执行 `pnpm ytt` 生成全部 API 代码
- 自动解除 `api_spec` 阻塞
- 更新被阻塞任务状态

**适用场景**:
- 后端接口已就绪
- 需要生成前端 API 调用代码
- 解除等待 API 的任务阻塞

---

### 2. API 文件变更（api）

**触发**: `/workflow delta packages/api/.../teamApi.ts`

**行为**:
- 解析 API 文件
- 对比新旧接口
- 识别变更影响
- 生成任务变更建议

**适用场景**:
- 单个 API 文件更新
- 接口签名变更
- 新增/删除接口

---

### 3. PRD 文件变更（prd）

**触发**: `/workflow delta docs/prd-v2.md`

**行为**:
- 读取 PRD 文件
- 提取结构化需求（如果长度 > 500）
- 对比现有 `spec.md`
- 生成 `plan.md` 任务变更建议

**适用场景**:
- PRD 版本更新
- 需求迭代
- 功能增强

---

### 4. 需求描述变更（requirement）

**触发**: `/workflow delta 新增导出功能，支持 CSV 格式`

**行为**:
- 分析需求描述
- 识别受影响模块
- 生成任务变更建议

**适用场景**:
- 快速需求变更
- 小功能增强
- Bug 修复需求

---

## Delta Tracking 系统

**状态文件**:
```json
{
  "delta_tracking": {
    "enabled": true,
    "changes_dir": "changes/",
    "current_change": "CHG-003",
    "applied_changes": ["CHG-001", "CHG-002", "CHG-003"],
    "change_counter": 3
  }
}
```

**变更目录结构**:
```
~/.claude/workflows/{projectId}/changes/
├── CHG-001/
│   ├── delta.json         # 变更记录（机器可读）
│   ├── intent.md          # 变更意图（人类可读）
│   └── review-status.json # 审查状态
├── CHG-002/
│   ├── delta.json
│   ├── intent.md
│   └── review-status.json
└── CHG-003/
    ├── delta.json
    ├── intent.md
    └── review-status.json
```

---

## 渐进式工作流集成

Delta 命令与渐进式工作流无缝集成：

**API 同步后**:
- 自动解除 `api_spec` 阻塞
- 更新被阻塞任务状态（`blocked` → `pending`）
- 提示用户继续执行

**需求变更后**:
- 新增任务自动检测依赖
- 如需 API 或设计稿，标记为 `blocked`
- 提示用户解除阻塞

---

## 📚 详细实现规格

所有详细的函数实现、数据结构定义、算法细节请参见当前已落地的 `specs/delta/` 文档：

- `impact-analysis.md` - 影响分析详情
- `api-sync.md` - API 同步详情

> 说明：输入识别、task delta、spec delta 当前由概览与上述两份文档共同约束，未单独拆分为独立规格文件。

---

## 🔄 相关命令

```bash
# API 同步
/workflow delta

# PRD 更新
/workflow delta docs/prd-v2.md

# 需求变更
/workflow delta 新增导出功能

# API 文件变更
/workflow delta packages/api/.../teamApi.ts

# 查看状态
/workflow status

# 继续执行
/workflow execute

# 解除阻塞（手动）
/workflow unblock api_spec
/workflow unblock external
```

---

## 使用示例

### 示例 1: API 同步

```bash
# 后端接口已就绪，同步 API 代码
/workflow delta

# 输出：
# ⏳ 执行 pnpm ytt 同步 API...
# ✅ API 代码已同步
# 已解除 api_spec 阻塞，可执行依赖 API 的任务。
```

### 示例 2: PRD 更新

```bash
# PRD 版本更新
/workflow delta docs/prd-v2.md

# 输出：
# 📋 变更类型：prd（来源：docs/prd-v2.md）
# 🔍 分析变更影响
# 变更 ID：CHG-002
# 新增任务：3
# 修改任务：2
# 废弃任务：1
```

### 示例 3: 需求变更

```bash
# 快速需求变更
/workflow delta 新增导出功能，支持 CSV 格式

# 输出：
# 📋 变更类型：requirement（来源：inline）
# 🔍 分析变更影响
# 变更 ID：CHG-003
# 新增任务：2
# 修改任务：0
# 废弃任务：0
```
