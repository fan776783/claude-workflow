# 配置加载器

本文档描述如何在命令中加载项目配置，支持配置文件优先、降级到自动检测。

## 核心逻辑

### 1. 加载配置

```bash
#!/bin/bash

# 加载项目配置（优先读取配置文件）
load_project_config() {
  local config_path=".claude/config/project-config.json"

  # 检查配置文件是否存在
  if [ -f "$config_path" ]; then
    echo "✅ 发现项目配置: $config_path"

    # 读取配置
    export PROJECT_CONFIG=$(cat "$config_path")

    # 检查是否需要自动填充字段
    if echo "$PROJECT_CONFIG" | grep -q "{{auto-detect}}"; then
      echo "⚠️  配置包含待检测字段，正在自动填充..."
      fill_auto_detect_fields
    fi

    return 0
  else
    echo "⚠️  未发现项目配置，自动检测中..."

    # 降级到自动检测
    detect_and_save_config

    return 0
  fi
}

# 自动填充 {{auto-detect}} 字段
fill_auto_detect_fields() {
  local config_path=".claude/config/project-config.json"
  local temp_config=$(mktemp)

  # 读取当前配置
  cp "$config_path" "$temp_config"

  # 替换 project.name
  if grep -q '"name": "{{auto-detect}}"' "$temp_config"; then
    local project_name=$(basename "$(pwd)")
    sed -i.bak "s/\"name\": \"{{auto-detect}}\"/\"name\": \"$project_name\"/" "$temp_config"
  fi

  # 替换 project.rootDir
  if grep -q '"rootDir": "{{auto-detect}}"' "$temp_config"; then
    local root_dir=$(pwd)
    sed -i.bak "s|\"rootDir\": \"{{auto-detect}}\"|\"rootDir\": \"$root_dir\"|" "$temp_config"
  fi

  # 替换 metadata.generatedAt
  if grep -q '"generatedAt": "{{auto-detect}}"' "$temp_config"; then
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    sed -i.bak "s/\"generatedAt\": \"{{auto-detect}}\"/\"generatedAt\": \"$timestamp\"/" "$temp_config"
  fi

  # 替换 metadata.lastUpdated
  if grep -q '"lastUpdated": "{{auto-detect}}"' "$temp_config"; then
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    sed -i.bak "s/\"lastUpdated\": \"{{auto-detect}}\"/\"lastUpdated\": \"$timestamp\"/" "$temp_config"
  fi

  # 保存更新后的配置
  mv "$temp_config" "$config_path"
  rm -f "$temp_config.bak"

  # 重新加载
  export PROJECT_CONFIG=$(cat "$config_path")

  echo "✅ 自动检测字段已填充"
}

# 检测并保存配置
detect_and_save_config() {
  echo "🔍 开始自动检测项目配置..."

  # 调用检测器（参考 project-detector.md）
  source .claude/utils/project-detector.md

  # 生成配置文件
  local config_path=".claude/config/project-config.json"
  mkdir -p "$(dirname "$config_path")"

  # 生成配置内容（示例）
  cat > "$config_path" <<EOF
{
  "project": {
    "name": "$(basename "$(pwd)")",
    "type": "$PROJECT_TYPE",
    "rootDir": "$(pwd)"
  },
  "structure": {
    "apps": $(echo "$APPS_LIST" | jq -R -s -c 'split("\n") | map(select(length > 0))'),
    "packages": "$PACKAGES_DIR"
  },
  "tech": {
    "packageManager": "$PACKAGE_MANAGER",
    "buildTool": "$BUILD_TOOL",
    "frameworks": $(echo "${FRAMEWORKS[@]}" | jq -R -s -c 'split(" ") | map(select(length > 0))')
  },
  "customPaths": {
    "httpClient": "$HTTP_CLIENT",
    "tracking": "$TRACKING",
    "api": "$API",
    "ui": "$UI",
    "store": "$STORE",
    "utils": "$UTILS"
  },
  "microFrontend": {
    "enabled": $MICRO_ENABLED,
    "framework": "$MICRO_FRONTEND",
    "mainApp": "$MAIN_APP",
    "subApps": $(echo "$SUB_APPS" | jq -R -s -c 'split(",") | map(select(length > 0))')
  },
  "metadata": {
    "version": "1.0.0",
    "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "lastUpdated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "autoDetected": true
  }
}
EOF

  echo "✅ 配置已保存到: $config_path"

  # 加载生成的配置
  export PROJECT_CONFIG=$(cat "$config_path")
}
```

