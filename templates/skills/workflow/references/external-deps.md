# 外部依赖系统 (v3.1)

工作流的外部依赖管理。

## 设计理念

**职责分离原则**：

| 关注点 | 负责 Skill | 说明 |
|--------|-----------|------|
| 业务逻辑 + 数据流 | `/workflow` | 功能实现，使用组件库默认样式 |
| API 接口 | `/workflow delta` | 统一处理 API 同步和变更 |
| 视觉还原 | `/figma-ui` | **独立流程**，不阻塞 workflow |
| 还原验证 | `/visual-diff` | 截图对比 |

```
workflow（功能）  ──▶  figma-ui（视觉）  ──▶  visual-diff（验证）
       │
  delta 同步 API
```

## 依赖类型

| 类型 | 来源 | 入口 |
|------|------|------|
| `api_spec` | YApi / ytt | `/workflow delta` |

> **注意**：`design_spec` 已移除。设计稿还原通过独立的 `/figma-ui` skill 处理。

---

## API 依赖 (`api_spec`)

### 工作原理

```
YApi 平台 ──▶ ytt.config.ts ──▶ pnpm ytt ──▶ autogen/*.ts
                  │
            分类 ID 映射
```

### 使用方式（通过 delta 命令）

```bash
# 同步全部 API（执行 ytt）
/workflow delta

# 指定 API 文件（跳过生成，直接解析）
/workflow delta packages/api/lib/autogen/teamApi.ts
```

### 处理流程

```typescript
async function unblockApiSpec(args: {
  category?: number;
  file?: string;
}): Promise<UnblockResult> {
  const projectRoot = process.cwd();

  // Step 1: 检查 ytt.config.ts 是否存在
  const yttConfigPath = path.join(projectRoot, 'ytt.config.ts');
  if (!fileExists(yttConfigPath)) {
    return { success: false, error: 'ytt.config.ts 不存在，无法执行 API 生成' };
  }

  // Step 2: 如果指定了文件，验证文件存在
  if (args.file) {
    const apiFilePath = path.join(projectRoot, args.file);
    if (!fileExists(apiFilePath)) {
      return { success: false, error: `API 文件不存在：${args.file}` };
    }

    // 提取接口信息供任务使用
    const apiInfo = parseApiFile(apiFilePath);
    return {
      success: true,
      type: 'api_spec',
      source: args.file,
      interfaces: apiInfo.interfaces,
      message: `已加载 ${apiInfo.interfaces.length} 个接口定义`
    };
  }

  // Step 3: 执行 ytt 生成
  const result = await Bash({
    command: 'pnpm ytt',
    timeout: 60000
  });

  if (result.exitCode !== 0) {
    return { success: false, error: `ytt 执行失败：${result.stderr}` };
  }

  // Step 4: 如果指定了分类，验证对应文件
  if (args.category) {
    const categoryMap = parseYttConfig(yttConfigPath);
    const outputFile = categoryMap[args.category];
    if (!outputFile || !fileExists(path.join(projectRoot, outputFile))) {
      return { success: false, error: `分类 ${args.category} 的 API 文件未生成` };
    }
  }

  return {
    success: true,
    type: 'api_spec',
    source: 'ytt',
    message: 'API 代码已生成'
  };
}
```

### API 文件解析

