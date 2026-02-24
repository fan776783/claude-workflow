# 影响分析详情

## 概述

Delta 命令的核心功能是分析变更对现有工作流的影响，识别需要新增、修改或废弃的任务。

## 数据结构

### ImpactAnalysis

```typescript
interface ImpactAnalysis {
  tasksToAdd: TaskToAdd[];
  tasksToModify: TaskToModify[];
  tasksToRemove: TaskToRemove[];
  affectedFiles: string[];
  affectedModules: string[];
  riskLevel: 'low' | 'medium' | 'high';
  estimatedEffort: string;
}

interface TaskToAdd {
  name: string;
  phase: string;
  file: string;
  requirement: string;
  actions: string;
  depends?: string;
  blocked_by?: string[];
  rationale: string;
}

interface TaskToModify {
  id: string;
  name: string;
  changes: string;
  before: Partial<Task>;
  after: Partial<Task>;
  rationale: string;
}

interface TaskToRemove {
  id: string;
  name: string;
  reason: string;
  deprecated: boolean;
}
```

---

## API 变更影响分析

### analyzeApiDelta

分析 API 变更对现有任务的影响。

```typescript
function analyzeApiDelta(
  apiContent: string,
  existingTasks: Task[],
  apiContext: ApiContext | null
): ImpactAnalysis {
  // 1. 解析新 API 文件
  const newApiInfo = parseApiFile(apiContent);

  // 2. 获取旧 API 信息
  const oldApiInfo = apiContext?.interfaces || [];

  // 3. 对比接口变化
  const apiDiff = diffApiInterfaces(oldApiInfo, newApiInfo.interfaces);

  // 4. 分析影响
  const impact: ImpactAnalysis = {
    tasksToAdd: [],
    tasksToModify: [],
    tasksToRemove: [],
    affectedFiles: [],
    affectedModules: [],
    riskLevel: 'low',
    estimatedEffort: '1-2h'
  };

  // 5. 新增接口 → 新增任务
  for (const api of apiDiff.added) {
    impact.tasksToAdd.push({
      name: `实现 ${api.name} 接口调用`,
      phase: 'ui-integrate',
      file: `src/services/${api.module}Service.ts`,
      requirement: `调用 ${api.method} ${api.path}，处理请求和响应`,
      actions: 'edit_file',
      blocked_by: ['api_spec'],
      rationale: `新增接口 ${api.name}`
    });

    // 如果有对应的 UI 组件，添加集成任务
    const relatedComponent = findRelatedComponent(api.name, existingTasks);
    if (relatedComponent) {
      impact.tasksToAdd.push({
        name: `集成 ${api.name} 到 ${relatedComponent.name}`,
        phase: 'ui-integrate',
        file: relatedComponent.file,
        requirement: `在 ${relatedComponent.name} 中调用 ${api.name} 接口`,
        actions: 'edit_file',
        depends: `T${existingTasks.length + impact.tasksToAdd.length}`,
        rationale: `新增接口需要集成到现有组件`
      });
    }
  }

  // 6. 删除接口 → 废弃任务
  for (const api of apiDiff.removed) {
    const relatedTasks = findTasksByApi(api.name, existingTasks);
    for (const task of relatedTasks) {
      impact.tasksToRemove.push({
        id: task.id,
        name: task.name,
        reason: `接口 ${api.name} 已删除`,
        deprecated: true
      });
    }
  }

  // 7. 修改接口 → 修改任务
  for (const api of apiDiff.modified) {
    const relatedTasks = findTasksByApi(api.name, existingTasks);
    for (const task of relatedTasks) {
      impact.tasksToModify.push({
        id: task.id,
        name: task.name,
        changes: api.changes,
        before: { requirement: task.requirement },
        after: { requirement: `${task.requirement}（已更新：${api.changes}）` },
        rationale: `接口 ${api.name} 签名变更`
      });
    }
  }

  // 8. 计算风险等级
  impact.riskLevel = calculateRiskLevel(apiDiff);

  // 9. 估算工作量
  impact.estimatedEffort = estimateEffort(impact);

  return impact;
}
```

