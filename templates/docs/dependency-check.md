# 依赖检测指南

**用途**: 说明 Claude Workflow Toolkit 的依赖检测逻辑和各依赖的作用

---

## 📋 依赖分类

### 必需依赖

这些依赖是安装脚本正常运行的前提：

| 依赖 | 用途 | 检测方法 | 安装方式 |
|------|------|----------|----------|
| **curl** | 下载工具包 | `command -v curl` | macOS: `brew install curl`<br>Linux: `apt install curl` / `yum install curl` |
| **tar** | 解压工具包 | `command -v tar` | 系统自带 |

### 推荐依赖

这些依赖是工作流正常使用的前提：

| 依赖 | 用途 | 检测方法 | 安装方式 |
|------|------|----------|----------|
| **Claude Code** | AI 辅助编程工具 | 检查 `~/.claude/` 目录 | https://claude.ai/code |
| **Node.js** | 运行 JavaScript 工具 | `command -v node` | https://nodejs.org/ |
| **Git** | 版本控制 | `command -v git` | macOS: `brew install git`<br>Linux: `apt install git` |

### 可选依赖（MCP 服务）

这些依赖提供额外的集成功能：

| 依赖 | 用途 | 检测方法 | 配置文件 |
|------|------|----------|----------|
| **Codex MCP** | 代码分析和生成 | `command -v codex` | `~/.claude/mcp_config.json` |
| **Figma MCP** | 设计稿解析 | 检查 MCP 配置 | `~/.claude/mcp_config.json` |
| **Exa MCP** | 代码搜索 | 检查 MCP 配置 | `~/.claude/mcp_config.json` |
| **BK-MCP** | 蓝鲸工作项集成 | 检查 MCP 配置 | `~/.claude/mcp_config.json` |
| **Chrome MCP** | 浏览器自动化 | 检查 MCP 配置 | `~/.claude/mcp_config.json` |

---

## 🔍 检测逻辑

### 1. Claude Code 检测

```bash
# 方法 1: 检查特征文件
if [ -f "$HOME/.claude/history.jsonl" ] || [ -d "$HOME/.claude/session-env" ]; then
    echo "Claude Code 已安装"
fi

# 方法 2: 检查命令
if command -v claude &> /dev/null; then
    echo "Claude Code 已安装"
fi
```

### 2. Codex MCP 检测

```bash
# 检查 Codex 命令
if command -v codex &> /dev/null; then
    CODEX_VERSION=$(codex --version 2>&1 | head -n1)
    echo "Codex MCP 已安装: $CODEX_VERSION"
fi

# 检查 MCP 配置
MCP_CONFIG="$HOME/.claude/mcp_config.json"
if [ -f "$MCP_CONFIG" ]; then
    if grep -q "\"codex\"" "$MCP_CONFIG"; then
        echo "Codex MCP 已配置"
    fi
fi
```

### 3. 其他 MCP 服务检测

```bash
MCP_CONFIG="$HOME/.claude/mcp_config.json"

check_mcp_service() {
    local service=$1
    if [ -f "$MCP_CONFIG" ]; then
        if grep -q "\"$service\"" "$MCP_CONFIG"; then
            echo "$service MCP: 已配置"
            return 0
        fi
    fi
    echo "$service MCP: 未配置"
    return 1
}

check_mcp_service "figma"
check_mcp_service "exa"
check_mcp_service "bk"
check_mcp_service "chrome"
```

---

## ⚠️ 依赖缺失的影响

### 缺少 Claude Code

**影响**: 无法使用任何工作流命令

**解决**:
```bash
# 安装 Claude Code
# 访问: https://claude.ai/code
# 或运行: npm install -g @anthropics/claude-code
```

### 缺少 Codex MCP

**影响**: 以下功能将被跳过

- Codex Gate（代码原型生成和审查）
- `/codex-analyze` 命令

**工作流适配**:
- `/workflow-start`: 跳过 Codex Gate 步骤
- `/workflow-fix-bug`: 跳过 Codex 代码审查

**解决**: 参考 Codex MCP 文档安装

### 缺少 Figma MCP

**影响**: UI 还原工作流受限

- `/workflow-ui-restore` 无法自动获取设计稿信息
- 需要手动提供设计规范

**解决**: 配置 Figma MCP

### 缺少 BK-MCP

**影响**: Bug 修复工作流功能受限

- `/workflow-fix-bug` 无法自动获取缺陷信息
- 无法自动流转缺陷状态

**工作流适配**:
- 步骤 0（缺陷信息获取）自动跳过
- 步骤 6（更新缺陷状态）自动跳过

**解决**: 配置 BK-MCP

---

## 📝 MCP 配置文件示例

**位置**: `~/.claude/mcp_config.json`

```json
{
  "mcpServers": {
    "codex": {
      "command": "codex",
      "args": ["serve"],
      "env": {}
    },
    "figma": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-figma"],
      "env": {
        "FIGMA_PERSONAL_ACCESS_TOKEN": "your-token"
      }
    },
    "exa": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-exa"],
      "env": {
        "EXA_API_KEY": "your-api-key"
      }
    },
    "bk": {
      "command": "npx",
      "args": ["-y", "@your-org/bk-mcp-server"],
      "env": {
        "BK_APP_CODE": "your-app-code",
        "BK_APP_SECRET": "your-app-secret"
      }
    }
  }
}
```

---

## 🛠️ 手动检测脚本

创建一个独立的检测脚本：

