# 项目自动检测器

本文档描述如何自动检测项目配置，用于生成 `.claude/config/project-config.json`。

## 检测逻辑

### 1. 项目类型检测

```bash
# 检测是否为 Monorepo
if [ -f "pnpm-workspace.yaml" ] || [ -f "lerna.json" ] || [ -f "turbo.json" ]; then
  PROJECT_TYPE="monorepo"
else
  PROJECT_TYPE="single"
fi
```

**检测文件**：
- `pnpm-workspace.yaml` - pnpm workspace
- `lerna.json` - Lerna
- `turbo.json` - Turborepo
- `nx.json` - Nx

---

### 2. 包管理器检测

```bash
# 检测包管理器
if [ -f "pnpm-lock.yaml" ]; then
  PACKAGE_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
  PACKAGE_MANAGER="yarn"
elif [ -f "package-lock.json" ]; then
  PACKAGE_MANAGER="npm"
else
  PACKAGE_MANAGER="npm"  # 默认
fi
```

**优先级**：pnpm > yarn > npm

---

### 3. 构建工具检测

```bash
# 检测构建工具
if [ -f "turbo.json" ]; then
  BUILD_TOOL="turbo"
elif [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then
  BUILD_TOOL="vite"
elif [ -f "next.config.js" ] || [ -f "next.config.mjs" ]; then
  BUILD_TOOL="next"
elif [ -f "webpack.config.js" ]; then
  BUILD_TOOL="webpack"
elif [ -f "rollup.config.js" ]; then
  BUILD_TOOL="rollup"
else
  BUILD_TOOL="vite"  # 默认
fi
```

**检测文件**：
- `turbo.json` → turbo
- `vite.config.*` → vite
- `next.config.*` → next
- `webpack.config.*` → webpack
- `rollup.config.*` → rollup

---

### 4. 框架检测

```bash
# 读取 package.json
PACKAGE_JSON=$(cat package.json)

# 检测 React
if echo "$PACKAGE_JSON" | grep -q '"react"'; then
  FRAMEWORKS+=("react")
  REACT_VERSION=$(echo "$PACKAGE_JSON" | grep '"react"' | sed 's/.*: "\^*\([0-9.]*\).*/\1/')
fi

# 检测 Vue
if echo "$PACKAGE_JSON" | grep -q '"vue"'; then
  FRAMEWORKS+=("vue")
  VUE_VERSION=$(echo "$PACKAGE_JSON" | grep '"vue"' | sed 's/.*: "\^*\([0-9.]*\).*/\1/')
fi

# 检测 Angular
if echo "$PACKAGE_JSON" | grep -q '"@angular/core"'; then
  FRAMEWORKS+=("angular")
fi

# 检测 Svelte
if echo "$PACKAGE_JSON" | grep -q '"svelte"'; then
  FRAMEWORKS+=("svelte")
fi
```

**检测依赖**：
- `react` → React
- `vue` → Vue
- `@angular/core` → Angular
- `svelte` → Svelte

---

### 5. 目录结构检测

```bash
# 检测应用目录
if [ -d "apps" ]; then
  APPS_DIR="apps/*"
  APPS_LIST=$(ls -d apps/* 2>/dev/null | xargs -n 1 basename)
elif [ -d "packages" ] && [ "$PROJECT_TYPE" = "monorepo" ]; then
  APPS_DIR="packages/*"
  APPS_LIST=$(ls -d packages/* 2>/dev/null | xargs -n 1 basename)
else
  APPS_DIR="."
  APPS_LIST="."
fi

# 检测共享包目录
if [ -d "packages" ] && [ "$PROJECT_TYPE" = "monorepo" ]; then
  PACKAGES_DIR="packages/*"
elif [ -d "libs" ]; then
  PACKAGES_DIR="libs/*"
else
  PACKAGES_DIR=""
fi
```

**目录模式**：
- Monorepo: `apps/*` + `packages/*`
- Nx: `apps/*` + `libs/*`
- Lerna: `packages/*`
- Single: `.`

---

### 6. 状态管理检测

```bash
# React 状态管理
if echo "$PACKAGE_JSON" | grep -q '"zustand"'; then
  REACT_STATE="zustand"
elif echo "$PACKAGE_JSON" | grep -q '"redux"'; then
  REACT_STATE="redux"
elif echo "$PACKAGE_JSON" | grep -q '"jotai"'; then
  REACT_STATE="jotai"
elif echo "$PACKAGE_JSON" | grep -q '"recoil"'; then
  REACT_STATE="recoil"
else
  REACT_STATE="null"
fi

# Vue 状态管理
if echo "$PACKAGE_JSON" | grep -q '"pinia"'; then
  VUE_STATE="pinia"
elif echo "$PACKAGE_JSON" | grep -q '"vuex"'; then
  VUE_STATE="vuex"
else
  VUE_STATE="null"
fi
```

