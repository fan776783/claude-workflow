---
name: scan
description: "智能项目扫描 - 检测技术栈、生成配置文件和项目上下文报告。触发条件：用户调用 /scan，或首次使用工作流前需要初始化项目配置，或项目架构变更后需要更新配置。输出 project-config.json 和 repo-context.md。"
---

# 智能项目扫描

自动检测项目结构、技术栈，并通过语义代码检索生成项目上下文报告。

## 用法

```bash
/scan                  # 完整扫描
/scan --init           # 仅生成 projectId 和最小配置（空项目适用）
/scan --config-only    # 仅生成配置文件（跳过语义分析）
/scan --context-only   # 仅生成上下文报告（需已有配置）
/scan --force          # 强制覆盖（不询问确认）
```

## 输出产物

根据扫描模式，产出文件不同：

| 模式 | 产出文件 |
|------|----------|
| `--init` 或空项目自动触发（最小初始化） | `.claude/config/project-config.json` |
| `--config-only` | `.claude/config/project-config.json`、`.claude/config/ui-config.json` |
| `--context-only` | `.claude/repo-context.md`（需已有配置） |
| 完整扫描（默认） | `.claude/config/project-config.json`、`.claude/config/ui-config.json`、`.claude/repo-context.md` |

### project-config.json 结构

```json
{
  "project": { "id": "a1b2c3d4e5f6", "name": "...", "type": "monorepo|single", "bkProjectId": "v10125" },
  "tech": { "packageManager": "pnpm", "buildTool": "vite", "frameworks": ["vue"] },
  "workflow": { "enableBKMCP": true }
}
```

### ui-config.json 结构

```json
{
  "assetsDir": "public/images",
  "cssFramework": "tailwind",
  "designTokensFile": "tailwind.config.ts",
  "designTokens": {
    "colors": { "primary": "#1890ff", "error": "#ff4d4f" },
    "spacing": { "xs": "4px", "sm": "8px", "md": "16px" },
    "typography": { "base": "14px", "lg": "16px" }
  },
  "componentsDir": "src/components",
  "existingComponents": ["Button", "Modal", "Table", "Form"],
  "generatedAt": "2026-02-03T00:00:00Z"
}
```

> **独立文件原因**：UI 配置变更频率高于项目元数据，且为 figma-ui 等 UI skill 专用。

## 执行流程

```
Part -1: Legacy projectId 迁移检测（新增）
Part 0: 空项目检测与 --init 快速路径
Part 1: 技术栈检测（文件系统）
Part 2: 语义代码检索（MCP 深度分析）
Part 3: 生成报告
Part 4: 产出完整性检查
Part 5: Code Specs 初始化检查（迁移自 workflow-plan Step 1.5）
```

## Part -1: Legacy projectId 迁移检测

**目的**：把 v5.2.x 及之前版本生成的纯 12 位 hex `project.id`（如 `8c5fd4f4930b`）迁移为新格式 `{name-slug}-{hash}`（如 `claude-workflow-8c5fd4f4930b`），同时把 `~/.claude/workflows/{旧id}/` 重命名为新 id。

**触发条件**：`project-config.json` 存在，`project.id` 匹配 `/^[a-f0-9]{12}$/`。新格式或无配置均跳过。

**流程**：

1. 检测 plan：
   ```bash
   node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js migrate-project-id \
     --project-root "$(pwd)"
   ```
2. 若返回 `needed: false`，静默跳过；否则向用户展示：
   ```
   🔁 检测到 legacy project.id：{currentId} → 将迁移为 {newId}
      配置文件:       {configPath}
      状态目录重命名: {oldDir}  →  {newDir}

   ⚠️  纯 12 位 hex 很少会与真实项目名冲突，但仍请确认这是由旧版 stableProjectId 生成的。
      输入 y 确认迁移，其它任意输入跳过。
   ```
3. 用户确认后：
   ```bash
   node ~/.agents/agent-workflow/core/utils/workflow/workflow_cli.js migrate-project-id \
     --project-root "$(pwd)" --apply
   ```
4. 返回 `reason: target_state_dir_exists` 时提示用户手动处理冲突（新 id 状态目录已存在），不自动合并。
5. 用户拒绝迁移则继续使用旧 id，不阻塞扫描。

## Part 0: 空项目检测与 --init 快速路径

**目的**：当项目目录为空或用户指定 `--init` 时，生成最小 `project-config.json`，确保 projectId 可用。

