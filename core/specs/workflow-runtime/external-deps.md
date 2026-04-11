# 外部依赖系统 (v3.1)

工作流的外部依赖管理。

## 快速导航

- 想区分 workflow / figma-ui 的职责：看“设计理念”
- 想看 `api_spec` 的来源与处理入口：看“API 依赖”
- 想判断哪些路径/命令只是项目示例：看对应示例段落，按项目现状核实
- 想处理 API 变更：回到 `../../skills/workflow-delta/SKILL.md`

## 何时读取

- 需要理解 workflow 与外部系统（尤其 API 同步）的边界时
- 需要判断某个 delta / unblock 行为是否属于外部依赖管理时

## 设计理念

**职责分离原则**：

| 关注点 | 负责 Skill | 说明 |
|--------|-----------|------|
| 业务逻辑 + 数据流 | `/workflow` | 功能实现，使用组件库默认样式 |
| API 接口 | `/workflow delta` | 统一处理 API 同步和变更 |
| 视觉还原 + 验证 | `/figma-ui` | **独立流程**，负责设计上下文获取、资源分诊、语义化命名、Visual Review 与交付决策 |

```text
workflow（功能）  ──▶  figma-ui（视觉资源分诊 + 还原 + 验证）
       │
  delta 同步 API
```

**资源职责边界**：
- `assetsDir/.figma-ui/tmp/<taskId>`：figma-ui 当前任务的临时下载与分诊工作区
- 最终资源目录：仅接收 figma-ui 确认提升（promote）的资源

## 依赖类型

| 类型 | 来源 | 入口 |
|------|------|------|
| `api_spec` | YApi / ytt | `/workflow delta` |

> **注意**：`design_spec` 已移除。设计稿还原通过独立的 `/figma-ui` skill 处理。

---

## API 依赖 (`api_spec`)

### 工作原理

```text
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
    const apiFile = path.join(projectRoot, args.file);
    if (!fileExists(apiFile)) {
      return { success: false, error: `API 文件不存在: ${args.file}` };
    }
  }

  // Step 3: 构造执行命令
  const command = args.file
    ? `pnpm ytt ${args.file}`
    : args.category
    ? `pnpm ytt --category ${args.category}`
    : 'pnpm ytt';

  // Step 4: 执行同步
  const result = await Bash({ command });

  return parseYttResult(result);
}
```
