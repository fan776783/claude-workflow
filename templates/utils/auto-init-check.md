# 自动初始化检查工具

**用途**: 在执行任意 workflow 命令前，自动检测项目是否已初始化，如果未初始化则自动引导初始化。

**设计理念**: 零配置体验 - 用户无需手动初始化项目，工作流会自动处理。

---

## 🔍 检查逻辑

### 步骤 1: 检测项目配置文件

```typescript
/**
 * 检查项目是否已初始化
 * @returns {boolean} 是否已初始化
 */
function isProjectInitialized(): boolean {
  const cwd = process.cwd();
  const configPath = path.join(cwd, '.claude/config/project-config.json');

  return fs.existsSync(configPath);
}
```

### 步骤 2: 检测结果处理

```typescript
if (!isProjectInitialized()) {
  console.log(`
⚠️ 检测到项目未初始化

📋 当前项目: ${path.basename(process.cwd())}
📍 项目路径: ${process.cwd()}

🔧 需要创建 Claude Workflow 配置文件：
   .claude/config/project-config.json
  `);

  // 询问用户是否自动初始化
  const shouldInit = await promptUserForInit();

  if (shouldInit) {
    await autoInitProject();
  } else {
    console.log(`
❌ 已取消初始化

💡 您可以稍后手动初始化：
   ~/.claude/init-project.sh
    `);
    process.exit(1);
  }
}
```

---

## 🚀 自动初始化流程

### 步骤 1: 询问用户

```typescript
async function promptUserForInit(): Promise<boolean> {
  const answer = await AskUserQuestion({
    questions: [{
      question: "是否自动初始化项目配置？",
      header: "项目初始化",
      multiSelect: false,
      options: [
        {
          label: "自动初始化（推荐）",
          description: "自动检测项目类型、包管理器、框架并生成配置"
        },
        {
          label: "手动配置",
          description: "稍后手动运行 ~/.claude/init-project.sh"
        }
      ]
    }]
  });

  return answer.answers["项目初始化"] === "自动初始化（推荐）";
}
```

### 步骤 2: 自动检测项目信息

```typescript
/**
 * 自动检测项目信息
 */
function detectProjectInfo() {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);

  // 检测项目类型
  const projectType = detectProjectType();

  // 检测包管理器
  const packageManager = detectPackageManager();

  // 检测框架
  const framework = detectFramework();

  return {
    name: projectName,
    type: projectType,
    packageManager,
    framework,
    rootDir: cwd
  };
}

/**
 * 检测项目类型
 */
function detectProjectType(): 'monorepo' | 'single' | 'unknown' {
  const cwd = process.cwd();

  // 检查 pnpm-workspace.yaml
  if (fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'))) {
    return 'monorepo';
  }

  // 检查 package.json 中的 workspaces
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.workspaces) {
      return 'monorepo';
    }
    return 'single';
  }

  return 'unknown';
}

/**
 * 检测包管理器
 */
function detectPackageManager(): 'pnpm' | 'yarn' | 'npm' | 'unknown' {
  const cwd = process.cwd();

  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
    return 'npm';
  }

  return 'unknown';
}

/**
 * 检测框架
 */
function detectFramework(): string {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return 'unknown';
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // 检测框架
  const frameworks = [];

  if (deps['react']) frameworks.push('react');
  if (deps['vue']) frameworks.push('vue');
  if (deps['next']) frameworks.push('nextjs');
  if (deps['nuxt']) frameworks.push('nuxtjs');
  if (deps['@angular/core']) frameworks.push('angular');
  if (deps['svelte']) frameworks.push('svelte');

  if (frameworks.length === 0) return 'unknown';
  if (frameworks.length === 1) return frameworks[0];
  return frameworks.join('+');
}
```

### 步骤 3: 生成配置文件

```typescript
/**
 * 自动初始化项目
 */
async function autoInitProject(): Promise<void> {
  const cwd = process.cwd();
  const info = detectProjectInfo();

  console.log(`
🔍 自动检测到项目信息：

  项目名称: ${info.name}
  项目类型: ${info.type}
  包管理器: ${info.packageManager}
  框架: ${info.framework}
  `);

  // 创建配置目录
  const configDir = path.join(cwd, '.claude/config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // 生成配置文件
  const config = {
    "$schema": "https://json-schema.org/draft-07/schema#",
    "$comment": "Claude Code 项目配置文件（自动生成）",

    "project": {
      "name": info.name,
      "type": info.type,
      "rootDir": ".",
      "description": "项目描述（请完善）"
    },

    "tech": {
      "packageManager": info.packageManager,
      "framework": info.framework,
      "testing": {
        "framework": "vitest",
        "coverage": true
      }
    },

    "workflow": {
      "defaultModel": "sonnet",
      "enableBKMCP": false,
      "enableFigmaMCP": false
    },

    "conventions": {
      "commitPrefix": ["feat", "fix", "chore", "refactor", "perf", "docs", "style", "test", "revert"],
      "commitFormat": "prefix: content",
      "language": "zh-CN",
      "pathAlias": "@/"
    },

    "metadata": {
      "version": "1.0.0",
      "generatedAt": new Date().toISOString(),
      "autoDetected": true,
      "autoInitialized": true
    }
  };

  const configPath = path.join(configDir, 'project-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(`
