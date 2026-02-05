# workflow delta - 增量变更 (v3.1)

统一入口：处理需求更新、API 变更等外部规格变化。

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

## 🎯 执行流程

### Step 0：智能解析输入

```typescript
const input = $ARGUMENTS.join(' ').trim();

// 智能识别输入类型
type DeltaType = 'prd' | 'api' | 'requirement' | 'sync';

function detectDeltaType(input: string): { type: DeltaType; content: string; source: string } {
  // 0. 无参数 → 同步 API
  if (!input) {
    return {
      type: 'sync',
      content: '',
      source: 'ytt'
    };
  }

  // 1. 检查是否为 API 文件
  if (/Api\.ts$|autogen\/.*\.ts$|\.api\.ts$/.test(input) && fileExists(input)) {
    return {
      type: 'api',
      content: readFile(input),
      source: input
    };
  }

  // 2. 检查是否为 PRD 文件
  if (/\.md$/.test(input) && fileExists(input)) {
    return {
      type: 'prd',
      content: readFile(input),
      source: input
    };
  }

  // 3. 其他视为需求描述
  return {
    type: 'requirement',
    content: input,
    source: 'inline'
  };
}

const delta = detectDeltaType(input);
console.log(`📋 变更类型：${delta.type}（来源：${delta.source}）`);
```

---

### Step 1：加载工作流状态

```typescript
const configPath = '.claude/config/project-config.json';
if (!fileExists(configPath)) {
  console.log(`🚨 项目配置不存在，请先执行 /scan`);
  return;
}

const projectConfig = JSON.parse(readFile(configPath));
const projectId = projectConfig.project?.id;

if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
  console.log(`🚨 项目 ID 无效`);
  return;
}

const workflowDir = path.join(os.homedir(), '.claude/workflows', projectId);
const statePath = path.join(workflowDir, 'workflow-state.json');

if (!fileExists(statePath)) {
  console.log(`🚨 工作流未启动，请先执行 /workflow start`);
  return;
}

const state = JSON.parse(readFile(statePath));
const techDesignPath = state.tech_design;
const tasksPath = path.join(workflowDir, state.tasks_file);
```

---

### Step 2：生成变更 ID

```typescript
const changeCounter = (state.delta_tracking?.change_counter || 0) + 1;
const changeId = `CHG-${String(changeCounter).padStart(3, '0')}`;
const changesDir = path.join(workflowDir, 'changes', changeId);
ensureDir(changesDir);

state.delta_tracking = state.delta_tracking || { enabled: true, changes_dir: 'changes/', applied_changes: [] };
state.delta_tracking.change_counter = changeCounter;
state.delta_tracking.current_change = changeId;
```

---

### Step 3：分析变更影响

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 分析变更影响
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 读取现有技术方案和任务
const techDesign = readFile(techDesignPath);
const tasksContent = readFile(tasksPath);
const existingTasks = parseTasksFromMarkdown(tasksContent);

// 根据变更类型分析影响
let impactAnalysis: ImpactAnalysis;

switch (delta.type) {
  case 'api':
    impactAnalysis = analyzeApiDelta(delta.content, existingTasks, state.api_context);
    break;

  case 'prd':
    impactAnalysis = analyzePrdDelta(delta.content, techDesign, existingTasks);
    break;

  case 'requirement':
    impactAnalysis = analyzeRequirementDelta(delta.content, techDesign, existingTasks);
    break;
}

console.log(`
变更 ID：${changeId}
变更类型：${delta.type}
来源：${delta.source}

**影响分析**：
- 新增任务：${impactAnalysis.tasksToAdd.length}
- 修改任务：${impactAnalysis.tasksToModify.length}
- 废弃任务：${impactAnalysis.tasksToRemove.length}
- 受影响文件：${impactAnalysis.affectedFiles.length}
`);
```

---

### Step 4：生成 Delta 文档

```typescript
// 生成 delta.json
const deltaDoc = {
  id: changeId,
  parent_change: state.delta_tracking.applied_changes.slice(-1)[0] || null,
  created_at: new Date().toISOString(),
  status: 'pending',
  trigger: {
    type: delta.type,
    source: delta.source,
    description: delta.content.substring(0, 500)
  },
  impact: impactAnalysis,
  spec_deltas: generateSpecDeltas(delta, techDesign),
  task_deltas: generateTaskDeltas(impactAnalysis)
};

writeFile(path.join(changesDir, 'delta.json'), JSON.stringify(deltaDoc, null, 2));