```bash
#!/bin/bash
# check-dependencies.sh

echo "Claude Workflow Toolkit - 依赖检测"
echo "======================================"
echo ""

# 必需依赖
echo "必需依赖:"
command -v curl &> /dev/null && echo "  ✓ curl" || echo "  ✗ curl [缺失]"
command -v tar &> /dev/null && echo "  ✓ tar" || echo "  ✗ tar [缺失]"

# 推荐依赖
echo ""
echo "推荐依赖:"
[ -d "$HOME/.claude/session-env" ] && echo "  ✓ Claude Code" || echo "  ✗ Claude Code [未安装]"
command -v node &> /dev/null && echo "  ✓ Node.js ($(node --version))" || echo "  ✗ Node.js [未安装]"
command -v git &> /dev/null && echo "  ✓ Git ($(git --version | awk '{print $3}'))" || echo "  ✗ Git [未安装]"

# MCP 服务
echo ""
echo "MCP 服务:"
command -v codex &> /dev/null && echo "  ✓ Codex MCP" || echo "  ⚠ Codex MCP [未安装]"

if [ -f "$HOME/.claude/mcp_config.json" ]; then
    echo "  ✓ MCP 配置文件存在"

    grep -q "\"figma\"" "$HOME/.claude/mcp_config.json" && echo "    - Figma MCP: 已配置" || echo "    - Figma MCP: 未配置"
    grep -q "\"exa\"" "$HOME/.claude/mcp_config.json" && echo "    - Exa MCP: 已配置" || echo "    - Exa MCP: 未配置"
    grep -q "\"bk\"" "$HOME/.claude/mcp_config.json" && echo "    - BK-MCP: 已配置" || echo "    - BK-MCP: 未配置"
else
    echo "  ⚠ MCP 配置文件不存在"
fi

echo ""
echo "检测完成"
```

使用方法：

```bash
chmod +x check-dependencies.sh
./check-dependencies.sh
```

---

## 📚 安装指南链接

### Claude Code
- 官网: https://claude.ai/code
- 文档: https://docs.anthropic.com/claude/docs/code

### Codex MCP
- 仓库: https://github.com/your-org/codex
- 文档: 见仓库 README

### Figma MCP
- 仓库: https://github.com/modelcontextprotocol/servers/tree/main/src/figma
- 文档: https://modelcontextprotocol.io/docs

### Exa MCP
- 仓库: https://github.com/modelcontextprotocol/servers/tree/main/src/exa
- 文档: https://exa.ai/

### BK-MCP（蓝鲸工作项集成）
- 📚 完整安装指南：[BK-MCP 安装配置教程（钉钉文档）](https://applink.dingtalk.com/page/link?target=workbench&url=http%3A%2F%2Faihub.300624.cn%3A5613%2Fexperience%2F841)
- 功能：自动获取缺陷详情、流转工作项状态、批量创建子任务、上传附件
- 配置文件：`~/.claude/mcp_config.json`

**配置示例**：
```json
{
  "mcpServers": {
    "bk": {
      "command": "npx",
      "args": ["-y", "@tencent/bk-mcp-server"],
      "env": {
        "BK_APP_CODE": "your-app-code",
        "BK_APP_SECRET": "your-app-secret",
        "BK_API_URL": "https://your-bk-domain.com"
      }
    }
  }
}
```

**快速验证**：
```bash
# 在 Claude Code 中执行
/workflow-fix-bug "p328_600"

# 系统会自动从蓝鲸获取工单详情
```

---

## ✅ 最佳实践

### 1. 优先安装核心依赖

```bash
# macOS
brew install curl git node

# Linux (Ubuntu/Debian)
sudo apt update
sudo apt install curl git nodejs npm

# Linux (CentOS/RHEL)
sudo yum install curl git nodejs npm
```

### 2. 配置 MCP 服务

创建配置文件：

```bash
mkdir -p ~/.claude
cat > ~/.claude/mcp_config.json << 'EOF'
{
  "mcpServers": {
    "codex": {
      "command": "codex",
      "args": ["serve"]
    }
  }
}
EOF
```

### 3. 验证安装

```bash
# 运行检测脚本
~/.claude/check-dependencies.sh

# 或手动检查
ls ~/.claude/commands/ | wc -l  # 应该显示 25+
```

---

## 🔄 依赖更新

### 更新 Claude Code

```bash
# 通过 npm
npm update -g @anthropics/claude-code

# 通过官网
# 访问 https://claude.ai/code 下载最新版本
```

### 更新 MCP 服务

```bash
# 更新 Codex
npm update -g codex

# 更新其他 MCP 服务
# 重新运行安装脚本或手动更新配置
```

---

## 📞 故障排查

### 问题 1: Claude Code 未检测到

**检查**:
```bash
ls ~/.claude/
# 应该包含: history.jsonl, session-env/ 等
```

**解决**: 重新安装 Claude Code

### 问题 2: MCP 服务未生效

**检查**:
```bash
cat ~/.claude/mcp_config.json
# 验证 JSON 格式正确
```

**解决**: 修复配置文件格式

### 问题 3: Codex 命令找不到

**检查**:
```bash
echo $PATH
which codex
```

**解决**: 添加 Codex 到 PATH 或使用绝对路径

---

## 🎯 总结

**必需依赖** (安装脚本运行):
- curl
- tar

**推荐依赖** (工作流正常使用):
- Claude Code
- Node.js
- Git

**可选依赖** (增强功能):
- Codex MCP
- Figma MCP
- Exa MCP
- BK-MCP
- Chrome MCP

**依赖检测原则**:
1. 必需依赖缺失 → 安装失败
2. 推荐依赖缺失 → 警告但继续
3. 可选依赖缺失 → 提示但不影响安装
4. 工作流运行时自动适配缺失的依赖

---

**版本**: 1.0.0
**最后更新**: 2025-01-20
