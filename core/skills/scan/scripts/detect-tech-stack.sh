#!/bin/bash
# 技术栈检测脚本
# 输出环境变量供后续使用

set -e

# === 项目 ID ===
PROJECT_PATH="$(pwd)"
PROJECT_ID=$(echo -n "$PROJECT_PATH" | md5 | cut -c1-12 2>/dev/null || echo -n "$PROJECT_PATH" | md5sum | cut -c1-12)
echo "PROJECT_ID=$PROJECT_ID"
echo "PROJECT_PATH=$PROJECT_PATH"
echo "PROJECT_NAME=$(basename "$PROJECT_PATH")"

# === 项目类型 ===
if [ -f "pnpm-workspace.yaml" ] || [ -f "lerna.json" ] || [ -f "turbo.json" ] || [ -f "nx.json" ]; then
  echo "PROJECT_TYPE=monorepo"
else
  echo "PROJECT_TYPE=single"
fi

# === 包管理器 ===
if [ -f "pnpm-lock.yaml" ]; then
  echo "PACKAGE_MANAGER=pnpm"
elif [ -f "yarn.lock" ]; then
  echo "PACKAGE_MANAGER=yarn"
elif [ -f "package-lock.json" ]; then
  echo "PACKAGE_MANAGER=npm"
elif [ -f "go.mod" ]; then
  echo "PACKAGE_MANAGER=go"
elif [ -f "Cargo.toml" ]; then
  echo "PACKAGE_MANAGER=cargo"
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  echo "PACKAGE_MANAGER=pip"
else
  echo "PACKAGE_MANAGER=unknown"
fi

# === 构建工具 ===
if [ -f "turbo.json" ]; then
  echo "BUILD_TOOL=turbo"
elif [ -f "nx.json" ]; then
  echo "BUILD_TOOL=nx"
elif [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then
  echo "BUILD_TOOL=vite"
elif [ -f "next.config.js" ] || [ -f "next.config.mjs" ]; then
  echo "BUILD_TOOL=next"
elif [ -f "nuxt.config.ts" ]; then
  echo "BUILD_TOOL=nuxt"
elif [ -f "webpack.config.js" ]; then
  echo "BUILD_TOOL=webpack"
elif [ -f "go.mod" ]; then
  echo "BUILD_TOOL=go"
elif [ -f "Cargo.toml" ]; then
  echo "BUILD_TOOL=cargo"
else
  echo "BUILD_TOOL=unknown"
fi

# === 语言 ===
if [ -f "tsconfig.json" ]; then
  echo "LANGUAGE=typescript"
elif [ -f "package.json" ]; then
  echo "LANGUAGE=javascript"
elif [ -f "go.mod" ]; then
  echo "LANGUAGE=go"
elif [ -f "Cargo.toml" ]; then
  echo "LANGUAGE=rust"
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  echo "LANGUAGE=python"
else
  echo "LANGUAGE=unknown"
fi

# === 框架检测 ===
FRAMEWORKS=""

# 前端框架
if [ -f "package.json" ]; then
  if grep -q '"react"' package.json 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}react,"
  fi
  if grep -q '"vue"' package.json 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}vue,"
  fi
  if grep -q '"@angular/core"' package.json 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}angular,"
  fi
  if grep -q '"svelte"' package.json 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}svelte,"
  fi
fi

# 后端框架
if [ -f "go.mod" ]; then
  if grep -q 'gin-gonic/gin' go.mod 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}gin,"
  elif grep -q 'labstack/echo' go.mod 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}echo,"
  elif grep -q 'gofiber/fiber' go.mod 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}fiber,"
  else
    FRAMEWORKS="${FRAMEWORKS}go,"
  fi
fi

if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  if grep -q 'fastapi' requirements.txt 2>/dev/null || grep -q 'fastapi' pyproject.toml 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}fastapi,"
  elif grep -q 'django' requirements.txt 2>/dev/null || grep -q 'django' pyproject.toml 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}django,"
  elif grep -q 'flask' requirements.txt 2>/dev/null || grep -q 'flask' pyproject.toml 2>/dev/null; then
    FRAMEWORKS="${FRAMEWORKS}flask,"
  fi
