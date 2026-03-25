# Phase 1.5: Intent Review 详情

## 目的

在生成 `plan.md` 与 `tasks.md` 前，基于稳定的 `spec.md` 生成 Intent 文档，供用户审查变更意图，确保变更方向正确。

> Intent Review 不再仅依赖 `tech-design.md`，而是显式引用 `spec.md` 作为规划共识输入。

## 执行时机

**强制执行**：Phase 1.4 用户 Spec 审查通过后，Phase 2 开始前。

## 实现细节

### Step 1: 创建 changes 目录结构

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Phase 1.5: 意图审查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

ensureDir(workflowDir);

const changeId = 'CHG-001';
const changesDir = path.join(workflowDir, 'changes', changeId);
ensureDir(changesDir);
```

### Step 2: 生成 Intent 文档

```typescript
const intentContent = generateIntentSummary({
  requirement: requirementContent,
  spec: readFile(specPath),
  specPath,
  analysisResult,
  taskName,
  changeId
});

const intentPath = path.join(changesDir, 'intent.md');
writeFile(intentPath, intentContent);

console.log(`
📄 Intent 文档已生成：${intentPath}

**变更概要**：
- 变更 ID: ${changeId}
- 触发类型: new_requirement
- Spec 引用: ${specPath}
- 影响范围: ${analysisResult.relatedFiles.length} 个文件
`);
```

### Step 3: Hard Stop - Intent 确认

```typescript
const intentChoice = await AskUserQuestion({
  questions: [{
    question: '请确认以上变更意图是否正确？',
    header: 'Intent Review',
    multiSelect: false,
    options: [
      { label: '意图正确', description: '继续生成计划与任务清单' },
      { label: '需要调整', description: '暂停，手动编辑 intent.md 或 spec.md 后重新执行' },
      { label: '取消', description: '放弃本次变更' }
    ]
  }]
});

if (intentChoice === '取消') {
  console.log(`
❌ 变更已取消

将删除本次 Intent Review 生成的临时工件：${changesDir}
已归档的历史变更不会受影响。
  `);
  await Bash({ command: `rm -rf "${changesDir}"` });
  state.status = 'idle';
  if (state.delta_tracking) {
    state.delta_tracking.current_change = null;
  }
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}

if (intentChoice === '需要调整') {
  console.log(`
⏸️ 工作流已暂停

请编辑文档后重新执行：
  1. 规范文档：${specPath}
  2. 意图文档：${intentPath}
  3. 重新启动：/workflow start "${requirementContent}"
  `);
  state.status = 'paused';
  writeFile(statePath, JSON.stringify(state, null, 2));
  return;
}
```

### Step 4: 更新审查状态

```typescript
const reviewStatus = {
  change_id: changeId,
  reviewed_at: new Date().toISOString(),
  status: 'approved',
  reviewer: 'user',
  spec_ref: specPath
};
writeFile(
  path.join(changesDir, 'review-status.json'),
  JSON.stringify(reviewStatus, null, 2)
);

console.log('✅ Intent 已批准，继续生成计划');
```

## Intent 文档结构

```markdown
# Intent: 任务名称

## Change ID: CHG-001

## 触发

- **类型**: new_requirement
- **来源**: docs/prd.md

## Spec 引用

- **spec_ref**: `.claude/specs/{task-name}.md`
- **规范摘要**: 本次变更以 Spec 中定义的范围、模块边界和验收映射为准

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
  spec: string;
  specPath: string;
  analysisResult: any;
  taskName: string;
  changeId: string;
}): string {
  const { requirement, spec, specPath, analysisResult, taskName, changeId } = params;

  const specSummary = extractSpecSummary(spec);

  return `# Intent: ${taskName}

## Change ID: ${changeId}

## 触发

- **类型**: new_requirement
- **来源**: ${requirementSource}

## Spec 引用

- **spec_ref**: ${specPath}
- **规范摘要**: ${specSummary}

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

### extractSpecSummary

从 `spec.md` 中提取可供 Intent 使用的摘要。

```typescript
function extractSpecSummary(specContent: string): string {
  const scopeMatch = specContent.match(/## 2\. Scope[\s\S]*?(?=\n## )/);
  if (!scopeMatch) return '以已批准 Spec 为准';
  return scopeMatch[0]
    .replace(/## 2\. Scope/, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 240);
}
```

## 审查状态文件

**路径**: `~/.claude/workflows/{projectId}/changes/{changeId}/review-status.json`

**结构**:
```json
{
  "change_id": "CHG-001",
  "reviewed_at": "2026-03-24T10:00:00Z",
  "status": "approved",
  "reviewer": "user",
  "spec_ref": ".claude/specs/task-name.md"
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

## 输出

Intent 文档和审查状态将用于：
- Hard Stop：用户审查变更意图
- Phase 2：计划生成（记录 `spec_ref`）
- Phase 3：任务编译（继承 changeId）
- Delta Tracking：变更历史追踪
- Genesis Change：初始变更记录

**取消分支约定**：若用户在 Intent Review 中选择“取消”，当前 `changes/{changeId}` 下的临时 Intent 工件会被清理；只有后续完成归档的变更才会进入 `archive/`。
