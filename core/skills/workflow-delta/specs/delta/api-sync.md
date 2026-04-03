# API 同步详情

## 快速导航

- 想看 sync / api 两种模式：看“同步模式”
- 想看 `pnpm ytt` / `ytt.config.ts` 约束：看各模式说明与后续步骤
- 想看 unblock / state.api_context 更新：看对应处理步骤
- 想看哪些内容属于项目示例而非 workflow 通用契约：结合 `../../../../specs/workflow-runtime/external-deps.md`

## 何时读取

- `/workflow delta` 识别为 API 相关输入时
- 需要确认 API 生成、接口 diff、解除 `api_spec` 阻塞规则时

## 概述

API 同步是 workflow delta 的核心功能之一，用于处理后端接口变更和前端 API 代码生成。

## 同步模式

### sync 模式（无参数）

**触发**: `/workflow delta`

**行为**:
1. 检查 `ytt.config.ts` 是否存在
2. 执行 `pnpm ytt` 生成全部 API 代码
3. 自动解除 `api_spec` 阻塞
4. 更新被阻塞任务状态

**适用场景**:
- 后端接口已就绪
- 需要批量生成前端 API 调用代码
- 解除所有等待 API 的任务阻塞

---

### api 模式（指定文件）

**触发**: `/workflow delta packages/api/.../teamApi.ts`

**行为**:
1. 解析指定 API 文件
2. 对比新旧接口变化
3. 生成 API 变更详情
4. 更新 `state.api_context`

**适用场景**:
- 单个 API 文件更新
- 接口签名变更
- 新增/删除接口

---

## 实现细节

### Step 1: 检查 ytt 配置

```typescript
const projectRoot = process.cwd();
const yttConfigPath = path.join(projectRoot, 'ytt.config.ts');

if (!fileExists(yttConfigPath)) {
  console.log(`
🚨 ytt.config.ts 不存在，无法执行 API 同步

请确保项目根目录存在 ytt.config.ts 配置文件。

💡 如果项目不使用 ytt，请使用其他方式同步 API：
  /workflow delta packages/api/.../teamApi.ts
  `);
  return;
}
```

---

### Step 2: 生成变更记录

sync 模式也必须接入 delta tracking，确保审计链完整。

```typescript
// 生成变更 ID 并创建变更目录
state.delta_tracking = state.delta_tracking || { enabled: true, change_counter: 0, applied_changes: [] };
state.delta_tracking.change_counter++;
const changeId = `CHG-${String(state.delta_tracking.change_counter).padStart(3, '0')}`;
const changeDir = path.join(workflowDir, 'changes', changeId);
mkdirSync(changeDir, { recursive: true });
```

---

### Step 3: 执行 ytt 命令

```typescript
console.log(`⏳ 执行 pnpm ytt 同步 API...`);

const result = await Bash({
  command: 'pnpm ytt',
  timeout: 120000,  // 2 分钟超时
  description: '执行 ytt 生成 API 代码'
});

if (result.exitCode !== 0) {
  // 回滚：标记变更为失败态，避免 orphaned 目录和计数跳号
  writeFile(path.join(changeDir, 'delta.json'), JSON.stringify({
    changeId,
    trigger: { type: 'sync', source: 'pnpm ytt' },
    status: 'failed',
    error: result.stderr?.substring(0, 500),
    createdAt: new Date().toISOString()
  }, null, 2));
  // 不将失败变更加入 applied_changes，但保留目录用于排查
  writeFile(statePath, JSON.stringify(state, null, 2));

  console.log(`
🚨 ytt 执行失败（变更 ${changeId} 已记录为失败态）

错误信息：
${result.stderr}

请检查：
1. ytt.config.ts 配置是否正确
2. 后端接口文档是否可访问
3. 网络连接是否正常

💡 手动执行查看详细错误：
  pnpm ytt
  `);
  return;
}

console.log(`
✅ API 代码已同步