fi

if [ -f "Cargo.toml" ]; then
  FRAMEWORKS="${FRAMEWORKS}rust,"
fi

# 移除尾部逗号
FRAMEWORKS="${FRAMEWORKS%,}"
echo "FRAMEWORKS=$FRAMEWORKS"

# === 微前端 ===
if [ -f "package.json" ]; then
  if grep -q 'wujie' package.json 2>/dev/null; then
    echo "MICRO_FRONTEND=wujie"
  elif grep -q 'qiankun' package.json 2>/dev/null; then
    echo "MICRO_FRONTEND=qiankun"
  else
    echo "MICRO_FRONTEND=none"
  fi
else
  echo "MICRO_FRONTEND=none"
fi

# === 可观测性 ===
if [ -f "package.json" ]; then
  if grep -q '@sentry' package.json 2>/dev/null; then
    echo "OBSERVABILITY=sentry"
  elif grep -q 'bugsnag' package.json 2>/dev/null; then
    echo "OBSERVABILITY=bugsnag"
  else
    echo "OBSERVABILITY=none"
  fi
else
  echo "OBSERVABILITY=none"
fi

# === CSS 框架 ===
CSS_FRAMEWORK="css"
if [ -f "tailwind.config.js" ] || [ -f "tailwind.config.ts" ]; then
  CSS_FRAMEWORK="tailwind"
elif [ -f "postcss.config.js" ] && grep -q 'tailwindcss' postcss.config.js 2>/dev/null; then
  CSS_FRAMEWORK="tailwind"
elif [ -f "package.json" ]; then
  if grep -q '"sass"' package.json 2>/dev/null || grep -q '"scss"' package.json 2>/dev/null; then
    CSS_FRAMEWORK="scss"
  elif grep -q '"less"' package.json 2>/dev/null; then
    CSS_FRAMEWORK="less"
  fi
fi
echo "CSS_FRAMEWORK=$CSS_FRAMEWORK"

# === 静态资源目录 ===
ASSETS_DIR=""
if [ -d "public/images" ]; then
  ASSETS_DIR="public/images"
elif [ -d "public/assets" ]; then
  ASSETS_DIR="public/assets"
elif [ -d "src/assets/images" ]; then
  ASSETS_DIR="src/assets/images"
elif [ -d "src/assets" ]; then
  ASSETS_DIR="src/assets"
elif [ -d "assets/images" ]; then
  ASSETS_DIR="assets/images"
elif [ -d "static/images" ]; then
  ASSETS_DIR="static/images"
elif [ -d "public" ]; then
  ASSETS_DIR="public"
fi
echo "ASSETS_DIR=$ASSETS_DIR"

# === 组件目录 ===
COMPONENTS_DIR=""
if [ -d "src/components" ]; then
  COMPONENTS_DIR="src/components"
elif [ -d "components" ]; then
  COMPONENTS_DIR="components"
elif [ -d "app/components" ]; then
  COMPONENTS_DIR="app/components"
fi
echo "COMPONENTS_DIR=$COMPONENTS_DIR"

# === 设计 Token 文件 ===
DESIGN_TOKENS_FILE=""
if [ -f "tailwind.config.ts" ]; then
  DESIGN_TOKENS_FILE="tailwind.config.ts"
elif [ -f "tailwind.config.js" ]; then
  DESIGN_TOKENS_FILE="tailwind.config.js"
elif [ -f "src/styles/variables.scss" ]; then
  DESIGN_TOKENS_FILE="src/styles/variables.scss"
elif [ -f "src/styles/tokens.css" ]; then
  DESIGN_TOKENS_FILE="src/styles/tokens.css"
elif [ -f "styles/variables.scss" ]; then
  DESIGN_TOKENS_FILE="styles/variables.scss"
fi
echo "DESIGN_TOKENS_FILE=$DESIGN_TOKENS_FILE"

echo "SCAN_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