```typescript
interface ApiInterface {
  name: string;           // 函数名：ApiCamPermissionUserGET
  path: string;           // 路径：/web/v1/cam/permission/user
  method: string;         // 方法：GET
  requestType: string;    // 请求类型名
  responseType: string;   // 响应类型名
  description: string;    // 接口描述
  category: string;       // 分类名
}

function parseApiFile(filePath: string): { interfaces: ApiInterface[] } {
  const content = readFile(filePath);
  const interfaces: ApiInterface[] = [];

  // 匹配接口定义注释块
  const interfacePattern = /\/\*\*\s*\n\s*\*\s*接口\s*\[(.+?)↗\]\(([^)]+)\)\s*的\s*\*\*请求函数\*\*\s*\n[\s\S]*?@请求头\s*`(\w+)\s+([^`]+)`[\s\S]*?\*\/\s*\nexport const (\w+)/g;

  let match;
  while ((match = interfacePattern.exec(content)) !== null) {
    interfaces.push({
      name: match[5],
      description: match[1],
      path: match[4],
      method: match[3],
      requestType: `${match[5].replace(/GET|POST|PUT|DELETE$/, '')}Request`,
      responseType: `${match[5].replace(/GET|POST|PUT|DELETE$/, '')}Response`,
      category: extractCategory(content, match[5])
    });
  }

  return { interfaces };
}

function extractCategory(content: string, funcName: string): string {
  const catPattern = new RegExp(`@分类\\s*\\[([^↗]+)↗\\][\\s\\S]*?${funcName}`);
  const match = content.match(catPattern);
  return match ? match[1] : 'unknown';
}
```

### 任务关联

当任务解除阻塞后，注入可用 API 信息：

```typescript
function enrichTaskWithApi(task: Task, apiInfo: { interfaces: ApiInterface[] }): Task {
  // 根据任务需求匹配相关接口
  const relevantApis = apiInfo.interfaces.filter(api => {
    const taskKeywords = extractKeywords(task.name + ' ' + task.requirement);
    return taskKeywords.some(kw =>
      api.path.includes(kw) ||
      api.description.includes(kw) ||
      api.name.toLowerCase().includes(kw)
    );
  });

  if (relevantApis.length > 0) {
    task.api_context = relevantApis.map(api => ({
      import: `import { ${api.name} } from '@/api/autogen/${getApiFileName(api)}';`,
      usage: `const response = await ${api.name}(requestData);`,
      types: `${api.requestType}, ${api.responseType}`
    }));
  }

  return task;
}
```

---

## 状态文件结构

`workflow-state.json` 中的依赖相关字段：

```json
{
  "mode": "progressive",
  "unblocked": ["api_spec"],

  "api_context": {
    "source": "packages/api/lib/autogen/teamApi.ts",
    "interfaces": [
      {
        "name": "ApiCamPermissionUserGET",
        "path": "/web/v1/cam/permission/user",
        "method": "GET"
      }
    ],
    "fetched_at": "2026-02-04T10:00:00Z"
  }
}
```

---

## 自动分类（仅 API）

更新 `classifyTaskDependencies` 只检测 API 依赖：

```typescript
function classifyTaskDependencies(task: Task): string[] {
  const deps: string[] = [];
  const name = task.name.toLowerCase();
  const file = (task.file || '').toLowerCase();

  // API 依赖检测
  const apiPatterns = [
    // 任务名关键词
    /api|接口|服务层|service|fetch|request|http|数据获取|后端|请求/,
    // 文件路径模式
    /services\/|api\/|http\/|requests\//
  ];

  if (apiPatterns.some(p => p.test(name) || p.test(file))) {
    deps.push('api_spec');
  }

  // 注意：design_spec 已移除，UI 还原通过 /figma-ui 独立处理

  return deps;
}
```

---

## 推荐工作流程

```bash
# === Phase 1: 功能实现（workflow）===

# 启动工作流
/workflow start "实现团队成员管理页面"

# 查看阻塞任务（只有 API 依赖）
/workflow status
# → T3: 成员列表接口对接 [等待: api_spec]

# 同步 API（执行 ytt 或指定文件）
/workflow delta
# 或
/workflow delta packages/api/lib/autogen/teamApi.ts

# 执行全部功能任务
/workflow execute
# → 功能完成，使用 Element Plus 默认样式


# === Phase 2: 视觉还原（figma-ui）===

# 逐页/逐组件还原
/figma-ui https://figma.com/design/xxx?node-id=1-2

# 完成视觉调整


# === Phase 3: 还原验证（visual-diff）===

/visual-diff http://localhost:5173/team --design https://figma.com/...
```

这种分离模式让开发和设计可以并行进行，workflow 不再等待设计稿。