---

## PRD 变更影响分析

### analyzePrdDelta

分析 PRD 变更对现有任务的影响。

```typescript
function analyzePrdDelta(
  prdContent: string,
  techDesign: string,
  existingTasks: Task[]
): ImpactAnalysis {
  // 1. 提取结构化需求（如果长度 > 500）
  let newRequirements: RequirementAnalysis | null = null;
  if (prdContent.length > 500) {
    newRequirements = extractStructuredRequirements(prdContent);
  }

  // 2. 提取现有需求（从技术方案）
  const existingRequirements = extractRequirementsFromTechDesign(techDesign);

  // 3. 对比需求变化
  const reqDiff = diffRequirements(existingRequirements, newRequirements || prdContent);

  // 4. 分析影响
  const impact: ImpactAnalysis = {
    tasksToAdd: [],
    tasksToModify: [],
    tasksToRemove: [],
    affectedFiles: [],
    affectedModules: [],
    riskLevel: 'medium',
    estimatedEffort: '2-4h'
  };

  // 5. 新增需求 → 新增任务
  for (const req of reqDiff.added) {
    // 根据需求类型生成任务
    if (req.type === 'form_field') {
      impact.tasksToAdd.push({
        name: `添加表单字段：${req.fieldName}`,
        phase: 'ui-form',
        file: `src/components/forms/${req.scene}Form.vue`,
        requirement: `添加 ${req.fieldName} 字段，类型：${req.fieldType}，校验规则：${req.validationRules.join(', ')}`,
        actions: 'edit_file',
        blocked_by: ['design_spec'],
        rationale: `PRD 新增表单字段`
      });
    } else if (req.type === 'business_rule') {
      impact.tasksToAdd.push({
        name: `实现业务规则：${req.ruleName}`,
        phase: 'infra',
        file: `src/utils/businessRules.ts`,
        requirement: req.description,
        actions: 'edit_file',
        rationale: `PRD 新增业务规则`
      });
    } else if (req.type === 'ui_component') {
      impact.tasksToAdd.push({
        name: `创建组件：${req.componentName}`,
        phase: 'ui-display',
        file: `src/components/${req.componentName}.vue`,
        requirement: req.description,
        actions: 'create_file',
        blocked_by: ['design_spec'],
        rationale: `PRD 新增 UI 组件`
      });
    }
  }

  // 6. 删除需求 → 废弃任务
  for (const req of reqDiff.removed) {
    const relatedTasks = findTasksByRequirement(req, existingTasks);
    for (const task of relatedTasks) {
      impact.tasksToRemove.push({
        id: task.id,
        name: task.name,
        reason: `需求已删除：${req.description}`,
        deprecated: true
      });
    }
  }

  // 7. 修改需求 → 修改任务
  for (const req of reqDiff.modified) {
    const relatedTasks = findTasksByRequirement(req.before, existingTasks);
    for (const task of relatedTasks) {
      impact.tasksToModify.push({
        id: task.id,
        name: task.name,
        changes: req.changes,
        before: { requirement: task.requirement },
        after: { requirement: req.after.description },
        rationale: `需求变更：${req.changes}`
      });
    }
  }

  // 8. 计算风险等级
  impact.riskLevel = calculateRiskLevel(reqDiff);

  // 9. 估算工作量
  impact.estimatedEffort = estimateEffort(impact);

  return impact;
}
```

---

## 需求描述影响分析

### analyzeRequirementDelta

分析需求描述对现有任务的影响。

