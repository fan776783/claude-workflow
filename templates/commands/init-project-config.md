---
description: 初始化项目配置 - 自动检测项目结构和技术栈，生成配置文件
allowed-tools: Read(*), Write(*), Grep(*), Glob(*), Bash(*)
examples:
  - /init-project-config
    自动检测并生成项目配置
  - /init-project-config
    重新生成项目配置
---

# 初始化项目配置

自动检测项目结构、技术栈和目录布局，生成 `.claude/config/project-config.json`。

**功能**：
- ✅ 自动检测项目类型（Monorepo/Single）
- ✅ 检测包管理器（pnpm/npm/yarn）
- ✅ 检测框架和版本（React/Vue/Angular等）
- ✅ 检测目录结构（apps/*, packages/*）
- ✅ 检测自定义路径（HTTP客户端、埋点、API等）
- ✅ 检测微前端框架（Wujie/Qiankun等）
- ✅ 检测可观测性工具（Sentry/Bugsnag等）
- ✅ 生成配置文件并保存

---

## 执行步骤

### 步骤 1：检查现有配置

检查是否已存在配置文件：

```bash
CONFIG_PATH=".claude/config/project-config.json"

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

# 基于项目路径生成唯一 ID（与 workflow-start 保持一致）
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
  echo "  ✅ pnpm"
elif [ -f "yarn.lock" ]; then
  PACKAGE_MANAGER="yarn"
  echo "  ✅ yarn"
elif [ -f "package-lock.json" ]; then
  PACKAGE_MANAGER="npm"
  echo "  ✅ npm"
else
  PACKAGE_MANAGER="npm"
  echo "  ⚠️  未检测到锁文件，默认使用 npm"
fi
```

#### 2.4 检测构建工具

```bash
echo "🔍 检测构建工具..."

if [ -f "turbo.json" ]; then
  BUILD_TOOL="turbo"
  echo "  ✅ Turborepo"
elif [ -f "nx.json" ]; then
  BUILD_TOOL="nx"
  echo "  ✅ Nx"
elif [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then
  BUILD_TOOL="vite"
  echo "  ✅ Vite"
elif [ -f "next.config.js" ] || [ -f "next.config.mjs" ]; then
  BUILD_TOOL="next"
  echo "  ✅ Next.js"
else
  BUILD_TOOL="vite"
  echo "  ⚠️  未检测到构建工具，默认使用 Vite"
fi
```

#### 2.5 检测框架

```bash
echo "🔍 检测框架..."

FRAMEWORKS=()

# 检测 React
if grep -q '"react"' package.json; then
  FRAMEWORKS+=("react")
  REACT_VERSION=$(grep '"react"' package.json | sed 's/.*: "\^*\([0-9.]*\).*/\1/' | head -1)
  echo "  ✅ React $REACT_VERSION"
fi

# 检测 Vue
if grep -q '"vue"' package.json; then
  FRAMEWORKS+=("vue")
  VUE_VERSION=$(grep '"vue"' package.json | sed 's/.*: "\^*\([0-9.]*\).*/\1/' | head -1)
  echo "  ✅ Vue $VUE_VERSION"
fi

# 检测 Angular
if grep -q '"@angular/core"' package.json; then
  FRAMEWORKS+=("angular")
  echo "  ✅ Angular"
fi

# 检测 Svelte
if grep -q '"svelte"' package.json; then
  FRAMEWORKS+=("svelte")
  echo "  ✅ Svelte"
fi