**检测库**：
- React: zustand, redux, jotai, recoil
- Vue: pinia, vuex

---

### 7. 国际化检测

```bash
# React i18n
if echo "$PACKAGE_JSON" | grep -q '"next-intl"'; then
  REACT_I18N="next-intl"
  # 检测 locales 路径
  if [ -d "src/locales" ]; then
    REACT_LOCALES="src/locales"
  elif [ -d "locales" ]; then
    REACT_LOCALES="locales"
  fi
elif echo "$PACKAGE_JSON" | grep -q '"react-i18next"'; then
  REACT_I18N="react-i18next"
else
  REACT_I18N="null"
fi

# Vue i18n
if echo "$PACKAGE_JSON" | grep -q '"vue-i18n"'; then
  VUE_I18N="vue-i18n"
  # 检测 locales 路径
  if [ -d "src/locales" ]; then
    VUE_LOCALES="src/locales"
  elif [ -d "locales" ]; then
    VUE_LOCALES="locales"
  fi
else
  VUE_I18N="null"
fi
```

**检测库**：
- React: next-intl, react-i18next
- Vue: vue-i18n

---

### 8. 路由检测

```bash
# React 路由
if echo "$PACKAGE_JSON" | grep -q '"react-router"'; then
  REACT_ROUTER="react-router"
elif echo "$PACKAGE_JSON" | grep -q '"next"'; then
  REACT_ROUTER="next"
else
  REACT_ROUTER="null"
fi

# Vue 路由
if echo "$PACKAGE_JSON" | grep -q '"vue-router"'; then
  VUE_ROUTER="vue-router"
else
  VUE_ROUTER="null"
fi
```

**检测库**：
- React: react-router, next
- Vue: vue-router

---

### 9. 样式方案检测

```bash
# 检测样式框架
if echo "$PACKAGE_JSON" | grep -q '"tailwindcss"'; then
  STYLING="tailwind"
  TAILWIND_VERSION=$(echo "$PACKAGE_JSON" | grep '"tailwindcss"' | sed 's/.*: "\^*\([0-9.]*\).*/\1/')
elif echo "$PACKAGE_JSON" | grep -q '"@emotion/react"'; then
  STYLING="emotion"
elif echo "$PACKAGE_JSON" | grep -q '"styled-components"'; then
  STYLING="styled-components"
elif [ -f "*.module.css" ]; then
  STYLING="css-modules"
else
  STYLING="css"
fi
```

**检测方案**：
- tailwindcss → Tailwind CSS
- @emotion/react → Emotion
- styled-components → Styled Components
- *.module.css → CSS Modules
- 默认 → Plain CSS

---

### 10. 测试框架检测

```bash
# 检测测试框架
if echo "$PACKAGE_JSON" | grep -q '"vitest"'; then
  TEST_FRAMEWORK="vitest"
elif echo "$PACKAGE_JSON" | grep -q '"jest"'; then
  TEST_FRAMEWORK="jest"
elif echo "$PACKAGE_JSON" | grep -q '"@playwright/test"'; then
  TEST_FRAMEWORK="playwright"
else
  TEST_FRAMEWORK="null"
fi
```

**检测框架**：
- vitest → Vitest
- jest → Jest
- @playwright/test → Playwright

---

### 11. 微前端检测

```bash
# 检测微前端框架
if echo "$PACKAGE_JSON" | grep -q '"wujie"'; then
  MICRO_FRONTEND="wujie"
  MICRO_ENABLED="true"
elif echo "$PACKAGE_JSON" | grep -q '"qiankun"'; then
  MICRO_FRONTEND="qiankun"
  MICRO_ENABLED="true"
elif echo "$PACKAGE_JSON" | grep -q '"@micro-zoe/micro-app"'; then
  MICRO_FRONTEND="micro-app"
  MICRO_ENABLED="true"
elif echo "$PACKAGE_JSON" | grep -q '"@module-federation"'; then
  MICRO_FRONTEND="module-federation"
  MICRO_ENABLED="true"
else
  MICRO_FRONTEND="null"
  MICRO_ENABLED="false"
fi

# 检测主子应用
if [ "$MICRO_ENABLED" = "true" ] && [ -d "apps" ]; then
  # 通常第一个是主应用
  MAIN_APP=$(ls -d apps/* 2>/dev/null | head -1)
  SUB_APPS=$(ls -d apps/* 2>/dev/null | tail -n +2 | tr '\n' ',')
fi
```