生成的文件：
${result.stdout}
`);
```

---

### Step 4: 解析生成的 API 文件

```typescript
// 查找所有生成的 API 文件
const apiFiles = await Glob({
  pattern: '**/autogen/**/*Api.ts',
  path: projectRoot
});

// 解析每个 API 文件
const allInterfaces: ApiInterface[] = [];

for (const apiFile of apiFiles) {
  const content = readFile(apiFile);
  const apiInfo = parseApiFile(content);
  allInterfaces.push(...apiInfo.interfaces);
}

console.log(`
📡 API 接口统计：
- 总接口数：${allInterfaces.length}
- 文件数：${apiFiles.length}
`);
```

---

### Step 5: 对比接口变化

```typescript
// 获取旧 API 信息
const oldApiInfo = state.api_context?.interfaces || [];

// 对比接口变化
const apiDiff = diffApiInterfaces(oldApiInfo, allInterfaces);

console.log(`
📊 API 变更详情：

新增接口：${apiDiff.added.length}
${apiDiff.added.map(api => `  + ${api.name}: ${api.method} ${api.path}`).join('\n')}

删除接口：${apiDiff.removed.length}
${apiDiff.removed.map(api => `  - ${api.name}`).join('\n')}

修改接口：${apiDiff.modified.length}
${apiDiff.modified.map(api => `  ~ ${api.name}: ${api.changes}`).join('\n')}
`);
```

---

### Step 6: 更新 API 上下文

```typescript
// 更新 state.api_context
state.api_context = {
  interfaces: allInterfaces,
  lastSync: new Date().toISOString(),
  source: 'ytt',
  version: extractApiVersion(result.stdout)
};
```

---

### Step 7: 写入 delta 文档（先审计）

> 「先审计后生效」原则：先写入变更记录（delta.json + intent.md + review-status.json），再执行状态变更。
> 这确保即使 state 写入失败，审计记录也已存在，可用于排查。

```typescript
// 预判可解除阻塞的任务（此时 state 尚未持久化，使用内存中的 unblocked 列表预计算）
const projectedUnblocked = [...(state.unblocked || []), 'api_spec'];
const newlyUnblockedTasks = getUnblockedTasksProjected(projectedUnblocked, tasksPath);

// 写入 delta.json
const deltaJson = {
  changeId,
  parent: state.delta_tracking.applied_changes.slice(-1)[0] || null,
  trigger: { type: 'sync', source: 'pnpm ytt', description: 'API 全量同步' },
  impact: {
    added: apiDiff.added.map(a => a.name),
    removed: apiDiff.removed.map(a => a.name),
    modified: apiDiff.modified.map(a => a.name),
  },
  unblockedTasks: newlyUnblockedTasks.map(t => t.id),
  createdAt: new Date().toISOString()
};
writeFile(path.join(changeDir, 'delta.json'), JSON.stringify(deltaJson, null, 2));

// 写入 intent.md
const intentMd = [
  `# ${changeId}: API 全量同步`,
  '',
  `## 变更意图`,
  `执行 \`pnpm ytt\` 同步全部 API 代码，解除 api_spec 阻塞。`,
  '',
  `## 变更内容`,
  `- 新增接口：${apiDiff.added.length}`,
  `- 删除接口：${apiDiff.removed.length}`,
  `- 修改接口：${apiDiff.modified.length}`,
  `- 解除阻塞任务：${newlyUnblockedTasks.length}`,
  '',
  `## 审查状态`,
  `- [x] 自动应用（sync 模式）`
].join('\n');
writeFile(path.join(changeDir, 'intent.md'), intentMd);

