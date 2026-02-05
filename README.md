# @pic/claude-workflow

Claude Code 工作流工具包 - 支持多 AI 编码工具的标准化工作流命令、Agent 定义和文档。

## 特性

- **多 Agent 支持** - 一次安装，同时支持 10+ AI 编码工具
- **Canonical + Symlink 架构** - 单一源文件，多处链接，便于维护
- **交互式安装** - 友好的命令行交互体验
- **智能检测** - 自动检测已安装的 AI 编码工具

## 支持的 AI 编码工具

| Agent | 全局目录 | 项目目录 |
|-------|----------|----------|
| Antigravity | `~/.gemini/antigravity/skills` | `.agent/skills` |
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| Codex | `~/.codex/skills` | `.codex/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |
| Droid | `~/.factory/skills` | `.factory/skills` |
| Gemini CLI | `~/.gemini/skills` | `.gemini/skills` |
| GitHub Copilot | `~/.copilot/skills` | `.github/skills` |
| Kilo Code | `~/.kilocode/skills` | `.kilocode/skills` |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` |
| Qoder | `~/.qoder/skills` | `.qoder/skills` |

## 安装

首次使用需配置私有 registry：

```bash
# 设置 registry（替换为实际地址）
npm config set @pic:registry http://your-registry-host:4873
```

```bash
# 一键安装（推荐，无需全局安装）
npx @pic/claude-workflow sync

# 或全局安装后使用
npm install -g @pic/claude-workflow
claude-workflow sync
```

安装后会自动：
1. 检测已安装的 AI 编码工具
2. 复制模板到 canonical 位置 (`~/.agents/claude-workflow/`)
3. 为每个检测到的工具创建 symlink

## CLI 命令

### 交互式安装（推荐）

```bash
# 启动交互式安装向导
claude-workflow sync

# 或显式指定交互模式
claude-workflow sync -i
```

交互式安装会引导你：
1. 选择要安装到的 Agent
2. 选择安装作用域（全局/项目级）
3. 确认安装摘要

### 命令行安装

```bash
# 安装到所有检测到的 Agent
claude-workflow sync -y

# 安装到指定 Agent
claude-workflow sync -a claude-code,cursor

# 安装到所有支持的 Agent
claude-workflow sync -a '*' -y

# 项目级安装（当前目录）
claude-workflow sync --project

# 强制覆盖所有文件
claude-workflow sync -f

# 清理安装（删除旧文件后重新安装，用于移除已删除的 skill）
claude-workflow sync -c -y

# 使用旧版安装模式（仅 Claude Code，不使用 symlink）
claude-workflow sync --legacy
```

### 其他命令

```bash
# 查看安装状态
claude-workflow status

# 初始化项目配置
claude-workflow init

# 诊断配置问题
claude-workflow doctor
```

## 架构

```
~/.agents/claude-workflow/          # Canonical Location (Single Source of Truth)
├── .meta/                          # 元信息
│   └── meta.json
├── skills/                         # 技能定义
├── commands/                       # 命令定义
├── prompts/                        # 多模型协作 Prompt
├── utils/                          # 工具函数
└── specs/                          # 规范文档

~/.claude/skills/  → symlink → ~/.agents/claude-workflow/skills/
~/.cursor/skills/  → symlink → ~/.agents/claude-workflow/skills/
~/.codex/skills/   → symlink → ~/.agents/claude-workflow/skills/
...
```

## 包含内容

### 工作流技能 (skills/workflow/)

统一入口：`/workflow <action> [args]`

| 动作 | 说明 |
|------|------|
| `/workflow start "需求"` | 启动智能工作流（自动规划） |
| `/workflow execute` | 执行下一个任务 |
| `/workflow execute --retry` | 重试当前失败步骤 |
| `/workflow execute --skip` | 跳过当前步骤（慎用） |
| `/workflow status` | 查看工作流状态 |
| `/workflow unblock <dep>` | 解除任务阻塞 |
| `/workflow archive` | 归档已完成工作流 |

### 其他技能

- `/scan` - 智能项目扫描（检测技术栈 + 生成上下文报告）
- `/write-tests` - 编写测试
- `/analyze` - 代码分析
- `/diff-review` - 差异审查
- `/figma-ui` - Figma 设计稿转代码
- `/visual-diff` - UI 视觉差异对比

## 升级

```bash
# 使用 npx（推荐）
npx @pic/claude-workflow@latest sync

# 或全局安装后
npm update -g @pic/claude-workflow
```

升级时会自动：
1. 更新 canonical 位置的文件
2. 所有 Agent 通过 symlink 自动获得更新
3. 备份旧版本到 `~/.agents/claude-workflow/.meta/backups/`

## 项目初始化

```bash
cd your-project
claude-workflow init
```

这会在项目中创建：
- `.claude/config/project-config.json` - 项目配置

## 环境变量

| 变量 | 说明 |
|------|------|
| `CLAUDE_WORKFLOW_SKIP_POSTINSTALL=1` | 跳过 postinstall 自动安装 |
| `CLAUDE_WORKFLOW_AGENTS=agent1,agent2` | 指定目标 Agent（逗号分隔） |
| `CLAUDE_CONFIG_DIR` | 自定义 Claude Code 配置目录 |
| `CODEX_HOME` | 自定义 Codex 配置目录 |
| `XDG_CONFIG_HOME` | XDG 配置目录（影响 OpenCode 等） |

## 发布新版本

```bash
# 一键发布（自动：版本号 + 发布 + git tag + push）
npm run release:patch     # Bug 修复: 1.0.0 -> 1.0.1
npm run release:minor     # 新功能: 1.0.0 -> 1.1.0
npm run release:major     # 破坏性变更: 1.0.0 -> 2.0.0

# 或指定版本号
npm run release 2.0.0
```

## 从旧版本迁移

如果你之前使用的是旧版（直接复制到 `~/.claude/`），运行以下命令迁移到新架构：

```bash
claude-workflow sync
```

迁移会：
1. 备份现有文件
2. 复制到 canonical 位置
3. 创建 symlink 替换原有目录
4. 保持向后兼容

## 目录结构

```
~/.agents/claude-workflow/    # Canonical 位置（新架构）
├── .meta/
│   ├── meta.json             # 版本信息
│   └── backups/              # 升级备份
├── skills/                   # 技能定义
├── commands/                 # 命令定义
├── prompts/                  # 多模型协作 Prompt
├── utils/                    # 工具函数
└── specs/                    # 规范文档

~/.claude/.claude-workflow/   # 兼容性元信息（旧架构）
└── meta.json                 # 指向 canonical 位置
```