**检测框架**：
- wujie → Wujie
- qiankun → Qiankun
- @micro-zoe/micro-app → Micro App
- @module-federation → Module Federation

---

### 12. 自定义路径检测

```bash
# 检测 HTTP 客户端路径
if [ -d "packages/httpx" ]; then
  HTTP_CLIENT="packages/httpx"
elif [ -d "packages/http" ]; then
  HTTP_CLIENT="packages/http"
elif [ -d "src/utils/http" ]; then
  HTTP_CLIENT="src/utils/http"
elif [ -d "src/api/client" ]; then
  HTTP_CLIENT="src/api/client"
else
  HTTP_CLIENT="null"
fi

# 检测埋点模块路径
if [ -d "packages/tracking" ]; then
  TRACKING="packages/tracking"
elif [ -d "packages/analytics" ]; then
  TRACKING="packages/analytics"
elif [ -d "src/utils/analytics" ]; then
  TRACKING="src/utils/analytics"
else
  TRACKING="null"
fi

# 检测 API 模块路径
if [ -d "packages/api" ]; then
  API="packages/api"
elif [ -d "src/api" ]; then
  API="src/api"
elif [ -d "api" ]; then
  API="api"
else
  API="null"
fi

# 检测 UI 组件库路径
if [ -d "packages/ui" ]; then
  UI="packages/ui"
elif [ -d "packages/components" ]; then
  UI="packages/components"
elif [ -d "src/components" ]; then
  UI="src/components"
else
  UI="null"
fi

# 检测状态管理路径
if [ -d "packages/store" ]; then
  STORE="packages/store"
elif [ -d "src/store" ]; then
  STORE="src/store"
elif [ -d "stores" ]; then
  STORE="stores"
else
  STORE="null"
fi

# 检测工具库路径
if [ -d "packages/utils" ]; then
  UTILS="packages/utils"
elif [ -d "src/utils" ]; then
  UTILS="src/utils"
else
  UTILS="null"
fi
```

**检测路径模式**：
- HTTP 客户端: `packages/httpx`, `packages/http`, `src/utils/http`, `src/api/client`
- 埋点: `packages/tracking`, `packages/analytics`, `src/utils/analytics`
- API: `packages/api`, `src/api`, `api`
- UI: `packages/ui`, `packages/components`, `src/components`
- Store: `packages/store`, `src/store`, `stores`
- Utils: `packages/utils`, `src/utils`

---

### 13. 可观测性检测

```bash
# 检测错误追踪
if echo "$PACKAGE_JSON" | grep -q '"@sentry/'; then
  ERROR_TRACKING="sentry"
  ERROR_TRACKING_ENABLED="true"
elif echo "$PACKAGE_JSON" | grep -q '"bugsnag"'; then
  ERROR_TRACKING="bugsnag"
  ERROR_TRACKING_ENABLED="true"
else
  ERROR_TRACKING="null"
  ERROR_TRACKING_ENABLED="false"
fi

# 检测分析工具
if [ "$TRACKING" != "null" ]; then
  ANALYTICS_ENABLED="true"
  ANALYTICS_PROVIDER="custom"
elif echo "$PACKAGE_JSON" | grep -q '"@google-analytics"'; then
  ANALYTICS_ENABLED="true"
  ANALYTICS_PROVIDER="ga"
else
  ANALYTICS_ENABLED="false"
  ANALYTICS_PROVIDER="null"
fi
```

**检测工具**：
- 错误追踪: Sentry, Bugsnag
- 分析: 自定义, Google Analytics

---

## 使用示例

在 `/scan` 命令中使用这些检测逻辑：

```bash
#!/bin/bash

# 执行所有检测
source .claude/utils/project-detector.md

# 生成配置文件
cat > .claude/config/project-config.json <<EOF
{
  "project": {
    "name": "$(basename $(pwd))",
    "type": "$PROJECT_TYPE",
    "rootDir": "$(pwd)"
  },
  "tech": {
    "packageManager": "$PACKAGE_MANAGER",
    "buildTool": "$BUILD_TOOL",
    "frameworks": [$(echo ${FRAMEWORKS[@]} | tr ' ' ',')]
  },
  ...
}
EOF
```

---

## 扩展性

新增检测逻辑时，遵循以下原则：

1. **优先检测文件存在性**（性能最好）
2. **次优检测 package.json 依赖**（准确性高）
3. **最后通过文件内容匹配**（最灵活）

**优先级**：
```
文件存在 > package.json > 文件内容 > 默认值
```
