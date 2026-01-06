---
description: 智能项目扫描 - 检测技术栈、生成配置文件和项目上下文报告
allowed-tools: Read(*), Write(*), Grep(*), Glob(*), Bash(*), mcp__auggie-mcp__codebase-retrieval(*)
examples:
  - /scan
    完整扫描：技术栈检测 + 语义代码分析
  - /scan --config-only
    仅生成配置文件（跳过语义分析）
  - /scan --context-only
    仅生成上下文报告（需已有配置）
---

# 智能项目扫描

自动检测项目结构、技术栈，并通过语义代码检索生成项目上下文报告。

**输出产物**：
- `.claude/config/project-config.json` - 项目配置文件
- `.claude/repo-context.md` - 项目上下文报告（语义分析结果）

**核心能力**：
- **Part 1: 技术栈检测**（文件系统检测）
  - ✅ 项目类型（Monorepo/Single）
  - ✅ 包管理器（pnpm/npm/yarn）
  - ✅ 框架和版本（React/Vue/Angular/Go/Python等）
  - ✅ 目录结构（apps/*, packages/*）
  - ✅ 自定义路径（HTTP客户端、埋点、API等）
  - ✅ 微前端框架（Wujie/Qiankun等）
  - ✅ 可观测性工具（Sentry/Bugsnag等）

- **Part 2: 语义代码检索**（MCP 深度分析）🆕
  - ✅ 项目入口与启动流程
  - ✅ API 路由与端点
  - ✅ 数据模型与数据库 Schema
  - ✅ 前端组件结构
  - ✅ 核心业务逻辑
  - ✅ 测试覆盖情况

---

## Part 1: 技术栈检测

### 步骤 1：检查现有配置

```bash
CONFIG_PATH=".claude/config/project-config.json"
CONTEXT_PATH=".claude/repo-context.md"

if [ -f "$CONFIG_PATH" ]; then
  echo "⚠️  发现现有配置文件："
  echo ""
  cat "$CONFIG_PATH" | jq '{
    project: .project,
    tech: {
      packageManager: .tech.packageManager,
      buildTool: .tech.buildTool,
      frameworks: .tech.frameworks
    },
    metadata: .metadata
  }'
  echo ""
  read -p "是否覆盖现有配置？[y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 操作已取消"
    exit 0
  fi

  # 备份现有配置
  BACKUP_PATH=".claude/config/project-config.backup.$(date +%Y%m%d_%H%M%S).json"
  cp "$CONFIG_PATH" "$BACKUP_PATH"
  echo "✅ 已备份到: $BACKUP_PATH"
fi
```

---

### 步骤 2：自动检测项目信息

#### 2.1 生成项目 ID

```bash
echo "🔍 生成项目标识..."

PROJECT_PATH="$(pwd)"
PROJECT_ID=$(echo -n "$PROJECT_PATH" | md5 | cut -c1-12)
echo "  ✅ 项目 ID: $PROJECT_ID"
echo "  📍 项目路径: $PROJECT_PATH"
```

#### 2.2 检测项目类型

```bash
echo "🔍 检测项目类型..."

# 检测 Monorepo
if [ -f "pnpm-workspace.yaml" ] || [ -f "lerna.json" ] || [ -f "turbo.json" ] || [ -f "nx.json" ]; then
  PROJECT_TYPE="monorepo"
  echo "  ✅ Monorepo 项目"
else
  PROJECT_TYPE="single"
  echo "  ✅ 单体项目"
fi
```

#### 2.3 检测包管理器

```bash
echo "🔍 检测包管理器..."

if [ -f "pnpm-lock.yaml" ]; then
  PACKAGE_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
  PACKAGE_MANAGER="yarn"
elif [ -f "package-lock.json" ]; then
  PACKAGE_MANAGER="npm"
elif [ -f "go.mod" ]; then
  PACKAGE_MANAGER="go"
elif [ -f "Cargo.toml" ]; then
  PACKAGE_MANAGER="cargo"
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  PACKAGE_MANAGER="pip"
else
  PACKAGE_MANAGER="unknown"
fi
echo "  ✅ $PACKAGE_MANAGER"
```

#### 2.4 检测构建工具

```bash
echo "🔍 检测构建工具..."

if [ -f "turbo.json" ]; then
  BUILD_TOOL="turbo"
elif [ -f "nx.json" ]; then
  BUILD_TOOL="nx"
elif [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then
  BUILD_TOOL="vite"
elif [ -f "next.config.js" ] || [ -f "next.config.mjs" ]; then
  BUILD_TOOL="next"
elif [ -f "nuxt.config.ts" ]; then
  BUILD_TOOL="nuxt"
elif [ -f "webpack.config.js" ]; then
  BUILD_TOOL="webpack"
elif [ -f "go.mod" ]; then
  BUILD_TOOL="go"
elif [ -f "Cargo.toml" ]; then
  BUILD_TOOL="cargo"
else
  BUILD_TOOL="unknown"
fi
echo "  ✅ $BUILD_TOOL"
```

#### 2.5 检测框架

```bash
echo "🔍 检测框架..."

FRAMEWORKS=()

# 前端框架
if [ -f "package.json" ]; then
  if grep -q '"react"' package.json; then
    FRAMEWORKS+=("react")
    REACT_VERSION=$(grep '"react"' package.json | sed 's/.*: "\^*\([0-9.]*\).*/\1/' | head -1)
    echo "  ✅ React $REACT_VERSION"
  fi
  if grep -q '"vue"' package.json; then
    FRAMEWORKS+=("vue")
    echo "  ✅ Vue"
  fi
  if grep -q '"@angular/core"' package.json; then
    FRAMEWORKS+=("angular")
    echo "  ✅ Angular"
  fi
  if grep -q '"svelte"' package.json; then
    FRAMEWORKS+=("svelte")
    echo "  ✅ Svelte"
  fi
