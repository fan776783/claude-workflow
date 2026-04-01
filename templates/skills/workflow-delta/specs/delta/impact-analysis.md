# 影响分析详情

## 快速导航

- 想看 delta 影响分析的数据结构：看“数据结构”
- 想看新增/修改/删除任务如何表示：看 `TaskToAdd` / `TaskToModify` / `TaskToRemove`
- 想看风险与影响模块分析：看后续分析规则章节
- 想看 API / PRD / requirement 三类输入如何落到 impact：结合 `../../references/delta-overview.md`

## 何时读取

- `/workflow delta` 已识别输入类型，准备分析影响范围时
- 需要确认 delta 输出结构与 task 变更模型时

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
  id: string;
  name: string;
  phase: string;
  files: {
    create?: string[];
    modify?: string[];
    test?: string[];
  };
  spec_ref: string;
  plan_ref: string;
  acceptance_criteria?: string[];
  actions: string[];
  steps: Array<{
    id: string;
    description: string;
    expected: string;
    verification?: string;
  }>;
  verification?: {
    commands?: string[];
    expected_output?: string[];
  };
  depends?: string[];
  blocked_by?: string[];
  rationale: string;
}

interface TaskToModify {
  id: string;
  name: string;
  changes: string;
  before: Partial<WorkflowTaskV2>;
  after: Partial<WorkflowTaskV2>;
  rationale: string;
  completedWarning?: string;  // P10: 已完成任务被修改的回归风险警告
}