// 生成 intent.md（人类可读）
const intentContent = `# 变更意图：${changeId}

## 触发

- **类型**：${delta.type}
- **来源**：${delta.source}
- **时间**：${new Date().toISOString()}

## 变更内容

${delta.type === 'requirement' ? delta.content : `见文件：${delta.source}`}

## 影响分析

### 新增任务

${impactAnalysis.tasksToAdd.map(t => `- ${t.name}`).join('\n') || '（无）'}

### 修改任务

${impactAnalysis.tasksToModify.map(t => `- ${t.id}: ${t.name} → ${t.changes}`).join('\n') || '（无）'}

### 废弃任务

${impactAnalysis.tasksToRemove.map(t => `- ${t.id}: ${t.name}（原因：${t.reason}）`).join('\n') || '（无）'}

## 审查状态

- **状态**：pending
- **审查人**：-
`;

writeFile(path.join(changesDir, 'intent.md'), intentContent);
```

---

### Step 5：API 变更 / 同步处理

```typescript
if (delta.type === 'api' || delta.type === 'sync') {
  const projectRoot = process.cwd();
  const yttConfigPath = path.join(projectRoot, 'ytt.config.ts');

  // sync 模式：执行 ytt 生成全部 API
  if (delta.type === 'sync') {
    if (!fileExists(yttConfigPath)) {
      console.log(`🚨 ytt.config.ts 不存在，无法执行 API 同步`);
      return;
    }

    console.log(`⏳ 执行 pnpm ytt 同步 API...`);
    const result = await Bash({
      command: 'pnpm ytt',
      timeout: 120000
    });

    if (result.exitCode !== 0) {
      console.log(`🚨 ytt 执行失败：${result.stderr}`);
      return;
    }

    console.log(`✅ API 代码已同步`);

    // 自动解除 api_spec 阻塞
    if (!state.unblocked?.includes('api_spec')) {
      state.unblocked = [...(state.unblocked || []), 'api_spec'];
    }

    // 更新状态并解除阻塞的任务
    updateBlockedTasks(state, tasksPath);
    saveWorkflowState(state);

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ API 同步完成

已解除 api_spec 阻塞，可执行依赖 API 的任务。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **下一步**

\`\`\`bash
/workflow status    # 查看任务状态
/workflow execute   # 继续执行
\`\`\`
`);
    return;
  }

  // api 模式：解析指定 API 文件
  const newApiInfo = parseApiFile(delta.source);
  const oldApiInfo = state.api_context?.interfaces || [];

  // 对比接口变化
  const apiDiff = diffApiInterfaces(oldApiInfo, newApiInfo.interfaces);

  console.log(`
📡 API 变更详情：

新增接口：${apiDiff.added.length}
${apiDiff.added.map(api => `  + ${api.name}: ${api.method} ${api.path}`).join('\n')}

删除接口：${apiDiff.removed.length}
${apiDiff.removed.map(api => `  - ${api.name}`).join('\n')}

修改接口：${apiDiff.modified.length}
${apiDiff.modified.map(api => `  ~ ${api.name}: ${api.changes}`).join('\n')}
`);

  // 更新 api_context
  state.api_context = {
    source: delta.source,
    interfaces: newApiInfo.interfaces,
    fetched_at: new Date().toISOString(),
    previous_version: oldApiInfo
  };

  // 自动解除 api_spec 阻塞
  if (!state.unblocked?.includes('api_spec')) {
    state.unblocked = [...(state.unblocked || []), 'api_spec'];
    console.log(`✅ 已自动解除 api_spec 阻塞`);
  }
}
```

---

### Step 6：🛑 Hard Stop - 确认变更

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛑 **变更确认**

变更 ID：${changeId}
Intent 文档：${path.join(changesDir, 'intent.md')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const choice = await AskUserQuestion({
  questions: [{
    question: "如何处理此变更？",
    header: "变更确认",
    multiSelect: false,
    options: [
      { label: "应用变更", description: "更新技术方案和任务清单" },
      { label: "仅更新 API 上下文", description: "不修改任务，仅同步接口信息（适用于 API 变更）" },
      { label: "暂存", description: "保存变更记录，稍后处理" },
      { label: "放弃", description: "删除此变更" }
    ]
  }]
});

if (choice === "放弃") {
  await Bash({ command: `rm -rf "${changesDir}"` });
  console.log(`✅ 变更已放弃`);
  return;
}

if (choice === "暂存") {
  deltaDoc.status = 'stashed';
  writeFile(path.join(changesDir, 'delta.json'), JSON.stringify(deltaDoc, null, 2));
  console.log(`📦 变更已暂存：${changeId}`);
  return;
}

if (choice === "仅更新 API 上下文") {
  // 只保存 API 上下文，不修改任务
  saveWorkflowState(state);
  console.log(`✅ API 上下文已更新`);
  return;
}
```

---

### Step 7：应用变更