---

## 2. 读取配置字段

### 辅助函数

```bash
# 读取配置中的字符串字段
get_config_string() {
  local field_path=$1
  echo "$PROJECT_CONFIG" | jq -r ".$field_path"
}

# 读取配置中的布尔字段
get_config_bool() {
  local field_path=$1
  echo "$PROJECT_CONFIG" | jq -r ".$field_path"
}

# 读取配置中的数组字段
get_config_array() {
  local field_path=$1
  echo "$PROJECT_CONFIG" | jq -r ".$field_path | .[]"
}

# 检查字段是否为 null 或不存在
is_config_null() {
  local field_path=$1
  local value=$(echo "$PROJECT_CONFIG" | jq -r ".$field_path")
  [ "$value" = "null" ] || [ -z "$value" ]
}
```

### 使用示例

```bash
# 加载配置
load_project_config

# 读取项目类型
PROJECT_TYPE=$(get_config_string "project.type")
echo "项目类型: $PROJECT_TYPE"

# 读取包管理器
PACKAGE_MANAGER=$(get_config_string "tech.packageManager")
echo "包管理器: $PACKAGE_MANAGER"

# 读取框架列表
FRAMEWORKS=$(get_config_array "tech.frameworks")
echo "框架: $FRAMEWORKS"

# 检查微前端是否启用
MICRO_ENABLED=$(get_config_bool "microFrontend.enabled")
if [ "$MICRO_ENABLED" = "true" ]; then
  MICRO_FRAMEWORK=$(get_config_string "microFrontend.framework")
  echo "微前端框架: $MICRO_FRAMEWORK"
fi

# 检查自定义路径
HTTP_CLIENT=$(get_config_string "customPaths.httpClient")
if ! is_config_null "customPaths.httpClient"; then
  echo "HTTP 客户端路径: $HTTP_CLIENT"
fi
```

---

## 3. 在命令中使用

### 命令模板

```markdown
---
description: 示例命令 - 展示如何使用配置加载器
allowed-tools: Task(subagent_type=codex), Read(*), Grep(*), Glob(*)
---

# 示例命令

使用 Codex agent 执行示例任务，配置驱动。

## 执行前准备

\`\`\`bash
# 加载项目配置
source .claude/utils/config-loader.md
load_project_config

# 读取必要配置
PROJECT_ROOT=$(get_config_string "project.rootDir")
PACKAGE_MANAGER=$(get_config_string "tech.packageManager")
FRAMEWORKS=$(get_config_array "tech.frameworks")
\`\`\`

## 任务执行

启动 Codex agent（read-only 模式），执行以下任务：

**工作目录**：\`$PROJECT_ROOT\`  （从配置读取）

**项目信息**：
- 类型：$(get_config_string "project.type")
- 框架：$FRAMEWORKS
- 包管理器：$PACKAGE_MANAGER

**任务描述**：{用户输入的任务}

\`\`\`typescript
mcp__codex__codex({
  PROMPT: \`
    项目配置:
    - 根目录: $PROJECT_ROOT
    - 框架: $FRAMEWORKS
    - 包管理器: $PACKAGE_MANAGER

    任务: {用户任务}
  \`,
  cd: "$PROJECT_ROOT",
  sandbox: "read-only"
})
\`\`\`
```

---

## 4. 配置验证

### 验证函数

```bash
# 验证配置完整性
validate_config() {
  echo "🔍 验证配置..."

  local errors=0

  # 检查必填字段
  if is_config_null "project.type"; then
    echo "❌ 缺少 project.type"
    errors=$((errors + 1))
  fi

  if is_config_null "tech.packageManager"; then
    echo "❌ 缺少 tech.packageManager"
    errors=$((errors + 1))
  fi

  if is_config_null "tech.frameworks"; then
    echo "❌ 缺少 tech.frameworks"
    errors=$((errors + 1))
  fi

  # 检查路径有效性
  local root_dir=$(get_config_string "project.rootDir")
  if [ ! -d "$root_dir" ]; then
    echo "❌ 项目根目录不存在: $root_dir"
    errors=$((errors + 1))
  fi

  # 检查包管理器是否有效
  local pkg_mgr=$(get_config_string "tech.packageManager")
  if ! command -v "$pkg_mgr" &> /dev/null; then
    echo "⚠️  包管理器 $pkg_mgr 未安装"
  fi

  if [ $errors -gt 0 ]; then
    echo "❌ 配置验证失败，发现 $errors 个错误"
    return 1
  fi

  echo "✅ 配置验证通过"
  return 0
}
```