// 写入 review-status.json
writeFile(path.join(changeDir, 'review-status.json'), JSON.stringify({
  status: 'auto_applied',
  mode: 'sync',
  reviewedAt: new Date().toISOString()
}, null, 2));
```

---

### Step 8: 解除 api_spec 阻塞 + 持久化 state（后生效）

> 审计记录已写入（Step 7），现在执行状态变更并一次性持久化。

```typescript
// 自动解除 api_spec 阻塞
if (!state.unblocked?.includes('api_spec')) {
  state.unblocked = [...(state.unblocked || []), 'api_spec'];
}

// 更新被阻塞任务的状态
updateBlockedTasks(state, tasksPath);

// 如果工作流级状态为 blocked，迁移到 running
if (state.status === 'blocked') {
  state.status = 'running';
}

// 更新 tracking 状态（与 api_context 、unblocked 、progress 一并持久化）
state.delta_tracking.current_change = changeId;
state.delta_tracking.applied_changes.push(changeId);

// 一次性持久化最终状态（api_context + unblocked + progress.blocked + status + delta_tracking）
writeFile(statePath, JSON.stringify(state, null, 2));

console.log(`
✅ 已解除 api_spec 阻塞

可执行的任务：
${newlyUnblockedTasks.map(t => `- ${t.id}: ${t.name}`).join('\n')}
`);
```

---

## API 文件解析

### parseApiFile

解析 API 文件，提取接口信息。

```typescript
interface ApiInterface {
  name: string;
  method: string;
  path: string;
  module: string;
  request: Parameter[];
  response: Parameter[];
  description?: string;
}

> `ApiInterface` 是 workflow-delta 的 canonical diff 模型，用于 `diffApiInterfaces`、`detectApiChanges` 和 impact 分析。
> `external-deps.md` 中的 `ApiInterfaceSummary` 只用于 unblock / API 上下文注入；如需进入 delta 分析，先转换为此结构。

interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