```typescript
const isInitMode = flags.includes('--init');
const sourceFiles = listFiles('.', {
  ignore: ['.git', '.claude', 'node_modules', '.vscode', '.idea', '.cursor']
});
const isEmpty = sourceFiles.length === 0;

if (isInitMode || isEmpty) {
  const projectId = generateStableProjectId(process.cwd());
  const projectName = path.basename(process.cwd());

  const minimalConfig = {
    project: {
      id: projectId,
      name: projectName,
      type: 'single',
      bkProjectId: null
    },
    tech: {
      packageManager: 'unknown',
      buildTool: 'unknown',
      frameworks: []
    },
    workflow: { enableBKMCP: false },
    _scanMode: 'init'  // init | full
  };

  ensureDir('.claude/config');
  writeFile('.claude/config/project-config.json', JSON.stringify(minimalConfig, null, 2));

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 最小项目配置已生成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 项目 ID: ${projectId}
📁 项目名: ${projectName}
📄 配置文件: .claude/config/project-config.json

${isEmpty ? '📝 检测到空项目，已跳过技术栈检测和语义分析。' : ''}
💡 项目有代码后可随时执行 /scan --force 更新完整配置。

📚 下一步：
  /workflow-plan "需求描述"
   `);
  return;  // 跳过 Part 1~3
}
```

### generateStableProjectId

新格式 `{name-slug}-{12位 hash}`，其中 slug 取 `path.basename(cwd)` 保留 ASCII 字母数字并 lowercase、`[^a-z0-9]+` 统一压为 `-`、截断 32 字符；slug 为空（如全中文目录名）时退回纯 hash 以保证跨平台可用。

必须通过 CLI 计算，禁止手动 shell 哈希（路径规范化差异会不一致）：

```bash
node -e "const {stableProjectId}=require('./core/utils/workflow/lifecycle_cmds');console.log(stableProjectId(process.cwd()))"
```

样例：
- `/Users/ws/dev/claude-workflow` → `claude-workflow-8c5fd4f4930b`
- `/tmp/我-的-project` → `project-5f06135a4b95`
- `/tmp/我的项目` → `33187e26ea67`（slug 为空退回纯 hash）

## Part 1: 技术栈检测

### 1.1 检查现有配置

```bash
CONFIG_PATH=".claude/config/project-config.json"

if [ -f "$CONFIG_PATH" ]; then
  # 显示现有配置摘要
  cat "$CONFIG_PATH" | jq '{project: .project.name, tech: .tech}'
  # 询问是否覆盖（除非 --force）
fi
```

### 1.2 运行检测脚本

执行 [scripts/detect-tech-stack.sh](scripts/detect-tech-stack.sh) 检测：
- 项目类型（Monorepo/Single）
- 包管理器（pnpm/npm/yarn/go/cargo/pip）
- 构建工具（vite/turbo/webpack/next/nuxt）
- 框架（React/Vue/Angular/Go/Python/Rust）
- 微前端框架（Wujie/Qiankun）
- 可观测性工具（Sentry/Bugsnag）

### 1.3 生成配置文件

```bash
mkdir -p ".claude/config"
# 写入 project-config.json
```

## Part 1.5: 蓝鲸项目关联

首次执行 `/scan` 时，询问用户是否需要关联蓝鲸项目。若用户确认，自动查找并写入蓝鲸项目 ID。

**流程**：

1. 询问用户是否需要关联蓝鲸项目（已有 `project.bkProjectId` 时跳过询问）

2. 用户确认后，使用项目名称作为关键字调用 `mcp__mcp-router__search_projects`：
   ```
   search_projects(keyword: "<PROJECT_NAME>", limit: 5)
   ```

3. 展示匹配结果供用户选择：
   ```
   找到以下蓝鲸项目：
   | # | 项目 ID | 项目名称 |
   |---|---------|----------|
   | 1 | v10125  | PIC-ReelMateWeb |
   | 2 | v10130  | PIC-ReelMateAPI |

   请选择关联的项目编号（输入序号），或输入 "skip" 跳过。
   ```

4. 用户选择后，将蓝鲸项目 ID 写入 `project-config.json` 的 `project.bkProjectId`：
   ```json
   {
     "project": {
       "id": "a1b2c3d4e5f6",
       "name": "...",
       "type": "...",
       "bkProjectId": "v10125"
     }
   }
   ```

5. 无匹配结果时提示用户手动输入项目 ID 或跳过。

**跳过条件**：用户选择不关联，或已有 `project.bkProjectId`（除非 `--force`）。

## Part 2: 语义代码检索

使用 `mcp__auggie-mcp__codebase-retrieval` 进行深度分析。

详见 [references/semantic-queries.md](references/semantic-queries.md)

**查询维度**：
1. 项目入口与启动流程
2. API 路由与端点
3. 数据模型与数据库 Schema
4. 前端组件结构
5. 核心业务逻辑
6. 测试覆盖情况

**降级策略**：MCP 不可用时仅执行 Part 1。

## Part 3: 生成报告

将语义分析结果写入 `.claude/repo-context.md`。

输出模板详见 [references/context-template.md](references/context-template.md)

## 完成输出

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 项目扫描完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 生成的文件：
  • 配置文件: .claude/config/project-config.json
  • UI 配置: .claude/config/ui-config.json
  • 上下文报告: .claude/repo-context.md

📚 Code Specs: .claude/code-specs/ ({N} files, {filled} filled / {draft} draft)
   └─ 未初始化时: 💡 进入 Part 5 询问是否初始化；或后续用 /spec-bootstrap

📚 下一步：
  1. 查看上下文报告: cat .claude/repo-context.md
  2. 启动工作流: /workflow-plan "功能需求描述"
  3. UI 还原: /figma-ui <figma-url>（自动读取 ui-config.json）
  4. 沉淀规范: /spec-update（按需）
```