fi

# 后端框架
if [ -f "go.mod" ]; then
  if grep -q 'gin-gonic/gin' go.mod; then
    FRAMEWORKS+=("gin")
    echo "  ✅ Gin (Go)"
  elif grep -q 'labstack/echo' go.mod; then
    FRAMEWORKS+=("echo")
    echo "  ✅ Echo (Go)"
  elif grep -q 'gofiber/fiber' go.mod; then
    FRAMEWORKS+=("fiber")
    echo "  ✅ Fiber (Go)"
  else
    FRAMEWORKS+=("go")
    echo "  ✅ Go"
  fi
fi

if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  if grep -q 'fastapi' requirements.txt 2>/dev/null || grep -q 'fastapi' pyproject.toml 2>/dev/null; then
    FRAMEWORKS+=("fastapi")
    echo "  ✅ FastAPI (Python)"
  elif grep -q 'django' requirements.txt 2>/dev/null || grep -q 'django' pyproject.toml 2>/dev/null; then
    FRAMEWORKS+=("django")
    echo "  ✅ Django (Python)"
  elif grep -q 'flask' requirements.txt 2>/dev/null || grep -q 'flask' pyproject.toml 2>/dev/null; then
    FRAMEWORKS+=("flask")
    echo "  ✅ Flask (Python)"
  else
    FRAMEWORKS+=("python")
    echo "  ✅ Python"
  fi
fi

if [ -f "Cargo.toml" ]; then
  FRAMEWORKS+=("rust")
  echo "  ✅ Rust"
fi
```

#### 2.6-2.11 其他检测（目录结构、状态管理、国际化、微前端、自定义路径、可观测性）

（保持原有逻辑，此处省略以节省篇幅）

---

### 步骤 3：生成配置文件

```bash
echo ""
echo "📝 生成配置文件..."

mkdir -p ".claude/config"