### 使用示例

```bash
# 加载配置
load_project_config

# 验证配置
if ! validate_config; then
  echo "请运行 /scan 重新生成配置"
  exit 1
fi

# 继续执行任务...
```

---

## 5. 配置更新

### 更新函数

```bash
# 更新配置字段
update_config_field() {
  local field_path=$1
  local new_value=$2
  local config_path=".claude/config/project-config.json"

  # 使用 jq 更新字段
  local temp_config=$(mktemp)
  jq ".$field_path = \"$new_value\"" "$config_path" > "$temp_config"
  mv "$temp_config" "$config_path"

  # 更新 lastUpdated
  temp_config=$(mktemp)
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  jq ".metadata.lastUpdated = \"$timestamp\"" "$config_path" > "$temp_config"
  mv "$temp_config" "$config_path"

  echo "✅ 已更新 $field_path = $new_value"

  # 重新加载配置
  export PROJECT_CONFIG=$(cat "$config_path")
}

# 更新配置数组
update_config_array() {
  local field_path=$1
  shift
  local new_values=("$@")
  local config_path=".claude/config/project-config.json"

  # 转换为 JSON 数组
  local json_array=$(printf '%s\n' "${new_values[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')

  # 使用 jq 更新数组
  local temp_config=$(mktemp)
  jq ".$field_path = $json_array" "$config_path" > "$temp_config"
  mv "$temp_config" "$config_path"

  echo "✅ 已更新 $field_path = ${new_values[*]}"

  # 重新加载配置
  export PROJECT_CONFIG=$(cat "$config_path")
}
```

### 使用示例

```bash
# 更新项目描述
update_config_field "project.description" "新的项目描述"

# 更新框架列表
update_config_array "tech.frameworks" "react" "vue" "angular"

# 更新微前端启用状态
update_config_field "microFrontend.enabled" "true"
```

---

## 6. 缓存优化

### 缓存机制

```bash
# 配置缓存变量
declare -A CONFIG_CACHE

# 带缓存的配置读取
get_config_cached() {
  local field_path=$1

  # 检查缓存
  if [ -n "${CONFIG_CACHE[$field_path]}" ]; then
    echo "${CONFIG_CACHE[$field_path]}"
    return 0
  fi

  # 读取并缓存
  local value=$(get_config_string "$field_path")
  CONFIG_CACHE[$field_path]="$value"
  echo "$value"
}

# 清空缓存
clear_config_cache() {
  unset CONFIG_CACHE
  declare -g -A CONFIG_CACHE
}
```

---

## 7. 错误处理

### 错误处理函数

```bash
# 安全的配置读取（带默认值）
get_config_or_default() {
  local field_path=$1
  local default_value=$2

  if is_config_null "$field_path"; then
    echo "$default_value"
  else
    get_config_string "$field_path"
  fi
}

# 必需字段检查
require_config() {
  local field_path=$1
  local error_message=$2

  if is_config_null "$field_path"; then
    echo "❌ 错误: $error_message"
    echo "   缺少配置字段: $field_path"
    exit 1
  fi
}
```

### 使用示例

```bash
# 读取配置，提供默认值
BUILD_TOOL=$(get_config_or_default "tech.buildTool" "vite")

# 必需字段检查
require_config "project.rootDir" "项目根目录未配置"
require_config "tech.packageManager" "包管理器未配置"
```

---

## 完整使用示例

```bash
#!/bin/bash

# 1. 加载配置
source .claude/utils/config-loader.md
load_project_config

# 2. 验证配置
if ! validate_config; then
  exit 1
fi

# 3. 读取必要配置
PROJECT_ROOT=$(require_config "project.rootDir" "项目根目录未配置"; get_config_string "project.rootDir")
PACKAGE_MANAGER=$(get_config_or_default "tech.packageManager" "npm")
FRAMEWORKS=$(get_config_array "tech.frameworks")

# 4. 使用配置执行任务
cd "$PROJECT_ROOT"

for framework in $FRAMEWORKS; do
  echo "处理框架: $framework"
  # 执行具体任务...
done

# 5. 更新配置（如需要）
update_config_field "metadata.lastUpdated" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
```