```typescript
function analyzeRequirementDelta(
  requirement: string,
  techDesign: string,
  existingTasks: Task[]
): ImpactAnalysis {
  // 1. 使用 codebase-retrieval 分析需求
  const analysisResult = await mcp__auggie-mcp__codebase-retrieval({
    information_request: `
      分析以下需求变更：

      ${requirement}

      请提供：
      1. 需要新增的功能模块
      2. 需要修改的现有模块
      3. 受影响的文件和组件
      4. 技术约束和依赖
    `
  });

  // 2. 解析分析结果
  const impact: ImpactAnalysis = {
    tasksToAdd: [],
    tasksToModify: [],
    tasksToRemove: [],
    affectedFiles: extractAffectedFiles(analysisResult),
    affectedModules: extractAffectedModules(analysisResult),
    riskLevel: 'low',
    estimatedEffort: '1-2h'
  };

  // 3. 生成新增任务
  const newModules = extractNewModules(analysisResult);
  for (const module of newModules) {
    impact.tasksToAdd.push({
      name: module.name,
      phase: determinePhase(module),
      file: module.file,
      requirement: module.description,
      actions: determineActions(module),
      rationale: `需求变更：${requirement.substring(0, 100)}`
    });
  }

  // 4. 识别需要修改的任务
  const modifiedModules = extractModifiedModules(analysisResult);
  for (const module of modifiedModules) {
    const relatedTasks = findTasksByFile(module.file, existingTasks);
    for (const task of relatedTasks) {
      impact.tasksToModify.push({
        id: task.id,
        name: task.name,
        changes: module.changes,
        before: { requirement: task.requirement },
        after: { requirement: `${task.requirement}\n\n**变更**：${module.changes}` },
        rationale: `需求变更影响现有模块`
      });
    }
  }

  // 5. 计算风险等级
  impact.riskLevel = calculateRiskLevel({
    added: newModules,
    modified: modifiedModules,
    removed: []
  });

  // 6. 估算工作量
  impact.estimatedEffort = estimateEffort(impact);

  return impact;
}
```

---

## 辅助函数

### diffApiInterfaces

对比新旧 API 接口。

```typescript
interface ApiDiff {
  added: ApiInterface[];
  removed: ApiInterface[];
  modified: Array<{
    name: string;
    changes: string;
    before: ApiInterface;
    after: ApiInterface;
  }>;
}

function diffApiInterfaces(
  oldInterfaces: ApiInterface[],
  newInterfaces: ApiInterface[]
): ApiDiff {
  const diff: ApiDiff = {
    added: [],
    removed: [],
    modified: []
  };

  // 1. 新增接口
  for (const newApi of newInterfaces) {
    const oldApi = oldInterfaces.find(a => a.name === newApi.name);
    if (!oldApi) {
      diff.added.push(newApi);
    }
  }

  // 2. 删除接口
  for (const oldApi of oldInterfaces) {
    const newApi = newInterfaces.find(a => a.name === oldApi.name);
    if (!newApi) {
      diff.removed.push(oldApi);
    }
  }

  // 3. 修改接口
  for (const newApi of newInterfaces) {
    const oldApi = oldInterfaces.find(a => a.name === newApi.name);
    if (oldApi) {
      const changes = detectApiChanges(oldApi, newApi);
      if (changes.length > 0) {
        diff.modified.push({
          name: newApi.name,
          changes: changes.join(', '),
          before: oldApi,
          after: newApi
        });
      }
    }
  }

  return diff;
}
```

### detectApiChanges

检测 API 接口的具体变更。

```typescript
function detectApiChanges(
  oldApi: ApiInterface,
  newApi: ApiInterface
): string[] {
  const changes: string[] = [];

  // 1. 方法变更
  if (oldApi.method !== newApi.method) {
    changes.push(`方法变更：${oldApi.method} → ${newApi.method}`);
  }

  // 2. 路径变更
  if (oldApi.path !== newApi.path) {
    changes.push(`路径变更：${oldApi.path} → ${newApi.path}`);
  }

  // 3. 请求参数变更
  const reqDiff = diffParameters(oldApi.request, newApi.request);
  if (reqDiff.length > 0) {
    changes.push(`请求参数变更：${reqDiff.join(', ')}`);
  }

  // 4. 响应结构变更
  const resDiff = diffParameters(oldApi.response, newApi.response);
  if (resDiff.length > 0) {
    changes.push(`响应结构变更：${resDiff.join(', ')}`);
  }

  return changes;
}
```