cat > "$CONFIG_PATH" <<EOF
{
  "\$schema": "https://json-schema.org/draft-07/schema#",
  "\$comment": "Claude Code 项目配置文件 - 自动生成于 $(date -u +"%Y-%m-%d %H:%M:%S UTC")",

  "project": {
    "id": "$PROJECT_ID",
    "name": "$(basename "$(pwd)")",
    "type": "$PROJECT_TYPE",
    "rootDir": "$(pwd)",
    "description": "",
    "ownerTeam": ""
  },

  "structure": {
    "apps": [],
    "packages": "",
    "sharedLibs": [],
    "testDir": "src/__tests__"
  },

  "tech": {
    "packageManager": "$PACKAGE_MANAGER",
    "buildTool": "$BUILD_TOOL",
    "frameworks": $(printf '%s\n' "${FRAMEWORKS[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))'),
    "language": "$([ -f "tsconfig.json" ] && echo "typescript" || echo "javascript")"
  },

  "customPaths": {
    "httpClient": null,
    "tracking": null,
    "api": null,
    "ui": null,
    "assets": null
  },

  "metadata": {
    "version": "2.0.0",
    "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "lastUpdated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "autoDetected": true
  }
}
EOF

echo "✅ 配置已生成: $CONFIG_PATH"
```

---

## Part 2: 语义代码检索（MCP 深度分析）🆕

使用 `mcp__auggie-mcp__codebase-retrieval` 进行深度语义分析。

### 步骤 4：语义代码检索

#### 4.1 项目入口与启动流程

```typescript
const entryResult = await mcp__auggie-mcp__codebase-retrieval({
  information_request: "项目的入口文件、main 函数、启动流程、应用初始化代码、中间件注册顺序"
});

// 期望结果：
// - 入口文件路径（如 src/index.ts, main.go, app.py）
// - 启动流程概述（初始化顺序、中间件注册）
```

#### 4.2 API 路由与端点

```typescript
const apiResult = await mcp__auggie-mcp__codebase-retrieval({
  information_request: "API 路由定义、HTTP 端点、RESTful 接口、GraphQL schema、认证中间件"
});

// 期望结果：
// - 路由文件位置（如 app/api/, routes/, controllers/）
// - 端点列表（GET /api/users, POST /api/auth/login）
// - 认证方式（JWT/Session/OAuth）
```

#### 4.3 数据模型与数据库 Schema

```typescript
const modelResult = await mcp__auggie-mcp__codebase-retrieval({
  information_request: "数据模型定义、数据库 schema、ORM 实体、表结构、实体关系"
});

// 期望结果：
// - Model 文件位置（如 models/, prisma/schema.prisma）
// - 核心实体（User, Product, Order）
// - 关系定义（一对多、多对多）
```

#### 4.4 前端组件结构

```typescript
const componentResult = await mcp__auggie-mcp__codebase-retrieval({
  information_request: "前端页面组件、可复用组件、路由配置、页面布局、状态管理"
});

// 期望结果：
// - 组件目录结构（components/, pages/, app/）
// - 路由配置文件
// - 全局布局组件
// - 状态管理方案
```

#### 4.5 核心业务逻辑

```typescript
const businessResult = await mcp__auggie-mcp__codebase-retrieval({
  information_request: "核心业务逻辑、服务层、工具函数、辅助模块、业务流程"
});

// 期望结果：
// - 服务层位置（services/, lib/, utils/）
// - 核心业务流程（支付、订单、认证）
```

#### 4.6 测试覆盖情况

```typescript
const testResult = await mcp__auggie-mcp__codebase-retrieval({
  information_request: "单元测试、集成测试、E2E 测试文件、测试配置、测试工具"
});

// 期望结果：
// - 测试目录结构（__tests__/, tests/, *_test.go）
// - 测试框架（Jest, Vitest, Go test）
// - 主要测试用例
```

---

### 步骤 5：生成项目上下文报告

将语义分析结果写入 `.claude/repo-context.md`：

```markdown
# 项目上下文报告

**生成时间**：{{YYYY-MM-DD HH:MM:SS}}
**项目路径**：{{PROJECT_DIR}}
**项目 ID**：{{PROJECT_ID}}

---

## 1. 技术栈

### 1.1 核心框架

| 类型 | 技术 | 版本 |
|------|------|------|
| 语言 | {{语言}} | {{版本}} |
| 框架 | {{框架名}} | {{版本号}} |
| 构建工具 | {{工具名}} | {{版本号}} |
| 包管理器 | {{包管理器}} | - |

### 1.2 主要依赖

{{从 package.json/go.mod/requirements.txt 提取的核心依赖}}

---

## 2. 项目结构

### 2.1 目录树概览

```
{{PROJECT_NAME}}/
├── src/                  # 源代码
│   ├── app/             # 应用入口
│   ├── components/      # 可复用组件
│   ├── lib/             # 工具库
│   ├── services/        # 服务层
│   └── types/           # 类型定义
├── tests/               # 测试文件
└── ...
```

### 2.2 关键文件说明

| 路径 | 用途 | 备注 |
|------|------|------|
| {{路径1}} | {{用途说明}} | {{补充信息}} |

---

## 3. 入口与启动流程

**入口文件**：{{入口文件路径}}

**启动流程**：
1. {{步骤1}}
2. {{步骤2}}
3. {{步骤3}}

---

## 4. API 接口

### 4.1 路由定义

**位置**：{{路由文件路径}}

### 4.2 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | /api/xxx | xxx | 需要/不需要 |

### 4.3 认证方式

- **认证方式**：{{JWT / Session / OAuth}}
- **中间件位置**：{{middleware 路径}}

---

## 5. 数据模型

### 5.1 Schema 文件

**位置**：{{schema 文件路径}}

### 5.2 核心实体

{{实体列表和关系描述}}

---

## 6. 前端结构

### 6.1 路由配置

**路由类型**：{{App Router / Pages Router / Vue Router}}

### 6.2 核心组件

| 组件名 | 路径 | 用途 |
|--------|------|------|
| {{组件}} | {{路径}} | {{用途}} |

### 6.3 状态管理

- **方案**：{{Redux / Zustand / Pinia}}
- **Store 文件**：{{store 路径}}

---

## 7. 核心业务模块

### 7.1 服务层

**位置**：{{services 路径}}

**核心服务**：
- {{服务1}}：{{描述}}
- {{服务2}}：{{描述}}

---

## 8. 测试覆盖

### 8.1 测试框架

- **单元测试**：{{Vitest / Jest / Go test}}
- **E2E 测试**：{{Playwright / Cypress}}

### 8.2 测试文件分布

| 目录 | 测试类型 | 文件数 |
|------|----------|--------|
| {{目录}} | {{类型}} | {{数量}} |

---

## 9. 开发工作流

### 9.1 常用命令

```bash
# 开发模式
{{dev 命令}}

# 构建
{{build 命令}}

# 测试
{{test 命令}}
```

### 9.2 环境变量

**配置文件**：`.env.local`（参考 `.env.example`）

---

## 附录：扫描元数据

- **扫描工具**：Claude Workflow /scan
- **扫描时间**：{{扫描耗时}}
- **分析文件数**：{{文件总数}}
```

---

### 步骤 6：显示扫描结果

```bash
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 项目扫描完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📦 生成的文件："
echo "  • 配置文件: .claude/config/project-config.json"
echo "  • 上下文报告: .claude/repo-context.md"
echo ""
echo "🔗 工作流存储目录: ~/.claude/workflows/$PROJECT_ID/"
echo ""
echo "📚 下一步："
echo "  1. 查看上下文报告: cat .claude/repo-context.md"
echo "  2. 启动工作流: /workflow-start \"功能需求描述\""
echo "  3. 快速开发: /workflow-quick-dev \"功能描述\""
echo ""
echo "💡 提示："
echo "  - 工作流命令会自动读取 repo-context.md 作为项目背景"
echo "  - 可随时重新运行 /scan 更新配置和上下文"
echo "  - 配置文件支持手动编辑，修改后立即生效"
```

---

## 命令参数

| 参数 | 说明 |
|------|------|
| （无参数） | 完整扫描：技术栈检测 + 语义代码分析 |
| `--config-only` | 仅生成配置文件（跳过语义分析，速度快） |
| `--context-only` | 仅生成上下文报告（需已有配置文件） |
| `--force` | 强制覆盖现有文件（不询问确认） |

---

## 注意事项

1. **语义分析依赖 MCP**：Part 2 需要 `auggie-mcp` 可用，否则仅执行 Part 1
2. **大型项目优化**：超过 1000 个文件的项目，语义分析可能需要较长时间
3. **敏感信息过滤**：报告中不会包含 API 密钥、密码、token
4. **报告位置**：建议将 `.claude/` 加入 `.gitignore`（或选择性提交）
5. **更新频率**：建议在重大架构变更后重新扫描

---

## 与其他命令的关系

```bash
# 扫描项目（首次使用或架构变更后）
/scan

# 启动工作流（自动读取 repo-context.md）
/workflow-start "功能需求"

# 查看工作流状态
/workflow-status

# 执行下一步
/workflow-execute
```
