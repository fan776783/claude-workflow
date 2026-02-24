# Phase 1.5: Intent Review 详情

## 目的

在生成任务清单前，生成 Intent 文档供用户审查变更意图，确保变更方向正确。

## 执行时机

**强制执行**：Phase 1 完成后，Phase 2 开始前

## 实现细节

### Step 1: 创建 changes 目录结构

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Phase 1.5: 意图审查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 确保工作流目录存在
ensureDir(workflowDir);

// 创建 changes 目录结构
const changeId = "CHG-001";
const changesDir = path.join(workflowDir, 'changes', changeId);
ensureDir(changesDir);
```

### Step 2: 生成 Intent 文档

```typescript
// 生成 Intent 文档
const intentContent = generateIntentSummary({
  requirement: requirementContent,
  techDesign: readFile(techDesignPath),
  analysisResult: analysisResult,
  taskName: taskName,
  changeId: changeId
});

const intentPath = path.join(changesDir, 'intent.md');
writeFile(intentPath, intentContent);

console.log(`
📄 Intent 文档已生成：${intentPath}

**变更概要**：
- 变更 ID: ${changeId}
- 触发类型: new_requirement
- 影响范围: ${analysisResult.relatedFiles.length} 个文件
`);
```

### Step 3: Hard Stop - Intent 确认

```typescript
// Hard Stop: Intent 确认
const intentChoice = await AskUserQuestion({
  questions: [{
    question: "请确认以上变更意图是否正确？",
    header: "Intent Review",
    multiSelect: false,
    options: [
      { label: "意图正确", description: "继续生成任务清单" },
      { label: "需要调整", description: "暂停，手动编辑 intent.md 后重新执行" },
      { label: "取消", description: "放弃本次变更" }
    ]
  }]
});

if (intentChoice === "取消") {
  console.log(`
❌ 变更已取消

已清理临时文件。
  `);
  // 清理 changes 目录
  await Bash({ command: `rm -rf "${changesDir}"` });
  return;
}

if (intentChoice === "需要调整") {
  console.log(`
⏸️ 工作流已暂停

请编辑 Intent 文档后重新执行：
  1. 编辑文件：${intentPath}
  2. 重新启动：/workflow start "${requirement}"
  `);
  return;
}
```

### Step 4: 更新审查状态

```typescript
// 更新审查状态
const reviewStatus = {
  change_id: changeId,
  reviewed_at: new Date().toISOString(),
  status: "approved",
  reviewer: "user"
};
writeFile(path.join(changesDir, 'review-status.json'), JSON.stringify(reviewStatus, null, 2));

console.log(`✅ Intent 已批准，继续生成任务清单`);
```

## Intent 文档结构

```markdown
# Intent: 任务名称

## Change ID: CHG-001

## 触发

- **类型**: new_requirement
- **来源**: docs/prd.md

## 变更意图

实现用户认证功能，包括登录、注册、密码重置等核心功能。
支持 JWT token 认证，提供中间件保护需要认证的路由。

## 影响分析

### 涉及文件

- `src/models/User.ts` — 用户数据模型
- `src/services/AuthService.ts` — 认证服务
- `src/controllers/AuthController.ts` — 认证控制器
- `src/middleware/authMiddleware.ts` — 认证中间件

### 技术约束

- 使用 TypeScript 4.9+
- 遵循 ESLint 规范
- 数据库：PostgreSQL 14
- 密码加密：bcrypt

### 可复用组件

- `src/models/BaseModel.ts` — 基础模型类
- `src/services/BaseService.ts` — 基础服务类
- `src/utils/validation.ts` — 验证工具函数

## 审查状态

- **状态**: pending
- **审查人**: -
- **审查时间**: -
```

## 辅助函数

### generateIntentSummary

生成 Intent 摘要文档。

```typescript
function generateIntentSummary(params: {
  requirement: string;
  techDesign: string;
  analysisResult: any;
  taskName: string;
  changeId: string;
}): string {
  const { requirement, techDesign, analysisResult, taskName, changeId } = params;

  return `# Intent: ${taskName}

## Change ID: ${changeId}

## 触发

- **类型**: new_requirement
- **来源**: ${requirementSource}

## 变更意图

${requirement.substring(0, 500)}

## 影响分析

### 涉及文件

${analysisResult.relatedFiles.map(f => `- \`${f.path}\` — ${f.purpose}`).join('\n') || '（无已有文件受影响）'}

### 技术约束

${analysisResult.constraints.map(c => `- ${c}`).join('\n') || '（无特殊约束）'}

### 可复用组件

${analysisResult.reusableComponents.map(c => `- \`${c.path}\` — ${c.description || c.purpose}`).join('\n') || '（无可复用组件）'}

## 审查状态

- **状态**: pending
- **审查人**: -
- **审查时间**: -
`;
}
```

## 审查状态文件

**路径**: `~/.claude/workflows/{projectId}/changes/{changeId}/review-status.json`

**结构**:
```json
{
  "change_id": "CHG-001",
  "reviewed_at": "2026-02-24T10:00:00Z",
  "status": "approved",
  "reviewer": "user"
}
```

**状态值**:
- `pending`: 等待审查
- `approved`: 已批准
- `rejected`: 已拒绝

## 变更 ID 生成规则

```typescript
function nextChangeId(state: any): string {
  const counter = (state.delta_tracking?.change_counter || 0) + 1;
  state.delta_tracking.change_counter = counter;
  return `CHG-${String(counter).padStart(3, '0')}`;
}
```

**规则**:
- 格式：`CHG-XXX`（XXX 为 3 位数字，左补零）
- 首次启动：`CHG-001`
- 后续增量变更：`CHG-002`, `CHG-003`, ...

## 输出

Intent 文档和审查状态将用于：
- Hard Stop: 用户审查变更意图
- Phase 2: 任务生成（记录变更 ID）
- Delta Tracking: 变更历史追踪
- Genesis Change: 初始变更记录