### diffRequirements

对比新旧需求。

```typescript
interface RequirementDiff {
  added: Requirement[];
  removed: Requirement[];
  modified: Array<{
    changes: string;
    before: Requirement;
    after: Requirement;
  }>;
}

function diffRequirements(
  oldReq: string | RequirementAnalysis,
  newReq: string | RequirementAnalysis
): RequirementDiff {
  // 如果是字符串，进行简单的文本对比
  if (typeof oldReq === 'string' && typeof newReq === 'string') {
    return simpleTextDiff(oldReq, newReq);
  }

  // 如果是结构化需求，进行详细对比
  return structuredRequirementDiff(oldReq as RequirementAnalysis, newReq as RequirementAnalysis);
}
```

### calculateRiskLevel

计算变更风险等级。

```typescript
function calculateRiskLevel(diff: any): 'low' | 'medium' | 'high' {
  const addedCount = diff.added?.length || 0;
  const removedCount = diff.removed?.length || 0;
  const modifiedCount = diff.modified?.length || 0;

  const totalChanges = addedCount + removedCount + modifiedCount;

  // 删除操作风险最高
  if (removedCount > 3) return 'high';
  if (removedCount > 0) return 'medium';

  // 修改操作次之
  if (modifiedCount > 5) return 'high';
  if (modifiedCount > 2) return 'medium';

  // 新增操作风险最低
  if (addedCount > 10) return 'medium';

  return 'low';
}
```

### estimateEffort

估算工作量。

```typescript
function estimateEffort(impact: ImpactAnalysis): string {
  const totalTasks = impact.tasksToAdd.length +
                     impact.tasksToModify.length +
                     impact.tasksToRemove.length;

  if (totalTasks === 0) return '< 1h';
  if (totalTasks <= 2) return '1-2h';
  if (totalTasks <= 5) return '2-4h';
  if (totalTasks <= 10) return '4-8h';
  return '1-2d';
}
```

### findTasksByApi

根据 API 名称查找相关任务。

```typescript
function findTasksByApi(apiName: string, tasks: Task[]): Task[] {
  return tasks.filter(task => {
    const req = task.requirement?.toLowerCase() || '';
    const file = task.file?.toLowerCase() || '';
    const name = task.name?.toLowerCase() || '';

    return req.includes(apiName.toLowerCase()) ||
           file.includes(apiName.toLowerCase()) ||
           name.includes(apiName.toLowerCase());
  });
}
```

### findTasksByRequirement

根据需求查找相关任务。

```typescript
function findTasksByRequirement(req: Requirement, tasks: Task[]): Task[] {
  return tasks.filter(task => {
    const taskReq = task.requirement?.toLowerCase() || '';
    const reqDesc = req.description?.toLowerCase() || '';

    return taskReq.includes(reqDesc) ||
           reqDesc.includes(taskReq);
  });
}
```

### findTasksByFile

根据文件路径查找相关任务。

```typescript
function findTasksByFile(filePath: string, tasks: Task[]): Task[] {
  return tasks.filter(task => task.file === filePath);
}
```

---

## 使用示例

```typescript
// API 变更影响分析
const apiImpact = analyzeApiDelta(
  apiContent,
  existingTasks,
  state.api_context
);

console.log(`
新增任务：${apiImpact.tasksToAdd.length}
修改任务：${apiImpact.tasksToModify.length}
废弃任务：${apiImpact.tasksToRemove.length}
风险等级：${apiImpact.riskLevel}
预估工作量：${apiImpact.estimatedEffort}
`);

// PRD 变更影响分析
const prdImpact = analyzePrdDelta(
  prdContent,
  techDesign,
  existingTasks
);

// 需求描述影响分析
const reqImpact = analyzeRequirementDelta(
  requirement,
  techDesign,
  existingTasks
);
```