function parseApiFile(content: string): {
  interfaces: ApiInterface[];
  module: string;
} {
  const interfaces: ApiInterface[] = [];
  let module = 'unknown';

  // 1. 提取模块名
  const moduleMatch = content.match(/export\s+namespace\s+(\w+)/);
  if (moduleMatch) {
    module = moduleMatch[1];
  }

  // 2. 提取接口定义
  // 匹配格式：export const getTeamList = (params: GetTeamListParams) => request<GetTeamListResponse>({ ... })
  const interfaceRegex = /export\s+const\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*request<([^>]+)>\s*\(\s*\{([^}]+)\}/g;

  let match;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const [, name, params, responseType, config] = match;

    // 解析请求参数
    const request = parseParameters(params);

    // 解析响应类型
    const response = parseResponseType(responseType);

    // 解析配置（method, url）
    const method = extractMethod(config);
    const path = extractPath(config);

    interfaces.push({
      name,
      method,
      path,
      module,
      request,
      response
    });
  }

  return { interfaces, module };
}
```

### parseParameters

解析函数参数。

```typescript
function parseParameters(paramsStr: string): Parameter[] {
  if (!paramsStr.trim()) return [];

  const params: Parameter[] = [];
  const paramRegex = /(\w+)\s*:\s*([^,]+)/g;

  let match;
  while ((match = paramRegex.exec(paramsStr)) !== null) {
    const [, name, type] = match;
    params.push({
      name,
      type: type.trim(),
      required: !type.includes('?')
    });
  }

  return params;
}
```

### parseResponseType

解析响应类型。

```typescript
function parseResponseType(typeStr: string): Parameter[] {
  // 简化处理：提取类型名称
  return [{
    name: 'data',
    type: typeStr.trim(),
    required: true
  }];
}
```

### extractMethod

从配置中提取 HTTP 方法。

```typescript
function extractMethod(config: string): string {
  const methodMatch = config.match(/method:\s*['"](\w+)['"]/);
  return methodMatch ? methodMatch[1].toUpperCase() : 'GET';
}
```

### extractPath

从配置中提取 API 路径。

```typescript
function extractPath(config: string): string {
  const pathMatch = config.match(/url:\s*['"]([^'"]+)['"]/);
  return pathMatch ? pathMatch[1] : '';
}
```

---

## 阻塞任务更新

### updateBlockedTasks

更新被阻塞任务的状态。

```typescript
function updateBlockedTasks(state: any, tasksPath: string): void {
  const tasksContent = readFile(tasksPath);
  const tasks = parseWorkflowTasksV2FromMarkdown(tasksContent);

  let updatedContent = tasksContent;
  let unblockedCount = 0;

  for (const task of tasks) {
    // 检查任务是否被 api_spec 阻塞
    if (task.blocked_by?.includes('api_spec') && state.unblocked?.includes('api_spec')) {
      // 移除 api_spec 阻塞
      const remainingBlocks = task.blocked_by.filter(b => b !== 'api_spec');

      if (remainingBlocks.length === 0) {
        // 所有阻塞已解除，更新状态为 pending
        updatedContent = updateTaskBlockedBy(updatedContent, task.id, []);
        updatedContent = updateTaskStatus(updatedContent, task.id, 'pending');

        // 从 state.progress.blocked 中移除（兼容最小状态 schema，blocked 为可选字段）
        if (Array.isArray(state.progress.blocked)) {
          state.progress.blocked = state.progress.blocked.filter(id => id !== task.id);
        }

        unblockedCount++;
      } else {
        // 仍有其他阻塞，更新 blocked_by 列表
        updatedContent = updateTaskBlockedBy(updatedContent, task.id, remainingBlocks);
      }
    }
  }

  // 写回文件
  writeFile(tasksPath, updatedContent);

  console.log(`✅ 已解除 ${unblockedCount} 个任务的阻塞`);
}
```

### updateTaskBlockedBy

更新任务的 blocked_by 字段。

```typescript
function updateTaskBlockedBy(
  content: string,
  taskId: string,
  blockedBy: string[]
): string {
  if (!validateTaskId(taskId)) {
    throw new Error(`Invalid task ID: ${taskId}`);
  }

  const escapedId = escapeRegExp(taskId);

  // 先匹配整个任务块（到下一个任务头或文件末尾）
  // 兼容 T\d+ 和 Task-\d+ 两种 ID 格式
  const blockRegex = new RegExp(
    `(^##+\\s+${escapedId}:.*?)(?=^##+\\s+(?:T|Task-)\\d+:|$)`,
    'gms'
  );

  return content.replace(blockRegex, (block) => {
    const lineRegex = /^[ \t]*- \*\*阻塞依赖\*\*:\s*`[^`\n]*`\r?\n?/m;

    if (blockedBy.length === 0) {
      // 删除 blocked_by 行（含换行符）
      return block.replace(lineRegex, '');
    }

    const newLine = `- **阻塞依赖**: \`${blockedBy.join(', ')}\`\n`;
    if (lineRegex.test(block)) {
      return block.replace(lineRegex, newLine);
    }
    // 原来不存在 blocked_by 行时，在任务头后插入
    return block.replace(/^(##+\s+.*\n)/, `$1${newLine}`);
  });
}
```

### getUnblockedTasks

获取已解除阻塞的任务列表。

```typescript
function getUnblockedTasks(state: any, tasksPath: string): WorkflowTaskV2[] {
  const tasksContent = readFile(tasksPath);
  const tasks = parseWorkflowTasksV2FromMarkdown(tasksContent);

  return tasks.filter(task => {
    // 任务状态为 pending
    if (task.status !== 'pending') return false;

    // 没有阻塞依赖，或所有阻塞依赖已解除
    if (!task.blocked_by || task.blocked_by.length === 0) return true;

    const remainingBlocks = task.blocked_by.filter(b => !state.unblocked?.includes(b));
    return remainingBlocks.length === 0;
  });
}
```

---

## ytt 配置示例

### ytt.config.ts

```typescript
import { defineConfig } from 'ytt';

export default defineConfig({
  // API 文档地址
  apiDoc: 'http://api.example.com/swagger.json',

  // 输出目录
  output: 'packages/api/src/autogen',

  // 模板配置
  templates: {
    api: 'templates/api.hbs',
    types: 'templates/types.hbs'
  },

  // 接口分组
  groups: [
    {
      name: 'team',
      pattern: '/api/team/**',
      output: 'teamApi.ts'
    },
    {
      name: 'user',
      pattern: '/api/user/**',
      output: 'userApi.ts'
    }
  ],

  // 类型映射
  typeMapping: {
    'integer': 'number',
    'long': 'number',
    'float': 'number',
    'double': 'number',
    'string': 'string',
    'boolean': 'boolean',
    'array': 'Array',
    'object': 'Record<string, any>'
  }
});
```

---

## 错误处理

### ytt 执行失败

```typescript
if (result.exitCode !== 0) {
  // 记录失败原因
  const failureReason = parseYttError(result.stderr);

  console.log(`
🚨 ytt 执行失败

错误类型：${failureReason.type}
错误信息：${failureReason.message}

常见问题：
1. API 文档地址不可访问
   - 检查 ytt.config.ts 中的 apiDoc 配置
   - 确认网络连接正常
   - 尝试在浏览器中访问 API 文档

2. 输出目录权限不足
   - 检查 output 目录是否存在
   - 确认有写入权限

3. 模板文件缺失
   - 检查 templates 目录是否存在
   - 确认模板文件路径正确

💡 手动执行查看详细错误：
  pnpm ytt --verbose
  `);

  return;
}
```

### parseYttError

解析 ytt 错误信息。

```typescript
function parseYttError(stderr: string): {
  type: string;
  message: string;
} {
  // 网络错误
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(stderr)) {
    return {
      type: 'network',
      message: 'API 文档地址不可访问'
    };
  }

  // 权限错误
  if (/EACCES|EPERM/.test(stderr)) {
    return {
      type: 'permission',
      message: '输出目录权限不足'
    };
  }

  // 模板错误
  if (/template|handlebars/.test(stderr)) {
    return {
      type: 'template',
      message: '模板文件错误'
    };
  }

  // 其他错误
  return {
    type: 'unknown',
    message: stderr.substring(0, 200)
  };
}
```

---

## 使用示例

### 示例 1: 批量同步 API

```bash
# 执行 ytt 同步全部 API
/workflow delta

# 输出：
# ⏳ 执行 pnpm ytt 同步 API...
# ✅ API 代码已同步
#
# 📡 API 接口统计：
# - 总接口数：42
# - 文件数：5
#
# 📊 API 变更详情：
# 新增接口：3
#   + getTeamList: GET /api/team/list
#   + createTeam: POST /api/team/create
#   + deleteTeam: DELETE /api/team/{id}
#
# ✅ 已解除 api_spec 阻塞
#
# 可执行的任务：
# - T3: 实现团队列表接口调用
# - T4: 实现创建团队接口调用
```

### 示例 2: 单个 API 文件变更

```bash
# 指定 API 文件
/workflow delta packages/api/src/autogen/teamApi.ts

# 输出：
# 📋 变更类型：api（来源：packages/api/src/autogen/teamApi.ts）
# 🔍 分析变更影响
#
# 📡 API 变更详情：
# 修改接口：1
#   ~ getTeamList: 请求参数变更：新增 pageSize 参数
#
# 变更 ID：CHG-002
# 新增任务：0
# 修改任务：1
# 废弃任务：0
```

---

## 集成测试

### 测试 ytt 同步

```bash
# 1. 确保 ytt.config.ts 存在
ls ytt.config.ts

# 2. 手动执行 ytt
pnpm ytt

# 3. 检查生成的文件
ls packages/api/src/autogen/

# 4. 执行 workflow delta
/workflow delta

# 5. 验证阻塞解除
/workflow status
```
