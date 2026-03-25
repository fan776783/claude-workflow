# API 同步详情

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

### Step 2: 执行 ytt 命令

```typescript
console.log(`⏳ 执行 pnpm ytt 同步 API...`);

const result = await Bash({
  command: 'pnpm ytt',
  timeout: 120000,  // 2 分钟超时
  description: '执行 ytt 生成 API 代码'
});

if (result.exitCode !== 0) {
  console.log(`
🚨 ytt 执行失败

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

### Step 3: 解析生成的 API 文件

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

### Step 4: 对比接口变化

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

### Step 5: 更新 API 上下文

```typescript
// 更新 state.api_context
state.api_context = {
  interfaces: allInterfaces,
  lastSync: new Date().toISOString(),
  source: 'ytt',
  version: extractApiVersion(result.stdout)
};

writeFile(statePath, JSON.stringify(state, null, 2));
```

---

### Step 6: 解除 api_spec 阻塞

```typescript
// 自动解除 api_spec 阻塞
if (!state.unblocked?.includes('api_spec')) {
  state.unblocked = [...(state.unblocked || []), 'api_spec'];
}

// 更新被阻塞任务的状态
updateBlockedTasks(state, tasksPath);

console.log(`
✅ 已解除 api_spec 阻塞

可执行的任务：
${getUnblockedTasks(state, tasksPath).map(t => `- ${t.id}: ${t.name}`).join('\n')}
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

        // 从 state.progress.blocked 中移除
        state.progress.blocked = state.progress.blocked.filter(id => id !== task.id);

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

  // 匹配 blocked_by 行
  const regex = new RegExp(
    `(##+ ${escapedId}:[\\s\\S]*?)(- \\*\\*阻塞依赖\\*\\*:\\s*\`[^\`]+\`)`,
    'gm'
  );

  if (blockedBy.length === 0) {
    // 移除 blocked_by 行
    return content.replace(regex, '$1');
  } else {
    // 更新 blocked_by 列表
    const newLine = `- **阻塞依赖**: \`${blockedBy.join(', ')}\``;
    return content.replace(regex, `$1${newLine}`);
  }
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