if [ ${#FRAMEWORKS[@]} -eq 0 ]; then
  echo "  ⚠️  未检测到框架"
fi
```

#### 2.6 检测目录结构

```bash
echo "🔍 检测目录结构..."

# 检测应用目录
if [ -d "apps" ]; then
  APPS_DIR="apps/*"
  APPS_LIST=($(ls -d apps/* 2>/dev/null | xargs -n 1 basename))
  echo "  ✅ 应用目录: apps/* (${#APPS_LIST[@]} 个应用)"
  for app in "${APPS_LIST[@]}"; do
    echo "     - $app"
  done
elif [ -d "packages" ] && [ "$PROJECT_TYPE" = "monorepo" ]; then
  APPS_DIR="packages/*"
  APPS_LIST=($(ls -d packages/* 2>/dev/null | xargs -n 1 basename))
  echo "  ✅ 应用目录: packages/*"
else
  APPS_DIR="."
  APPS_LIST=(".")
  echo "  ✅ 应用目录: . (单体应用)"
fi

# 检测共享包目录
if [ -d "packages" ] && [ "$PROJECT_TYPE" = "monorepo" ]; then
  PACKAGES_DIR="packages/*"
  echo "  ✅ 共享包目录: packages/*"
elif [ -d "libs" ]; then
  PACKAGES_DIR="libs/*"
  echo "  ✅ 共享包目录: libs/*"
else
  PACKAGES_DIR=""
  echo "  ⚠️  未检测到共享包目录"
fi
```

#### 2.7 检测状态管理

```bash
echo "🔍 检测状态管理..."

# React 状态管理
if grep -q '"zustand"' package.json; then
  REACT_STATE="zustand"
  echo "  ✅ React: Zustand"
elif grep -q '"redux"' package.json; then
  REACT_STATE="redux"
  echo "  ✅ React: Redux"
elif grep -q '"jotai"' package.json; then
  REACT_STATE="jotai"
  echo "  ✅ React: Jotai"
else
  REACT_STATE="null"
fi

# Vue 状态管理
if grep -q '"pinia"' package.json; then
  VUE_STATE="pinia"
  echo "  ✅ Vue: Pinia"
elif grep -q '"vuex"' package.json; then
  VUE_STATE="vuex"
  echo "  ✅ Vue: Vuex"
else
  VUE_STATE="null"
fi
```

#### 2.8 检测国际化

```bash
echo "🔍 检测国际化..."

# React i18n
if grep -q '"next-intl"' package.json; then
  REACT_I18N="next-intl"
  echo "  ✅ React: next-intl"
elif grep -q '"react-i18next"' package.json; then
  REACT_I18N="react-i18next"
  echo "  ✅ React: react-i18next"
else
  REACT_I18N="null"
fi

# Vue i18n
if grep -q '"vue-i18n"' package.json; then
  VUE_I18N="vue-i18n"
  echo "  ✅ Vue: vue-i18n"
else
  VUE_I18N="null"
fi

# 检测 locales 路径
REACT_LOCALES="null"
VUE_LOCALES="null"

if [ -d "apps/agent/src/locales" ]; then
  REACT_LOCALES="apps/agent/src/locales"
elif [ -d "src/locales" ]; then
  REACT_LOCALES="src/locales"
fi

if [ -d "packages/langs" ]; then
  VUE_LOCALES="packages/langs"
elif [ -d "src/locales" ]; then
  VUE_LOCALES="src/locales"
fi
```

#### 2.9 检测微前端

```bash
echo "🔍 检测微前端..."

if grep -q '"wujie"' package.json || grep -q '"wujie-vue3"' package.json; then
  MICRO_FRAMEWORK="wujie"
  MICRO_ENABLED="true"
  echo "  ✅ Wujie 微前端"
elif grep -q '"qiankun"' package.json; then
  MICRO_FRAMEWORK="qiankun"
  MICRO_ENABLED="true"
  echo "  ✅ Qiankun 微前端"
elif grep -q '"@micro-zoe/micro-app"' package.json; then
  MICRO_FRAMEWORK="micro-app"
  MICRO_ENABLED="true"
  echo "  ✅ Micro App 微前端"
else
  MICRO_FRAMEWORK="null"
  MICRO_ENABLED="false"
  echo "  ⚠️  未检测到微前端框架"
fi

# 检测主子应用
MAIN_APP="null"
SUB_APPS=()

if [ "$MICRO_ENABLED" = "true" ] && [ ${#APPS_LIST[@]} -gt 1 ]; then
  # 假设第一个是主应用，其余是子应用
  MAIN_APP="apps/${APPS_LIST[0]}"
  for ((i=1; i<${#APPS_LIST[@]}; i++)); do
    SUB_APPS+=("apps/${APPS_LIST[$i]}")
  done
  echo "     主应用: $MAIN_APP"
  echo "     子应用: ${SUB_APPS[*]}"
fi
```

#### 2.10 检测自定义路径

```bash
echo "🔍 检测自定义路径..."

# HTTP 客户端
if [ -d "packages/httpx" ]; then
  HTTP_CLIENT="packages/httpx"
  echo "  ✅ HTTP 客户端: packages/httpx"
elif [ -d "src/utils/http" ]; then
  HTTP_CLIENT="src/utils/http"
  echo "  ✅ HTTP 客户端: src/utils/http"
else
  HTTP_CLIENT="null"
fi

# 埋点
if [ -d "packages/tracking" ]; then
  TRACKING="packages/tracking"
  echo "  ✅ 埋点: packages/tracking"
elif [ -d "src/utils/analytics" ]; then
  TRACKING="src/utils/analytics"
  echo "  ✅ 埋点: src/utils/analytics"
else
  TRACKING="null"
fi

# API
if [ -d "packages/api" ]; then
  API="packages/api"
  echo "  ✅ API: packages/api"
elif [ -d "src/api" ]; then
  API="src/api"
  echo "  ✅ API: src/api"
else
  API="null"
fi

# UI 组件
if [ -d "packages/ui" ]; then
  UI="packages/ui"
  echo "  ✅ UI: packages/ui"
elif [ -d "src/components" ]; then
  UI="src/components"
  echo "  ✅ UI: src/components"
else
  UI="null"
fi

# 静态资源目录
echo "🔍 检测静态资源目录..."
if [ -d "public/assets" ]; then
  ASSETS_DIR="public/assets"
  echo "  ✅ 静态资源: public/assets"
elif [ -d "public/images" ]; then
  ASSETS_DIR="public/images"
  echo "  ✅ 静态资源: public/images"
elif [ -d "src/assets" ]; then
  ASSETS_DIR="src/assets"
  echo "  ✅ 静态资源: src/assets"
elif [ -d "assets" ]; then
  ASSETS_DIR="assets"
  echo "  ✅ 静态资源: assets"
elif [ -d "static" ]; then
  ASSETS_DIR="static"
  echo "  ✅ 静态资源: static"
elif [ -d "public" ]; then
  ASSETS_DIR="public"
  echo "  ✅ 静态资源: public"
else
  # Monorepo 项目检测
  FOUND_ASSETS=""
  for app_dir in apps/*/public/assets apps/*/src/assets; do
    if [ -d "$app_dir" ]; then
      FOUND_ASSETS="$app_dir"
      break
    fi
  done
  if [ -n "$FOUND_ASSETS" ]; then
    ASSETS_DIR="$FOUND_ASSETS"
    echo "  ✅ 静态资源: $ASSETS_DIR"
  else
    ASSETS_DIR="public/assets"
    echo "  ⚠️  未检测到静态资源目录，使用默认: public/assets"
  fi
fi
```

#### 2.11 检测可观测性

```bash
echo "🔍 检测可观测性..."

# 错误追踪
if grep -q '"@sentry/' package.json; then
  ERROR_TRACKING="sentry"
  ERROR_TRACKING_ENABLED="true"
  echo "  ✅ Sentry 错误追踪"
elif grep -q '"bugsnag"' package.json; then
  ERROR_TRACKING="bugsnag"
  ERROR_TRACKING_ENABLED="true"
  echo "  ✅ Bugsnag 错误追踪"
else
  ERROR_TRACKING="null"
  ERROR_TRACKING_ENABLED="false"
  echo "  ⚠️  未检测到错误追踪工具"
fi

# 分析工具
if [ "$TRACKING" != "null" ]; then
  ANALYTICS_ENABLED="true"
  ANALYTICS_PROVIDER="custom"
  echo "  ✅ 自定义分析工具"
else
  ANALYTICS_ENABLED="false"
  ANALYTICS_PROVIDER="null"
fi
```

---

### 步骤 3：生成配置文件

```bash
echo ""
echo "📝 生成配置文件..."

# 确保目录存在
mkdir -p ".claude/config"

# 生成配置
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
    "apps": $(printf '%s\n' "${APPS_LIST[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))'),
    "packages": "$PACKAGES_DIR",
    "sharedLibs": [],
    "testDir": "src/__tests__"
  },

  "tech": {
    "packageManager": "$PACKAGE_MANAGER",
    "buildTool": "$BUILD_TOOL",
    "frameworks": $(printf '%s\n' "${FRAMEWORKS[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))'),
    "versions": {
      "react": "${REACT_VERSION:-null}",
      "vue": "${VUE_VERSION:-null}"
    },
    "stateManagement": {
      "react": "$REACT_STATE",
      "vue": "$VUE_STATE"
    },
    "i18n": {
      "react": "$REACT_I18N",
      "vue": "$VUE_I18N",
      "localesPath": {
        "react": "$REACT_LOCALES",
        "vue": "$VUE_LOCALES"
      }
    },
    "router": {
      "react": "react-router",
      "vue": "vue-router"
    },
    "styling": {
      "framework": "tailwind",
      "version": "4.x"
    },
    "testing": {
      "framework": "vitest",
      "coverage": true
    }
  },

  "customPaths": {
    "httpClient": "$HTTP_CLIENT",
    "tracking": "$TRACKING",
    "api": "$API",
    "ui": "$UI",
    "assets": "$ASSETS_DIR",
    "store": "null",
    "utils": "null"
  },

  "microFrontend": {
    "enabled": $MICRO_ENABLED,
    "framework": "$MICRO_FRAMEWORK",
    "mainApp": "$MAIN_APP",
    "subApps": $(printf '%s\n' "${SUB_APPS[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))'),
    "integration": {
      "propsInjection": $MICRO_ENABLED,
      "routeSync": $MICRO_ENABLED,
      "stateSharing": $MICRO_ENABLED
    }
  },

  "observability": {
    "errorTracking": {
      "enabled": $ERROR_TRACKING_ENABLED,
      "provider": "$ERROR_TRACKING"
    },
    "analytics": {
      "enabled": $ANALYTICS_ENABLED,
      "provider": "$ANALYTICS_PROVIDER",
      "module": "$TRACKING"
    },
    "performance": {
      "enabled": $ERROR_TRACKING_ENABLED,
      "provider": "$ERROR_TRACKING"
    }
  },

  "domain": {
    "businessContext": [],
    "keyScenarios": [],
    "personas": [],
    "glossary": []
  },

  "conventions": {
    "language": "zh-CN",
    "pathAlias": "@/",
    "codeStyle": {
      "linter": "eslint",
      "formatter": "prettier",
      "typeChecker": "typescript"
    },
    "preferences": {
      "bannedLibraries": [],
      "preferredLibraries": {},
      "testing": {
        "snapshotUsage": "minimal",
        "coverageTarget": 0.8
      },
      "ux": {
        "designSystem": null,
        "accessibilityLevel": "WCAG 2.1 AA"
      }
    }
  },

  "decisions": [],

  "workflowDefaults": {
    "autoClearMode": "ask",
    "defaultContextPolicyByPhase": {
      "analyze": "inherit",
      "design": "inherit",
      "implement": "auto",
      "test": "auto",
      "verify": "auto",
      "deliver": "auto"
    }
  },

  "backend": {
    "docDir": ".claude/docs",
    "fasjSpecPath": "",
    "xqSpecPath": "",
    "enableCodexReview": true
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

### 步骤 4：显示检测结果

```bash
echo ""
echo "📊 检测结果摘要："
echo ""
cat "$CONFIG_PATH" | jq '{
  project: {
    id: .project.id,
    name: .project.name,
    type: .project.type,
    rootDir: .project.rootDir
  },
  tech: {
    packageManager: .tech.packageManager,
    buildTool: .tech.buildTool,
    frameworks: .tech.frameworks,
    stateManagement: .tech.stateManagement,
    i18n: .tech.i18n
  },
  microFrontend: .microFrontend,
  customPaths: .customPaths
}'
echo ""
echo "🔗 工作流存储目录: ~/.claude/workflows/$PROJECT_ID/"
```

---

### 步骤 5：使用说明

```bash
echo ""
echo "✅ 初始化完成！"
echo ""
echo "📚 下一步："
echo "  1. 查看配置: cat .claude/config/project-config.json"
echo "  2. 编辑配置: 手动修改 .claude/config/project-config.json"
echo "  3. 使用配置: 工作流命令将自动读取此配置"
echo ""
echo "💡 提示："
echo "  - 所有工作流命令（/context-load、/analyze-*、/review-*）将使用此配置"
echo "  - 可随时重新运行 /init-project-config 更新配置"
echo "  - 配置文件支持手动编辑，修改后立即生效"
echo ""
echo "📖 配置指南: cat .claude/config/config-guide.md"
```

---

## 注意事项

1. **自动检测限制**：自动检测基于文件和 package.json，可能无法100%准确
2. **手动调整**：生成后可手动编辑配置文件以覆盖检测结果
3. **备份机制**：重新生成时会自动备份旧配置
4. **即时生效**：修改配置后，所有命令立即使用新配置

---

**工作目录**：`{{auto-detect}}`

**输出**：`.claude/config/project-config.json`