```typescript
console.log(`⏳ 应用变更...`);

// 1. 更新技术方案（如果是 PRD 变更）
if (delta.type === 'prd' || delta.type === 'requirement') {
  const updatedTechDesign = updateTechDesign(techDesign, impactAnalysis);
  writeFile(techDesignPath, updatedTechDesign);
  console.log(`✅ 技术方案已更新：${techDesignPath}`);
}

// 2. 更新任务清单
let updatedTasksContent = tasksContent;

// 添加新任务
for (const newTask of impactAnalysis.tasksToAdd) {
  const taskMd = renderTaskMarkdown(newTask);
  updatedTasksContent = insertTaskBefore(updatedTasksContent, newTask.insertBefore, taskMd);
}

// 修改现有任务
for (const modTask of impactAnalysis.tasksToModify) {
  updatedTasksContent = updateTaskInMarkdown(updatedTasksContent, modTask.id, modTask.updates);
}

// 标记废弃任务
for (const removeTask of impactAnalysis.tasksToRemove) {
  updatedTasksContent = markTaskDeprecated(updatedTasksContent, removeTask.id, removeTask.reason);
}

// 更新 frontmatter
updatedTasksContent = updateTasksFrontmatter(updatedTasksContent, changeId);

writeFile(tasksPath, updatedTasksContent);
console.log(`✅ 任务清单已更新：${tasksPath}`);

// 3. 更新状态
deltaDoc.status = 'applied';
state.delta_tracking.applied_changes.push(changeId);
state.updated_at = new Date().toISOString();

writeFile(path.join(changesDir, 'delta.json'), JSON.stringify(deltaDoc, null, 2));
saveWorkflowState(state);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 变更已应用：${changeId}

**更新内容**：
- 新增任务：${impactAnalysis.tasksToAdd.length}
- 修改任务：${impactAnalysis.tasksToModify.length}
- 废弃任务：${impactAnalysis.tasksToRemove.length}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **下一步**

\`\`\`bash
/workflow status    # 查看更新后的任务
/workflow execute   # 继续执行
\`\`\`
`);
```

---

## 📦 辅助函数

```typescript
interface ImpactAnalysis {
  tasksToAdd: NewTask[];
  tasksToModify: TaskModification[];
  tasksToRemove: TaskRemoval[];
  affectedFiles: string[];
}

interface NewTask {
  name: string;
  phase: string;
  requirement: string;
  insertBefore?: string;  // 插入到哪个任务之前
}

interface TaskModification {
  id: string;
  name: string;
  changes: string;
  updates: Partial<Task>;
}

interface TaskRemoval {
  id: string;
  name: string;
  reason: string;
}

/**
 * 分析 API 变更对任务的影响
 */
function analyzeApiDelta(
  newApiContent: string,
  existingTasks: Task[],
  oldApiContext: ApiContext | null
): ImpactAnalysis {
  const newApis = parseApiFile(newApiContent);
  const oldApis = oldApiContext?.interfaces || [];

  const added = newApis.filter(n => !oldApis.some(o => o.name === n.name));
  const removed = oldApis.filter(o => !newApis.some(n => n.name === o.name));

  // 找出依赖被删除接口的任务
  const tasksToModify = existingTasks
    .filter(task => {
      const apiRefs = task.api_context || [];
      return removed.some(api => apiRefs.includes(api.name));
    })
    .map(task => ({
      id: task.id,
      name: task.name,
      changes: '接口已变更，需要更新调用',
      updates: { status: 'pending', notes: '接口已变更' }
    }));

  return {
    tasksToAdd: [],
    tasksToModify,
    tasksToRemove: [],
    affectedFiles: existingTasks.filter(t => tasksToModify.some(m => m.id === t.id)).map(t => t.file).filter(Boolean)
  };
}

/**
 * 分析 PRD 变更对任务的影响
 */
function analyzePrdDelta(
  newPrdContent: string,
  techDesign: string,
  existingTasks: Task[]
): ImpactAnalysis {
  // 使用 codebase-retrieval 或 LLM 分析 PRD 差异
  // 这里简化为让模型自行判断

  return {
    tasksToAdd: [],      // 由模型在执行时填充
    tasksToModify: [],
    tasksToRemove: [],
    affectedFiles: []
  };
}

/**
 * 对比 API 接口差异
 */
function diffApiInterfaces(
  oldApis: ApiInterface[],
  newApis: ApiInterface[]
): { added: ApiInterface[]; removed: ApiInterface[]; modified: ApiInterface[] } {
  const added = newApis.filter(n => !oldApis.some(o => o.name === n.name));
  const removed = oldApis.filter(o => !newApis.some(n => n.name === o.name));

  const modified = newApis.filter(n => {
    const old = oldApis.find(o => o.name === n.name);
    if (!old) return false;
    return old.path !== n.path || old.method !== n.method;
  });

  return { added, removed, modified };
}
```

---

## 🔄 相关命令

```bash
/workflow status              # 查看任务状态
/workflow execute             # 执行任务
/workflow unblock api_spec    # 解除 API 阻塞
```