interface TaskToRemove {
  id: string;
  name: string;
  reason: string;
  deprecated: boolean;
  completedWarning?: string;  // P10: 已完成任务被废弃的回归风险警告
}
```

---

## API 变更影响分析

### analyzeApiDelta

分析 API 变更对现有任务的影响。

```typescript
// 工具函数：获取下一个可用任务编号（避免 ID 碰撞）
// 兼容 T\d+ 和 Task-\d+ 两种 ID 格式
// 输入契约：tasks 必须包含所有历史上已出现过的任务（包括 deprecated / removed），
// 任何出现过的编号都视为已占用，不允许复用。
function getNextTaskIndex(tasks: Array<{ id: string }>): number {
  return tasks.reduce((max, task) => {
    const match = /^(?:T|Task-)(\d+)$/.exec(task.id || '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}

function analyzeApiDelta(
  apiContent: string,
  existingTasks: WorkflowTaskV2[],
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
  let nextIdx = getNextTaskIndex(existingTasks);
  for (const api of apiDiff.added) {
    const apiTaskId = `T${nextIdx++}`;
    impact.tasksToAdd.push({
      id: apiTaskId,
      name: `实现 ${api.name} 接口调用`,
      phase: 'ui-integrate',
      files: { modify: [`src/services/${api.module}Service.ts`] },
      spec_ref: '§7 Acceptance Criteria',
      plan_ref: `P-api-${api.name}`,
      acceptance_criteria: [`接口 ${api.name} 已接入并处理响应`],
      actions: ['edit_file'],
      steps: [{
        id: 'D1',
        description: `调用 ${api.method} ${api.path}，处理请求和响应`,
        expected: '服务层已完成接口接入',
        verification: '运行相关 API / 集成测试'
      }],
      verification: {
        commands: ['运行相关 API / 集成测试'],
        expected_output: ['PASS']
      },
      blocked_by: ['api_spec'],
      rationale: `新增接口 ${api.name}`
    });

    // 如果有对应的 UI 组件，添加集成任务
    const relatedComponent = findRelatedComponent(api.name, existingTasks);
    if (relatedComponent) {
      const integrateTaskId = `T${nextIdx++}`;
      impact.tasksToAdd.push({
        id: integrateTaskId,
        name: `集成 ${api.name} 到 ${relatedComponent.name}`,
        phase: 'ui-integrate',
        files: {
          modify: relatedComponent.files?.modify || relatedComponent.files?.create || []
        },
        spec_ref: '§4 User-facing Behavior',
        plan_ref: `P-api-integrate-${api.name}`,
        acceptance_criteria: [`${relatedComponent.name} 已使用 ${api.name} 接口`],
        actions: ['edit_file'],
        steps: [{
          id: 'D1',
          description: `在 ${relatedComponent.name} 中调用 ${api.name} 接口`,
          expected: '组件完成接口集成'
        }],
        depends: [apiTaskId],
        rationale: `新增接口需要集成到现有组件`
      });
    }
  }

  // 6. 删除接口 → 废弃任务
  for (const api of apiDiff.removed) {
    const relatedTasks = findTasksByApi(api.name, existingTasks);
    for (const task of relatedTasks) {
      const entry: TaskToRemove = {
        id: task.id,
        name: task.name,
        reason: `接口 ${api.name} 已删除`,
        deprecated: true
      };
      // P10: 已完成任务回退保护
      if (state?.progress?.completed?.includes(task.id)) {
        entry.completedWarning = `⚠️ 任务 ${task.id} 已完成并通过验证，废弃可能导致回归`;
        impact.riskLevel = 'high';
      }
      impact.tasksToRemove.push(entry);
    }
  }

  // 7. 修改接口 → 修改任务
  for (const api of apiDiff.modified) {
    const relatedTasks = findTasksByApi(api.name, existingTasks);
    for (const task of relatedTasks) {
      const entry: TaskToModify = {
        id: task.id,
        name: task.name,
        changes: api.changes,
        before: { steps: task.steps },
        after: { steps: [...task.steps, { id: 'D1', description: `接口变化：${api.changes}`, expected: '相关调用与类型已同步' }] },
        rationale: `接口 ${api.name} 签名变更`
      };
      // P10: 已完成任务回退保护
      if (state?.progress?.completed?.includes(task.id)) {
        entry.completedWarning = `⚠️ 任务 ${task.id} 已完成并通过验证，修改可能导致回归`;
        impact.riskLevel = 'high';
      }
      impact.tasksToModify.push(entry);
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
  specContent: string,
  existingTasks: WorkflowTaskV2[]
): ImpactAnalysis {
  // 1. 提取结构化需求（如果长度 > 500）
  // NOTE: RequirementAnalysis 已废弃，现使用 RequirementItem[] 场景化提取
  let newRequirements: RequirementItem[] | null = null;
  if (prdContent.length > 500) {
    newRequirements = extractRequirementItems(prdContent);
  }

  // 2. 提取现有需求（从 spec）
  const existingRequirements = extractRequirementsFromSpec(specContent);

  // 3. 对比需求变化（类型归一化，避免混合 string 与 RequirementItem[]）
  const reqDiff = newRequirements
    ? diffRequirements(existingRequirements, newRequirements)
    : simpleTextDiff(
        serializeRequirements(existingRequirements),
        prdContent
      );

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
  let nextIdx = getNextTaskIndex(existingTasks);
  for (const req of reqDiff.added) {
    // simpleTextDiff 返回的 added 项无 type 字段，用通用任务处理
    if (!req.type) {
      impact.tasksToAdd.push({
        id: `T${nextIdx++}`,
        name: `实现需求：${(req.description || '').substring(0, 50)}`,
        phase: 'infra',
        files: { modify: [] },
        spec_ref: '§4 User-facing Behavior',
        plan_ref: `P-req-${nextIdx - 1}`,
        actions: ['edit_file'],
        steps: [{
          id: 'D1',
          description: req.description || '待细化',
          expected: '需求已实现'
        }],
        rationale: `PRD 文本 diff 新增需求`
      });
      continue;
    }
    // 根据需求类型生成任务（结构化 diff 分支）
    if (req.type === 'form_field') {
      impact.tasksToAdd.push({
        id: `T${nextIdx++}`,
        name: `添加表单字段：${req.fieldName}`,
        phase: 'ui-form',
        files: {
          modify: [`src/components/forms/${req.scene}Form.vue`]
        },
        spec_ref: '§4 User-facing Behavior',
        plan_ref: `P-form-${req.scene}-${req.fieldName}`,
        acceptance_criteria: [`表单字段 ${req.fieldName} 可见且校验正确`],
        actions: ['edit_file'],
        steps: [{
          id: 'D1',
          description: `添加 ${req.fieldName} 字段，类型：${req.fieldType}，校验规则：${req.validationRules.join(', ')}`,
          expected: '字段渲染、交互和校验符合需求'
        }],
        rationale: `PRD 新增表单字段`
      });
    } else if (req.type === 'business_rule') {
      impact.tasksToAdd.push({
        id: `T${nextIdx++}`,
        name: `实现业务规则：${req.ruleName}`,
        phase: 'infra',
        files: { modify: ['src/utils/businessRules.ts'] },
        spec_ref: '§3 Constraints',
        plan_ref: `P-rule-${req.ruleName}`,
        actions: ['edit_file'],
        steps: [{
          id: 'D1',
          description: req.description,
          expected: '业务规则已实现并被调用'
        }],
        rationale: `PRD 新增业务规则`
      });
    } else if (req.type === 'ui_component') {
      impact.tasksToAdd.push({
        id: `T${nextIdx++}`,
        name: `创建组件：${req.componentName}`,
        phase: 'ui-display',
        files: { create: [`src/components/${req.componentName}.vue`] },
        spec_ref: '§5 Architecture and Module Design',
        plan_ref: `P-component-${req.componentName}`,
        actions: ['create_file'],
        steps: [{
          id: 'D1',
          description: req.description,
          expected: '组件已创建并接入到对应页面'
        }],
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
    const reqRef = req.before || req;
    const relatedTasks = findTasksByRequirement(reqRef, existingTasks);
    for (const task of relatedTasks) {
      impact.tasksToModify.push({
        id: task.id,
        name: task.name,
        changes: req.changes,
        before: { steps: task.steps },
        after: { steps: [{ id: 'D1', description: req.after?.description || req.changes, expected: '需求变化已实现' }] },
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
async function analyzeRequirementDelta(
  requirement: string,
  specContent: string,
  existingTasks: WorkflowTaskV2[]
): Promise<ImpactAnalysis> {
  // 1. 使用 codebase-retrieval 分析需求，MCP 不可用时降级到本地启发式分析
  let analysisResult: RequirementAnalysisResult;
  let analysisSource: 'mcp' | 'heuristic' = 'mcp';

  try {
    analysisResult = await mcp__auggie-mcp__codebase-retrieval({
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
  } catch {
    analysisSource = 'heuristic';
    analysisResult = heuristicRequirementAnalysis(requirement, specContent, existingTasks);
  }

  // 2. 解析分析结果
  const impact: ImpactAnalysis = {
    tasksToAdd: [],
    tasksToModify: [],
    tasksToRemove: [],
    affectedFiles: extractAffectedFiles(analysisResult),
    affectedModules: extractAffectedModules(analysisResult),
    riskLevel: analysisSource === 'heuristic' ? 'medium' : 'low',
    estimatedEffort: '1-2h'
  };

  // 3. 生成新增任务
  let nextIdx = getNextTaskIndex(existingTasks);
  const newModules = extractNewModules(analysisResult);
  for (const module of newModules) {
    impact.tasksToAdd.push({
      id: `T${nextIdx++}`,
      name: module.name,
      phase: determinePhase(module),
      files: { modify: [module.file] },
      spec_ref: findRelevantSpecSection(specContent, module),
      plan_ref: `P-module-${module.name}`,
      actions: [determineActions(module)],
      steps: [{
        id: 'D1',
        description: module.description,
        expected: '模块变更已落地'
      }],
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
        before: { steps: task.steps },
        after: { steps: [...task.steps, { id: 'D1', description: module.changes, expected: '模块变更已同步' }] },
        rationale: `需求变更影响现有模块`
      });
    }
  }

  // 5. 计算风险等级（heuristic 模式下风险至少为 medium）
  const calculatedRisk = calculateRiskLevel({
    added: newModules,
    modified: modifiedModules,
    removed: []
  });
  if (analysisSource === 'heuristic' && calculatedRisk === 'low') {
    impact.riskLevel = 'medium';
  } else {
    impact.riskLevel = calculatedRisk;
  }

  // 6. 估算工作量
  impact.estimatedEffort = estimateEffort(impact);

  return impact;
}
```

### heuristicRequirementAnalysis

MCP 不可用时的本地降级分析：基于 spec 和现有任务的关键词匹配。

```typescript
function heuristicRequirementAnalysis(
  requirement: string,
  specContent: string,
  existingTasks: WorkflowTaskV2[]
): RequirementAnalysisResult {
  const reqTokens = tokenize(requirement);

  // 从现有任务和 spec 中提取已知文件和模块
  const knownFiles = new Set<string>();
  const knownModules = new Set<string>();
  for (const task of existingTasks) {
    [...(task.files?.create || []), ...(task.files?.modify || [])].forEach(f => knownFiles.add(f));
    if (task.phase) knownModules.add(task.phase);
  }

  // 基于关键词匹配找受影响文件
  const affectedFiles = [...knownFiles].filter(f =>
    reqTokens.some(t => f.toLowerCase().includes(t))
  );

  // 如果需求描述提到新增/创建等意图且没有命中已有文件，推断为新模块
  const newModuleIntent = /新增|创建|添加|新建|implement|create|add/i.test(requirement);
  const newModules: Array<{ name: string; file: string; description: string }> = [];
  if (newModuleIntent && affectedFiles.length === 0) {
    newModules.push({
      name: requirement.substring(0, 50),
      file: '__PLACEHOLDER__/new-feature.ts',  // ⚠️ 占位路径，Step 6 Hard Stop 时强制要求用户替换为真实路径
      description: requirement.substring(0, 100)
    });
  }

  return {
    newModules,
    modifiedModules: affectedFiles.map(f => ({ file: f, changes: requirement.substring(0, 100) })),
    affectedFiles,
    affectedModules: [...knownModules],
    source: 'heuristic'
  };
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
  added: RequirementItem[];
  removed: RequirementItem[];
  modified: Array<{
    changes: string;
    before: RequirementItem;
    after: RequirementItem;
  }>;
}

function diffRequirements(
  oldReq: string | RequirementItem[],
  newReq: string | RequirementItem[]
): RequirementDiff {
  // 类型不一致时先归一化为字符串
  if (typeof oldReq !== typeof newReq) {
    return simpleTextDiff(
      serializeRequirements(oldReq),
      serializeRequirements(newReq)
    );
  }

  if (typeof oldReq === 'string' && typeof newReq === 'string') {
    return simpleTextDiff(oldReq, newReq);
  }

  return structuredRequirementDiff(oldReq as RequirementItem[], newReq as RequirementItem[]);
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
function findTasksByApi(apiName: string, tasks: WorkflowTaskV2[]): WorkflowTaskV2[] {
  return tasks.filter(task => {
    const stepText = task.steps.map(step => `${step.description} ${step.expected}`).join(' ').toLowerCase();
    const fileText = [
      ...(task.files.create || []),
      ...(task.files.modify || []),
      ...(task.files.test || [])
    ].join(' ').toLowerCase();
    const name = task.name?.toLowerCase() || '';

    return stepText.includes(apiName.toLowerCase()) ||
           fileText.includes(apiName.toLowerCase()) ||
           name.includes(apiName.toLowerCase());
  });
}
```

### findTasksByRequirement

根据需求查找相关任务。

```typescript
function findTasksByRequirement(req: RequirementItem, tasks: WorkflowTaskV2[]): WorkflowTaskV2[] {
  return tasks.filter(task => {
    // 优先结构化关联
    if (req.id && task.requirementIds?.includes(req.id)) return true;

    // 文本兜底：基于 token 重叠度，避免短文本误匹配
    const reqTokens = tokenize(req.description || '');
    const taskTokens = tokenize(
      task.steps.map(step => `${step.description} ${step.expected}`).join(' ')
      + ' ' + (task.name || '')
    );

    if (reqTokens.length === 0 || taskTokens.length === 0) return false;

    const overlap = reqTokens.filter(t => taskTokens.includes(t));
    return overlap.length >= 2 && (overlap.length / Math.min(reqTokens.length, taskTokens.length)) >= 0.6;
  });
}

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}
```

### findTasksByFile

根据文件路径查找相关任务。

```typescript
function findTasksByFile(filePath: string, tasks: WorkflowTaskV2[]): WorkflowTaskV2[] {
  return tasks.filter(task =>
    (task.files.create || []).includes(filePath) ||
    (task.files.modify || []).includes(filePath) ||
    (task.files.test || []).includes(filePath)
  );
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
  specContent,
  existingTasks
);

// 需求描述影响分析
const reqImpact = analyzeRequirementDelta(
  requirement,
  specContent,
  existingTasks
);
```