✅ 项目配置已创建

📁 配置文件: .claude/config/project-config.json

💡 提示:
  1. 配置文件已自动生成，您可以根据需要完善
  2. 建议将配置文件提交到 Git：
     git add .claude/config/project-config.json
     git commit -m "chore: 初始化 Claude Workflow 配置"
  3. 继续执行您的工作流命令...
  `);
}
```

---

## 📋 集成到 Workflow 命令

在所有 workflow 命令的开头添加以下步骤：

### 步骤 -2: 项目初始化检查（自动）

**执行位置**: 所有 workflow 命令的最开始（在项目识别之前）

**执行逻辑**:

```typescript
// ============================================
// 步骤 -2: 项目初始化检查（自动）
// ============================================

console.log(`
🔍 检查项目配置...
`);

const cwd = process.cwd();
const configPath = path.join(cwd, '.claude/config/project-config.json');

if (!fs.existsSync(configPath)) {
  console.log(`
⚠️ 检测到项目未初始化

📋 当前项目: ${path.basename(cwd)}
📍 项目路径: ${cwd}

🔧 需要创建 Claude Workflow 配置文件
  `);

  // 询问是否自动初始化
  const answer = await AskUserQuestion({
    questions: [{
      question: "是否自动初始化项目配置？",
      header: "项目初始化",
      multiSelect: false,
      options: [
        {
          label: "自动初始化（推荐）",
          description: "自动检测项目类型、包管理器、框架并生成配置"
        },
        {
          label: "手动配置",
          description: "稍后手动运行 ~/.claude/init-project.sh"
        },
        {
          label: "取消",
          description: "取消当前工作流"
        }
      ]
    }]
  });

  const choice = answer.answers["项目初始化"];

  if (choice === "自动初始化（推荐）") {
    // 执行自动初始化
    await autoInitProject();
    console.log(`✅ 初始化完成，继续执行工作流...\n`);
  } else if (choice === "手动配置") {
    console.log(`
💡 请先手动初始化项目：
   ~/.claude/init-project.sh

❌ 工作流已取消
    `);
    process.exit(1);
  } else {
    console.log(`\n❌ 工作流已取消\n`);
    process.exit(1);
  }
} else {
  console.log(`✅ 项目配置已存在\n`);
}
```

---

## 🎯 使用示例

### 场景 1: 在未初始化的项目中执行工作流

```bash
# 用户在新项目中直接执行工作流
cd /path/to/new-project
/workflow-start "添加用户认证"

# 系统输出：
🔍 检查项目配置...

⚠️ 检测到项目未初始化

📋 当前项目: new-project
📍 项目路径: /path/to/new-project

🔧 需要创建 Claude Workflow 配置文件

是否自动初始化项目配置？
  [1] 自动初始化（推荐）
  [2] 手动配置
  [3] 取消

# 用户选择 1：

🔍 自动检测到项目信息：
  项目名称: new-project
  项目类型: single
  包管理器: npm
  框架: react

✅ 项目配置已创建
📁 配置文件: .claude/config/project-config.json

✅ 初始化完成，继续执行工作流...

# 然后继续执行正常的工作流
```

### 场景 2: 在已初始化的项目中执行工作流

```bash
cd /path/to/existing-project
/workflow-start "添加用户认证"

# 系统输出：
🔍 检查项目配置...
✅ 项目配置已存在

# 直接继续执行工作流，无需额外操作
```

---

## 💡 优势

1. **零配置体验** - 用户无需手动初始化，直接执行工作流即可
2. **自动检测** - 自动识别项目类型、包管理器、框架
3. **用户可控** - 提供选择，用户可以选择自动或手动初始化
4. **友好提示** - 清晰的提示信息，引导用户操作
5. **向后兼容** - 已初始化的项目无影响

---

## 🔧 技术细节

### 检测项目类型

- 检查 `pnpm-workspace.yaml` → monorepo
- 检查 `package.json` 中的 `workspaces` 字段 → monorepo
- 其他 → single

### 检测包管理器

- 存在 `pnpm-lock.yaml` → pnpm
- 存在 `yarn.lock` → yarn
- 存在 `package-lock.json` → npm

### 检测框架

- 读取 `package.json` 中的 `dependencies` 和 `devDependencies`
- 检测 `react`、`vue`、`next`、`nuxt`、`angular`、`svelte` 等

---

## 📝 注意事项

1. **配置文件优先级**: 如果项目中已存在配置文件，跳过检查
2. **用户选择权**: 始终给用户选择的权利（自动/手动/取消）
3. **提示信息**: 提供清晰的提示和后续操作建议
4. **错误处理**: 检测失败时提供降级方案
5. **Git 提交**: 提示用户将配置文件提交到 Git

---

## 🔗 相关工具

- `~/.claude/init-project.sh` - 手动初始化脚本
- `.claude/config/project-config.json` - 项目配置文件
- `~/.claude/utils/project-detector.md` - 项目检测工具
- `~/.claude/utils/config-loader.md` - 配置加载工具