## Part 4: 产出完整性检查

扫描结束前检查**当前模式下**预期产出文件是否全部生成。

> ⚠️ 本检查仅适用于完整扫描和 `--config-only` 模式。`--init` 路径在 Part 0 已 return，不会执行到此处。

```typescript
// 按扫描模式确定预期产出
const expectedOutputsByMode: Record<string, string[]> = {
  full: [
    '.claude/config/project-config.json',
    '.claude/config/ui-config.json',
    '.claude/repo-context.md'
  ],
  'config-only': [
    '.claude/config/project-config.json',
    '.claude/config/ui-config.json'
  ],
  'context-only': [
    '.claude/repo-context.md'
  ]
  // 注意：init 模式在 Part 0 已 return，不会到达此处
};

const scanMode = flags.includes('--config-only') ? 'config-only'
               : flags.includes('--context-only') ? 'context-only'
               : 'full';
const expectedOutputs = expectedOutputsByMode[scanMode];

const missing = expectedOutputs.filter(f => !fileExists(f));

if (missing.length > 0) {
  console.log(`
⚠️ 扫描完成（模式: ${scanMode}）但以下文件未生成：
${missing.map(f => `  ❌ ${f}`).join('\n')}

可能原因：
- MCP 工具不可用 → 仅影响 repo-context.md
- 项目结构无法识别
  `);
}
```

## Part 5: Code Specs 初始化检查

**目的**：替代原 `/workflow-plan` Step 1.5，在项目扫描阶段就引导用户建立 `.claude/code-specs/` 骨架。

**触发条件**：扫描模式为 `full` 或 `config-only`，且 `.claude/code-specs/index.md` 不存在，且 `project-config.json` 中 `codeSpecs.bootstrapStatus !== 'skipped'`。

**跳过条件**：`--init` / `--context-only` 模式；code-specs 目录已存在；用户之前选过"跳过"。

**流程**：

1. 查询状态：
   ```bash
   node ~/.agents/agent-workflow/core/utils/workflow/spec_bootstrap.js status \
     --project-root "$(pwd)"
   ```
2. 若 `bootstrapStatus` 为 null 且 code-specs 目录不存在，提示用户：
   ```
   📚 检测到项目尚未建立code-specs（.claude/code-specs/）。
   code-specs用于沉淀编码约定、架构决策、常见错误等项目级规范；
   code-spec 采用 7 段合约结构，/workflow-review 阶段人工对照审查。

   是否现在初始化？
     ① 初始化骨架（稍后用 /spec-update 填充）
     ② 跳过（写 bootstrapStatus=skipped，不再提示）
     ③ 稍后用 /spec-bootstrap 手动初始化
   ```
3. 用户选「初始化」：
   ```bash
   node ~/.agents/agent-workflow/core/utils/workflow/spec_bootstrap.js init \
     --project-root "$(pwd)" \
     --frameworks "<逗号分隔的 tech.frameworks>"
   ```
4. 用户选「跳过」：
   ```bash
   node ~/.agents/agent-workflow/core/utils/workflow/spec_bootstrap.js skip \
     --project-root "$(pwd)"
   ```
5. 用户选「稍后」：什么都不做，输出提示：`💡 稍后可用 /spec-bootstrap 初始化`

**完整性检查补充**：若用户在 Part 5 选择初始化，`expectedOutputsByMode.full` 额外包含：
- `.claude/code-specs/index.md`
- `.claude/code-specs/local.md`

若已有 code-specs 目录，输出摘要行：`📚 code-specs: {N} files ({filled} filled / {draft} draft)`，不再询问。

---

## 与其他命令的关系

```bash
/scan                           # 首次使用或架构变更后（含 Part 5 code-specs引导）
/spec-bootstrap                 # 单独初始化code-specs（scan 跳过后的手动入口）
/spec-update                    # 沉淀规范（7 段 code-spec 或 thinking guide）
/spec-review                    # 审查 code-specs 过期 / 完整性 / canonical 版本对账
/workflow-plan "功能需求"      # 自动读取 repo-context.md + code-specs/
```
