# AI 编码工具通用工作流体系指南

> 基于 Skills 架构的智能化开发工作流体系 - 支持 10+ AI 编码工具

**文档版本**：v9.0.0
**最后更新**：2026-03-13
**包版本**：@pic/claude-workflow v3.4.1

---

## 📖 目录

- [1. 概述](#1-概述)
- [2. 工作流安装与配置](#2-工作流安装与配置)
- [3. 智能工作流](#3-智能工作流)
  - [3.10 需求讨论阶段](#310-需求讨论阶段phase-02)
  - [3.11 执行纪律强化](#311-执行纪律强化)
- [4. 其他工作流](#4-其他工作流)
  - [4.1 UI 还原工作流](#41-ui-还原工作流figma-ui)
  - [4.2 视觉差异验证](#42-视觉差异验证visual-diff)
  - [4.3 PRD 文档工作流](#43-prd-文档工作流)
- [5. 智能分析命令](#5-智能分析命令)
- [6. 审查命令](#6-审查命令)
- [7. 调试命令](#7-调试命令)
- [8. 批量缺陷修复](#8-批量缺陷修复)
- [9. 典型场景实战](#9-典型场景实战)
- [10. 最佳实践](#10-最佳实践)
- [11. 常见问题](#11-常见问题)
- [附录 A：命令速查表](#附录-a命令速查表)
- [附录 B：Prompt 模板](#附录-bprompt-模板)
- [附录 C：快速入门](#附录-c快速入门)

---

## 1. 概述

### 1.1 什么是工作流体系

AI 编码工具通用工作流体系是一套基于 Skills 架构的智能化开发流程，通过可移植的技能定义支持 10+ AI 编码工具，涵盖从需求分析到质量验证的完整开发生命周期。

**核心价值**：
- ✅ **Skills 体系**：可移植的技能定义，支持跨工具使用
- ✅ **多 Agent 支持**：一次安装，同时支持 10+ AI 编码工具（Claude Code、Cursor、Codex、Gemini CLI 等）
- ✅ **Canonical + Symlink 架构**：单一源文件（~/.agents/claude-workflow/），多处链接，便于维护和更新
- ✅ **交互式安装**：友好的命令行交互体验，智能检测已安装的 Agent
- ✅ **渐进加载**：按需加载 references 减少上下文占用
- ✅ **npm 包安装**：`npm install -g @pic/claude-workflow` 一行命令完成安装
- ✅ **智能升级**：自动备份、保留用户修改
- ✅ **CLI 工具**：`claude-workflow status/sync/init/doctor` 命令行管理
- ✅ **多模型协作**：Gemini（前端） + Codex（后端）双模型并行协作
- ✅ **零配置体验**：首次使用自动检测并初始化项目
- ✅ **用户级存储**：工作流状态存储在 `~/.claude/`，完全避免 Git 冲突
- ✅ **极简使用**：仅需 2 个命令即可完成复杂任务
- ✅ **智能规划**：根据需求自动生成执行计划
- ✅ **自动记忆**：任务进度持久化，支持新对话恢复
- ✅ **质量保证**：内置双模型审查机制
- ✅ **多项目管理**：自动识别和隔离不同项目的工作流状态

### 1.2 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│         @pic/claude-workflow (v3.4.1)                        │
│     npm 包工作流工具集 - Skills 架构，支持 10+ AI 工具        │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  多 Agent 支持   │  │ Canonical 架构   │  │ CLI 工具         │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • Claude Code   │  │ • ~/.agents/    │  │ • status 状态    │
│ • Cursor        │  │   claude-       │  │ • sync 同步      │
│ • Codex         │  │   workflow/     │  │ • init 初始化    │
│ • Gemini CLI    │  │ • Symlink 链接   │  │ • doctor 诊断    │
│ • Antigravity   │  │ • 单一源文件     │  │ • -c 清理安装    │
│ • Droid         │  │ • 自动更新       │  │ • -a 指定 Agent  │
│ • GitHub Copilot│  │                 │  │                 │
│ • Kilo Code     │  │                 │  │                 │
│ • OpenCode      │  │                 │  │                 │
│ • Qoder         │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Skills (10 个)   │  │  任务记忆管理    │  │  质量关卡系统   │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • workflow      │  │ • 进度持久化     │  │ • Codex 方案审查 │
│ • scan          │  │ • 新对话恢复     │  │ • Codex 代码审查 │
│ • analyze       │  │ • 决策记录       │  │ • Gemini UI审查  │
│ • debug         │  │ • 项目隔离       │  │ • 评分门槛控制   │
│ • diff-review   │  │                 │  │                 │
│ • write-tests   │  │                 │  │                 │
│ • bug-batch     │  │                 │  │                 │
│ • figma-ui      │  │                 │  │                 │
│ • visual-diff   │  │                 │  │                 │
│ • perf-budget   │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 1.3 支持的 AI 编码工具

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

### 1.4 命令总览

项目核心命令（v3.4.1 使用 Skills 架构）：

| 类别 | 核心命令 | 说明 |
|------|---------|------|
| **智能工作流** ⭐⭐⭐ | `/workflow start`, `/workflow execute` | 自动规划和执行（推荐） |
| **工作流辅助** | `/workflow status`, `/workflow execute --retry`, `/workflow execute --skip`, `/workflow delta` | 状态查看、重试、跳过、增量变更 |
| **项目扫描** | `/scan` | 智能项目扫描（检测技术栈 + 蓝鲸项目关联） |
| **UI 还原** | `/figma-ui` | Figma 设计稿 → 前端代码（Skill） |
| **视觉验证** | `/visual-diff` | UI 视觉差异对比（像素级 + 双模型语义） |
| **CLI 工具** | `claude-workflow status/sync/init/doctor` | 状态查看、同步、初始化、诊断 |
| **智能分析** | `/analyze` | 双模型技术分析（Codex + Gemini 并行） |
| **代码审查** | `/diff-review`, `/diff-review --quick` | 多模型并行审查 / 单模型快速审查 |
| **调试** | `/debug` | Bug 修复流程 + 模型审查（Codex/Gemini） |
| **批量修复** | `/bug-batch` | 从蓝鲸拉取缺陷清单，逐个独立修复 |
| **测试** | `/write-tests` | 测试编写专家 |
| **其他工具** | `/enhance`, `/git-rollback`, `/skill-creator` | Prompt 增强、Git 回滚、Skill 创建 |
| **帮助** | `/agents` | 查看所有可用 Agent 命令 |

---

## 2. 工作流安装与配置

### 2.1 npm 包安装（推荐）

`@pic/claude-workflow` 是一个 npm 包，提供基于 Skills 架构的标准化工作流，支持 10+ AI 编码工具。

#### 全局安装

```bash
# 全局安装（推荐）
npm install -g @pic/claude-workflow --registry http://your-registry-host:4873

# 或作为开发依赖
npm install -D @pic/claude-workflow --registry http://your-registry-host:4873
```

**安装过程会自动：**
1. ✅ 检测已安装的 AI 编码工具（Claude Code、Cursor、Codex 等）
2. ✅ 复制 Skills 到 canonical 位置 (`~/.agents/claude-workflow/`)
3. ✅ 为每个检测到的工具创建 symlink
4. ✅ 检测版本变化，智能合并用户修改

#### 升级

```bash
npm update -g @pic/claude-workflow --registry http://your-registry-host:4873
```

**升级时会自动**：
1. 更新 canonical 位置的 Skills
2. 所有 Agent 通过 symlink 自动获得更新
3. 备份旧版本到 `~/.agents/claude-workflow/.meta/backups/`

### 2.2 CLI 命令

安装后可使用 `claude-workflow` 命令行工具：

#### 交互式安装（推荐）

```bash
# 启动交互式安装向导
claude-workflow sync

# 或显式指定交互模式
claude-workflow sync -i
```

交互式安装会引导你：
1. 选择要安装到的 Agent
2. 选择安装作用域（全局/项目级）
3. 选择安装模式（增量更新/清理安装）
4. 确认安装摘要

#### 命令行安装

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

#### 其他命令

```bash
# 查看安装状态
claude-workflow status

# 初始化项目配置
claude-workflow init

# 诊断配置问题
claude-workflow doctor
```

#### 命令说明

| 命令 | 说明 |
|------|------|
| `status` | 显示已安装版本、Agent 状态、symlink 状态 |
| `sync` | 同步模板到多个 Agent，智能合并用户修改 |
| `sync -f/--force` | 强制覆盖所有文件 |
| `sync -c/--clean` | 清理安装：先删除旧文件再安装（用于移除已删除的 skill） |
| `sync -a/--agent` | 指定目标 Agent（逗号分隔，* 表示全部） |
| `sync --project` | 项目级安装（当前目录） |
| `init` | 在当前项目创建 `.claude/config/project-config.json` |
| `doctor` | 诊断配置问题，检测 symlink 状态和缺失文件 |

### 2.3 目录结构

安装完成后的目录结构：

```
~/.agents/claude-workflow/          # Canonical 位置（Single Source of Truth）
├── .meta/                          # 元信息
│   ├── meta.json                   # 版本信息
│   └── backups/                    # 升级备份
├── skills/                         # 10 个 Skills（支持 references 渐进加载）
│   ├── workflow/                   # 智能工作流（含 6 个 references）
│   ├── scan/                       # 项目扫描（含蓝鲸关联）
│   ├── analyze/                    # 双模型分析
│   ├── debug/                      # 调试与修复
│   ├── diff-review/                # 代码审查
│   ├── write-tests/                # 测试编写
│   ├── bug-batch/                  # 批量缺陷修复
│   ├── figma-ui/                   # UI 还原
│   ├── visual-diff/                # 视觉差异验证
│   └── perf-budget/                # 性能预算
├── commands/                       # 工具命令（enhance, git-rollback, agents）
├── prompts/                        # 双模型协作 Prompt 模板
│   ├── codex/                      # Codex 角色提示词
│   └── gemini/                     # Gemini 角色提示词
├── utils/                          # 工具函数
└── specs/                          # 规范文档

# Symlink 链接（自动创建）
~/.claude/skills/  → symlink → ~/.agents/claude-workflow/skills/
~/.cursor/skills/  → symlink → ~/.agents/claude-workflow/skills/
~/.codex/skills/   → symlink → ~/.agents/claude-workflow/skills/
...

# 工作流状态（按项目隔离）
~/.claude/workflows/                # 工作流状态
├── a13dcda9d96c/                   # 项目 1（基于 cwd hash）
│   ├── workflow-state.json         # 工作流记忆
│   └── .project-meta.json          # 项目元数据
└── b2c3d4e5f6a1/                   # 项目 2
```

### 2.4 环境变量

| 变量 | 说明 |
|------|------|
| `CLAUDE_WORKFLOW_SKIP_POSTINSTALL=1` | 跳过 postinstall 自动安装 |
| `CLAUDE_WORKFLOW_AGENTS=agent1,agent2` | 指定目标 Agent（逗号分隔） |
| `CLAUDE_CONFIG_DIR` | 自定义 Claude Code 配置目录 |
| `CODEX_HOME` | 自定义 Codex 配置目录 |
| `XDG_CONFIG_HOME` | XDG 配置目录（影响 OpenCode 等） |

### 2.5 依赖检测

工具包会自动检测以下依赖：

| 级别 | 依赖 | 用途 | 缺失时处理 |
|------|------|------|-----------|
| **必需** | Node.js >= 18 | 运行环境 | ❌ 安装失败 |
| **推荐** | Claude Code | AI 辅助编程工具 | ⚠️ 显示警告 |
| **推荐** | Git | 版本控制 | ⚠️ 显示警告 |
| **可选** | codeagent-wrapper | 多模型协作（调用 Codex/Gemini CLI） | ℹ️ 双模型功能不可用 |
| **可选** | Figma MCP | 设计稿解析 | ℹ️ 提示功能受限 |
| **可选** | BK-MCP | 蓝鲸工作项集成 | ℹ️ 提示功能受限 |
| **可选** | Chrome MCP | 浏览器自动化截图 | ℹ️ visual-diff 不可用 |

**工作流自动适配**：
- 缺少 codeagent-wrapper → 跳过双模型协作步骤，当前模型独立完成
- 缺少 Figma MCP → UI 还原需手动提供设计规范
- 缺少 BK-MCP → Bug 修复工作流跳过缺陷信息获取和状态流转

#### MCP 服务安装指引

**BK-MCP（蓝鲸工作项集成）**：

BK-MCP 用于集成蓝鲸 DevOps 平台的工作项系统，支持：
- ✅ 自动获取缺陷/需求详情
- ✅ 自动流转工作项状态
- ✅ 批量创建子任务
- ✅ 上传附件和添加评论

**安装教程**：
- 📚 完整安装指南：[BK-MCP 安装配置教程（钉钉文档）](https://applink.dingtalk.com/page/link?target=workbench&url=http%3A%2F%2Faihub.300624.cn%3A5613%2Fexperience%2F841)

**快速验证**：

```bash
# 1. 配置完成后，在 Claude Code 中执行
/debug "p328_600"

# 2. 如果配置成功，系统会自动：
#    - 从蓝鲸获取工单 p328_600 的详情
#    - 执行 debug 流程定位修复
#    - 修复完成后路由模型审查

# 3. 如果配置失败，系统会提示并跳过 BK-MCP 相关步骤
```

---

**codeagent-wrapper（多模型协作）**：

`codeagent-wrapper` 是多模型协作的核心工具，封装了 Codex CLI 和 Gemini CLI 的调用：
- ✅ 统一接口调用 Codex/Gemini 后端
- ✅ 多轮对话与会话持久化（SESSION_ID + resume）
- ✅ 并行任务执行支持（`--parallel` 模式）
- ✅ HEREDOC 标准输入，支持 ROLE_FILE 角色注入

**安装**：独立二进制文件，安装到 `~/.local/bin/`（需确保在 PATH 中）。

**验证安装**：
```bash
codeagent-wrapper --version
# 成功标志：显示版本号

# 后端可用性检查
codeagent-wrapper --backend codex "echo test" .
codeagent-wrapper --backend gemini "echo test" .
```

**使用语法**：
```bash
# 单次调用
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.agents/claude-workflow/prompts/codex/analyzer.md
<TASK>分析任务描述</TASK>
OUTPUT: Unified Diff Patch ONLY
EOF

# 恢复会话
codeagent-wrapper --backend codex resume <session_id> - <<'EOF'
<follow-up task>
EOF
```

---

**其他 MCP 服务**：

- **Figma MCP** - 设计稿解析：配置后可启用 `/figma-ui` 自动获取设计稿信息
- **Chrome MCP** - 浏览器自动化：用于 `/visual-diff` 页面截图和 UI 测试

#### 多模型协作机制

工作流体系通过 `codeagent-wrapper` 实现 **Codex + Gemini 双模型协作**：

| 模型 | 擅长领域 | 使用场景 |
|------|---------|---------|
| **Codex** | 后端逻辑、API 设计、安全、性能、代码审查 | 业务逻辑、Debug、Review |
| **Gemini** | 前端代码、UI 设计、CSS、组件、可访问性 | 组件原型、样式调整、需求分析 |

**协作原则**：
1. 前端任务 → 优先调用 Gemini 获取原型代码
2. 后端任务 → 调用 Codex 获取实现方案
3. 全栈任务 → Codex ∥ Gemini 并行，当前模型整合
4. 两者输出为"脏原型"，最终代码由当前模型重构

### 2.6 用户级存储架构

**重要变更**：工作流状态从项目目录迁移到用户目录，完全避免 Git 冲突！

#### 目录结构

```
~/.agents/claude-workflow/              # Canonical 位置（通过 symlink 共享给各 Agent）
├── skills/                            # 10 个 Skills（渐进加载）
├── commands/                          # 工具命令（3 个：agents、enhance、git-rollback）
├── prompts/                           # 双模型协作 Prompt（codex/ + gemini/）
├── utils/                             # 工具函数（workflow-helpers.sh）
├── specs/                             # 技术规范（shared/ + workflow/）
└── .meta/                             # 版本元信息 + 备份

~/.claude/workflows/                    # 工作流运行时状态（按项目隔离，不提交 Git）
├── a13dcda9d96c/                      # 项目 1（基于 cwd MD5 hash）
│   ├── workflow-state.json            # 工作流状态机
│   ├── tasks-{name}.md                # 任务清单
│   ├── changes/                       # 增量变更记录
│   │   └── CHG-001/
│   │       ├── delta.json
│   │       ├── intent.md
│   │       └── review-status.json
│   └── .project-meta.json             # 项目元数据
└── b2c3d4e5f6a1/                      # 项目 2
```

#### 项目识别机制

基于当前工作目录（cwd）的 MD5 hash 自动识别项目：

```typescript
// 例如：/Users/ws/dev/skymediafrontend → a13dcda9d96c
const projectId = crypto.createHash('md5')
  .update(process.cwd())
  .digest('hex')
  .substring(0, 12);
```

#### 核心优势

- ✅ **完全避免 Git 冲突** - 工作流状态不在项目目录
- ✅ **多人协作无冲突** - 每个开发者管理自己的状态
- ✅ **自动项目识别** - 无需配置，基于 cwd 自动识别
- ✅ **用户完全自主** - 不提交到 Git，完全由用户管理

### 2.7 自动初始化

**零配置体验**：首次执行工作流时自动检测并初始化项目！

#### 工作流程

```bash
# 1. 直接在任意项目中执行工作流
cd /path/to/your/project
/workflow start "添加用户认证功能"

# 2. 系统自动检测项目未初始化，提示：
# ⚠️ 检测到项目未初始化
#
# 📋 当前项目: your-project
# 📍 项目路径: /path/to/your/project
#
# 是否自动初始化项目配置？
#   1️⃣ 自动初始化（推荐）← 选择这个
#   2️⃣ 手动配置
#   3️⃣ 取消

# 3. 选择"自动初始化"后，系统自动：
# 🔍 自动检测到项目信息：
#   项目名称: your-project
#   项目类型: single
#   包管理器: npm
#   框架: react
#
# ✅ 项目配置已创建
# 📁 配置文件: .claude/config/project-config.json
#
# ✅ 初始化完成，继续执行工作流...
```

#### 自动检测功能

- **项目类型**：monorepo / single
- **包管理器**：pnpm / yarn / npm
- **框架**：react / vue / nextjs / nuxtjs 等

#### 手动初始化（可选）

如果您想预先配置项目：

```bash
cd /path/to/your/project
claude-workflow init
```

或使用 `/scan` 命令进行完整扫描（包含蓝鲸项目关联）。

### 2.8 项目配置文件

**最小配置**（`.claude/config/project-config.json`）：

```json
{
  "project": {
    "name": "my-project",
    "type": "single",
    "rootDir": ".",
    "bkProjectId": ""
  },
  "tech": {
    "packageManager": "npm",
    "framework": "react"
  },
  "workflow": {
    "defaultModel": "sonnet",
    "enableBKMCP": false
  }
}
```

**注意**：
- 项目配置应提交到 Git，供团队共享；工作流状态存储在 `~/.claude/`，不提交 Git
- `bkProjectId` 通过 `/scan` 自动关联蓝鲸项目，也可手动填写

---

## 3. 智能工作流

### 3.1 核心概念

**智能工作流 = 自动规划 + 自动记忆 + 智能执行**

只需记住 **1 个 Skill 入口**：
```bash
/workflow start "功能需求"    # 启动：分析需求并生成执行计划
/workflow execute             # 执行：自动执行下一步（可重复调用）
/workflow status              # 状态：查看当前进度
/workflow delta               # 增量：处理需求更新、API 变更
```

### 3.2 工作原理

#### 启动阶段（/workflow start）

```
需求 ──▶ 代码分析 ──▶ 需求讨论 ──▶ tech-design.md ──▶ Intent Review ──▶ tasks.md
              │              │              │                   │              │
         codebase-       💬 逐个澄清     Hard Stop:          审查意图       Hard Stop:
         retrieval       🎯 方案选择     确认设计方案        是否对齐       确认任务清单
```

1. 使用 codebase-retrieval 分析需求和代码上下文
   - 自动检测相关模块
   - 获取依赖关系图
   - 评估实现复杂度

2. 交互式需求讨论（Phase 0.2，可跳过）
   - 自动识别需求中的模糊点、缺失项
   - 逐个澄清，支持方案探索
   - 讨论结果持久化为独立 JSON
   - 使用 `--no-discuss` 跳过

3. 生成技术设计文档（`.claude/tech-design/{name}.md`）
   - 需求分析和范围边界
   - 架构设计和模块划分
   - **Hard Stop**：展示方案，等待用户确认

4. Intent Review（意图审查）
   - 审查技术设计是否对齐用户需求
   - 增量变更时自动生成 intent 文档
   - 确认后进入任务生成

5. 创建任务清单（`~/.claude/workflows/{id}/tasks-{name}.md`）
   - 分阶段任务拆分
   - 标记质量关卡任务（`quality_gate: true`）
   - **Hard Stop**：展示任务清单，等待用户确认

#### 执行阶段（/workflow execute）

```
1. 读取工作流状态，找到当前待执行任务
2. 根据执行模式决定执行范围
   ├─ step → 执行单个任务
   ├─ phase → 执行当前阶段所有任务（默认）
   └─ quality_gate → 执行到下一个质量关卡暂停
3. 根据任务阶段执行相应操作
   ├─ design → 接口设计、架构设计
   ├─ infra → Store、工具函数
   ├─ ui → 组件实现
   ├─ test → 测试编写
   └─ verify → 验证和交付
4. 遇到 quality_gate 任务 → 调用 codeagent-wrapper 审查
5. 更新任务状态，提示继续或完成
```

**自然语言控制**：执行时可描述意图，自动切换模式

| 用户说 | 系统理解 |
|--------|----------|
| "单步执行" | step 模式，只执行一个任务 |
| "继续" / "下一阶段" | phase 模式（默认） |
| "执行到质量关卡" | quality_gate 模式 |
| "重试" / "跳过" | retry / skip 模式 |

### 3.3 任务状态文件

**路径**：`~/.claude/workflows/{project-hash}/workflow-state.json`

```json
{
  "name": "多租户权限管理",
  "status": "running",
  "current_task": "T-003",
  "current_phase": "design",
  "execution_mode": "phase",
  "consecutive_count": 2,

  "tasks": {
    "T-003": {
      "name": "设计权限接口",
      "phase": "design",
      "status": "in_progress",
      "quality_gate": false
    },
    "T-008": {
      "name": "两阶段代码审查",
      "phase": "verify",
      "status": "pending",
      "quality_gate": true
    }
  },

  "task_runtime": {
    "T-003": {
      "retry_count": 0,
      "debug_history": []
    }
  },

  "quality_gates": {
    "design_review": {
      "task_id": "T-005",
      "passed": true,
      "stage1_passed": true,
      "stage2_passed": true
    }
  },

  "discussion": {
    "artifact_path": "discussion-artifact.json",
    "skipped": false
  },

  "completed": ["T-001", "T-002"],
  "failed": [],
  "skipped": []
}
```

**状态机**：

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态 |
| `planned` | 规划完成，等待执行 |
| `intent_review` | Intent 文档已生成，等待审查 |
| `running` | 执行中 |
| `blocked` | 等待外部依赖（如 API spec） |
| `failed` | 任务失败 |
| `completed` | 全部完成 |

### 3.4 执行阶段

工作流任务按阶段组织，每个阶段聚焦特定类型的工作：

| 阶段 | 说明 | 任务类型 |
|------|------|----------|
| `design` | 接口设计、架构设计 | 类型定义、API 契约 |
| `infra` | 基础设施搭建 | Store、工具函数、守卫 |
| `ui-layout` | 页面布局 | 路由、菜单、页面骨架 |
| `ui-display` | 展示组件 | 卡片、表格、列表 |
| `ui-form` | 表单组件 | 弹窗、输入、选择器 |
| `ui-integrate` | 组件集成 | 注册、组装、连接 |
| `test` | 测试编写 | 单元测试、集成测试 |
| `verify` | 验证 | 运行测试、代码审查 |
| `deliver` | 交付 | 文档、提交 |

### 3.5 质量关卡机制

任务清单中标记了 `quality_gate: true` 的任务会触发质量关卡。从 v3.4.0 起，质量关卡升级为**两阶段代码审查**：

| 阶段 | 审查重点 | 执行者 |
|------|---------|--------|
| **Stage 1：规格合规** | 任务是否符合技术方案规格 | 当前模型 |
| **Stage 2：代码质量** | 代码可读性、可维护性、安全性 | Codex subagent |

**问题分级**：Critical（阻断）、Important（必修）、Minor（建议），共享 4 次总审查预算。

#### Codex 方案审查（设计阶段）

```bash
# 通过 codeagent-wrapper 调用 Codex 审查技术方案
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/reviewer.md
<TASK>
审查技术方案文档：.claude/tech-design/xxx.md

重点关注：
1. 需求拆解是否完整
2. 架构设计是否合理
3. 实施计划是否可行
4. 风险评估是否充分
5. 验收标准是否明确

请提供综合评分（0-100分）
</TASK>
OUTPUT: JSON { "score": number, "issues": string[] }
EOF

# 评分 < 80 → 自动阻止进入开发阶段
# 评分 ≥ 80 → 通过，继续执行
```

#### Codex 代码审查（验证阶段 - 两阶段审查）

```bash
# Stage 1：规格合规审查（当前模型执行）
# 检查代码实现是否符合技术方案规格
# 验证可复用组件是否正确使用
# 检查接口契约一致性

# Stage 2：代码质量审查（Codex subagent 执行）
codeagent-wrapper --backend codex resume <session_id> - <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/reviewer.md
<TASK>
审查代码实现

技术方案：.claude/tech-design/xxx.md
修改的文件：<file_list>

重点关注：
1. 代码可读性和可维护性
2. 错误处理是否完善
3. 安全漏洞和性能问题
4. 代码风格一致性

问题分级：Critical / Important / Minor
</TASK>
OUTPUT: JSON { "issues": [{ "severity": string, "description": string }] }
EOF

# 存在 Critical 问题 → 阻断交付
# 仅 Minor 问题 → 通过，可交付
# 共享 4 次总审查预算（Stage 1 + Stage 2 合计）
```

### 3.6 任务保护机制

**问题**：如果重新执行 `/workflow start` 会不会覆盖之前的任务进度？

**答案**：不会！系统内置了自动保护机制。

#### 自动检测和备份

启动新任务时，系统会自动检测并保护现有任务：

```typescript
const stateDir = `~/.claude/workflows/${projectId}`;
const statePath = `${stateDir}/workflow-state.json`;

// Step 0：检测现有任务（自动执行）
if (fileExists(statePath)) {
  const existingState = readFile(statePath);

  if (existingState.status !== 'completed') {
    // 1. 自动备份到带时间戳的文件
    const backupPath = `${stateDir}/workflow-state-backup-${Date.now()}.json`;
    backup(existingState, backupPath);

    // 2. 询问用户如何处理
    const choice = askUser({
      question: "检测到未完成的任务，如何处理？",
      options: [
        "继续执行旧任务",
        "开始新任务（备份旧任务）",
        "取消操作"
      ]
    });
  }
}
```

#### 保护策略

| 现有任务状态 | 系统行为 | 备份位置 |
|-------------|---------|----------|
| **运行中** (`running`/`blocked`) | 询问用户确认 | `~/.claude/workflows/{id}/workflow-state-backup-{ts}.json` |
| **已完成** (`completed`) | 自动归档 | 通过 `/workflow archive` 归档 |
| **不存在** | 直接创建 | - |

#### 恢复备份

```bash
# 1. 查看项目工作流目录
ls -lh ~/.claude/workflows/

# 2. 查看特定项目的备份
ls -lh ~/.claude/workflows/{projectId}/workflow-state-*.json

# 3. 恢复特定备份
cp ~/.claude/workflows/{projectId}/workflow-state-backup-xxx.json \
   ~/.claude/workflows/{projectId}/workflow-state.json

# 4. 继续执行
/workflow execute
```

### 3.7 使用示例

#### 示例1：功能开发（连续执行）

```bash
# 对话1
/workflow start "添加导出PDF按钮"
# ✅ 生成 tech-design.md 和 tasks.md

/workflow execute  # 执行设计阶段任务
/workflow execute  # 执行实现阶段任务
/workflow execute  # 执行测试阶段任务
# 🎉 完成！
```

#### 示例2：复杂任务（新对话分批执行）

```bash
# ========== 对话1：需求分析 + 方案设计 ==========
/workflow start "实现多租户权限管理系统"
# ✅ 分析需求，生成技术方案

/workflow execute  # 执行到设计完成
# Codex 审查通过 ✅

# ========== 对话2（新窗口）：开发实施 ==========
/workflow execute  # 自动从上次位置继续
# 执行开发任务...

# ========== 对话3（新窗口）：验证交付 ==========
/workflow execute  # 执行测试和验证
# 🎉 完成！
```

### 3.8 辅助命令

```bash
# 查看当前状态和进度
/workflow status

# 重试当前步骤（质量关卡失败后）
/workflow execute --retry

# 跳过当前步骤（慎用）
/workflow execute --skip

# 增量变更（替代原 unblock）
/workflow delta                     # 无参数：执行 pnpm ytt 同步全部 API
/workflow delta docs/prd-update.md  # PRD 更新
/workflow delta src/api/UserApi.ts  # API 规格变更，自动解除 api_spec 阻塞
/workflow delta "新增导出权限需求"    # 需求描述

# 归档已完成的工作流
/workflow archive
```

### 3.9 核心优势

| 对比项 | 智能工作流 | 传统手动流程 |
|-------|-----------|--------------|
| **命令入口** | 1 个统一 Skill | 多个分散命令 |
| **步骤规划** | ✅ 自动生成 | ❌ 需手动规划 |
| **进度记忆** | ✅ 自动持久化 | ❌ 需手动跟踪 |
| **新对话恢复** | ✅ 无缝恢复 | ❌ 需重新开始 |
| **质量保障** | ✅ 两阶段代码审查 | ❌ 手动审查 |
| **上下文管理** | ✅ 渐进加载 | ❌ 全量加载 |

### 3.10 需求讨论阶段（Phase 0.2）

> v3.4.0 新增

在代码分析（Phase 0）之后、需求结构化提取（Phase 0.5）之前，新增交互式需求讨论阶段。

**核心能力**：

| 能力 | 说明 |
|------|------|
| **Gap 识别** | 基于代码分析结果，自动检测需求中的模糊点、缺失项和隐含假设 |
| **逐个澄清** | 每次只问一个问题，优先选择题，支持跳过和结束 |
| **方案探索** | 存在互斥实现路径时，提出 2-3 种方案供对比选择 |
| **结构化工件** | 讨论结果持久化为独立 JSON（`discussion-artifact.json`），不修改原始需求 |

**使用方式**：

```bash
# 默认启用需求讨论
/workflow start docs/prd.md

# 跳过需求讨论（短需求或明确需求）
/workflow start --no-discuss "添加导出按钮"
```

**自动跳过条件**：
- 使用 `--no-discuss` 标志
- 简短的内联需求（非文件来源）
- 需求内容清晰完整，无模糊点

**讨论工件流向**：

```
Phase 0.2 讨论 → discussion-artifact.json
                       │
                       ├──▶ Phase 0.5 需求提取（参考澄清结果）
                       ├──▶ Phase 1 技术方案（渲染为"需求澄清摘要"章节）
                       └──▶ Phase 2 任务生成（映射未就绪依赖）
```

### 3.11 执行纪律强化

> v3.4.0 新增，借鉴 Superpowers 项目核心机制

**两阶段代码审查**：

质量关卡从单一评分制升级为两阶段审查：

| 阶段 | 审查重点 | 执行者 | 问题分级 |
|------|---------|--------|---------|
| **Stage 1：规格合规** | 实现是否符合技术方案 | 当前模型 | Critical / Important / Minor |
| **Stage 2：代码质量** | 可读性、安全性、性能 | Codex subagent | Critical / Important / Minor |

- 存在 Critical 问题 → 阻断后续执行
- 共享 4 次总审查预算（Stage 1 + Stage 2 合计）

**结构化调试协议**：

任务失败重试前强制执行四阶段调试：

```
根因调查 → 模式分析 → 假设验证 → 实施修复
```

- 连续 3 次重试失败 → 触发 **Hard Stop**，暂停工作流等待人工介入

**TDD 执行纪律**：

- 实现指南（Phase 0.7）存在时，implement 阶段任务强制 **Red-Green-Refactor** 循环
- 先写失败测试 → 最小实现通过 → 重构优化

**Post-Execution Pipeline**：

```
executeTask() → Step 6.5（验证铁律 + Gate Function）
             → Step 6.6（自审查，建议性，永不阻塞）
             → Step 6.7（规格合规检查）
             → Step 7（更新状态）
```

**审查反馈处理协议**：

```
READ → UNDERSTAND → VERIFY → EVALUATE → RESPOND → IMPLEMENT
```

---

## 4. 其他工作流

### 4.1 UI 还原工作流（/figma-ui）

**适用场景**：
- ✅ 有明确的 Figma 设计稿
- ✅ 需要高保真还原设计
- ✅ 注重组件复用和代码质量

**关键特性**：
- 🎨 自动提取 Figma 设计规范
- 🤖 轻量 3 阶段：设计获取 → 自由编码 → 验证修复
- 📐 智能识别可复用组件
- ✅ **Gemini 审查**：visualFidelity ≥ 90 才能交付

**使用方式**：
```bash
# 直接使用 Figma URL
/figma-ui "https://figma.com/design/xxx?node-id=123:456"

# 或在对话中提及 Figma 相关关键词
# 系统会自动检测并调用 figma-ui skill
```

**触发条件**（自动检测）：
- 检测到 `figma.com/design` URL
- 提及关键词：还原、切图、设计稿、UI实现、前端开发、Figma

**还原度门控**：

| visualFidelity | 判定 |
|----------------|------|
| ≥ 90 | 通过，可交付 |
| ≥ 80 | 需人工审查 |
| < 80 | 请求指导 |

**重要原则**：
- ✅ **Gemini 审查必须执行**：Phase C 的 Gemini 视觉审查不可跳过
- ✅ **还原度 ≥ 90**：低于 90 分需修复视觉问题后重新验证
- ✅ 编码阶段给予最大自由度，验证阶段严格把关
- ❌ 严禁直接调用 Figma MCP 工具，必须通过 figma-ui skill

---

### 4.2 视觉差异验证（/visual-diff）

**适用场景**：
- ✅ 需要验证 UI 还原度（figma-ui 完成后衔接）
- ✅ 需要像素级对比设计稿与实现页面
- ✅ 需要双模型语义验证（Gemini + Claude）

**关键特性**：
- 📐 像素级差异分析（overlay、diff highlight、并排对比）
- 🤖 **Gemini + Claude 双模型语义验证**
- 📊 结构化报告（差异百分比、评分、问题列表）
- 🔗 与 figma-ui 自动衔接

**使用方式**：
```bash
# 独立调用
/visual-diff http://localhost:3000/page --design ./design.png

# 指定元素选择器
/visual-diff http://localhost:3000/page --selector ".dialog-container"

# 自定义差异阈值
/visual-diff http://localhost:3000/page --threshold 20
```

**判定标准**：

| 条件 | 结果 | 置信度 |
|------|------|--------|
| 像素 PASS + 双模型 ≥80 | ✅ PASS | HIGH |
| 像素 PASS/REVIEW + 任一模型 ≥70 | ⚠️ REVIEW | MEDIUM |
| 其他 | ❌ FAIL | LOW |

---

### 4.3 PRD 文档工作流

**适用场景**：
- ✅ 有明确的 PRD 产品需求文档
- ✅ 需要完整的需求分析和方案设计

**使用方式**：
```bash
# 检测到 .md 文件自动进入文档模式
/workflow start docs/user-management-prd.md

# 生成技术设计文档后暂停审查
# 确认后继续执行
/workflow execute
```

**特点**：
- 自动解析 PRD 文档提取需求
- 生成技术设计文档后暂停等待用户审查
- 与 Codex 协作确保方案设计准确性

---

## 5. 智能分析命令

### 5.1 双模型分析：`/analyze`

`/analyze` 使用 **Codex + Gemini 双模型并行分析**，交叉验证后综合见解。

**使用方式**：
```bash
/analyze "描述你想分析的内容"
```

**执行流程**：
1. Codex 并行分析（后端视角：架构、性能、安全）
2. Gemini 并行分析（前端视角：UI/UX、可访问性）
3. 当前模型交叉验证，综合两方见解

**适用场景**：
- 架构设计评审
- 技术方案可行性分析
- 代码质量深度分析
- 性能瓶颈诊断

---

## 6. 审查命令

### 6.1 Diff 审查：`/diff-review`

基于 git diff 的代码审查，**默认使用多模型并行审查**。

**使用方式**：

| 参数 | 来源 | 示例 |
|------|------|------|
| (默认) | 未暂存变更 | `/diff-review` |
| `--staged` | 已暂存变更 | `/diff-review --staged` |
| `--all` | 全部未提交 | `/diff-review --all` |
| `--branch <base>` | 对比分支 | `/diff-review --branch main` |
| `--quick` | 单模型快速审查 | `/diff-review --quick` |

**审查分工**（多模型模式）：

| 模型 | 审查重点 |
|------|----------|
| **Codex** | 后端逻辑、安全漏洞、性能问题、并发安全 |
| **Gemini** | 前端组件设计、可访问性、响应式设计、样式一致性 |
| **Claude** | 综合两方反馈，生成最终报告 |

**输出格式**：结构化 Markdown（Summary + Findings），包含：
- 优先级（P0-P3）
- 置信度（0.00-1.00）
- 行范围
- 修复建议

**优先级定义**：

| 级别 | 含义 | 标准 |
|------|------|------|
| P0 | 紧急阻塞 | 阻塞发布/运营，不依赖任何输入假设的普遍问题 |
| P1 | 紧急 | 应在下个周期处理 |
| P2 | 正常 | 最终需要修复 |
| P3 | 低优先级 | 有则更好 |

---

## 7. 调试命令

### 7.1 调试与修复：`/debug`

Bug 修复全流程：问题定位 → 影响分析 → 确认方案 → 修复 → 模型审查。修复完成后根据问题类型路由到 Codex（后端）或 Gemini（前端）进行单模型审查。

**使用方式**：
```bash
/debug "问题描述"
/debug "p328_600"  # 支持蓝鲸工单号
```

**执行流程**：
1. 检索上下文 + 问题分析（识别前端/后端/全栈）
2. 影响分析 + 确认方案（Hard Stop）
3. 修复实施 + 验证
4. 模型审查（Codex 或 Gemini 二选一）

**问题类型路由**：

| 关键词 | 类型 | 审查模型 |
|--------|------|----------|
| 白屏、渲染、样式、组件、状态 | 前端 | Gemini |
| API、数据库、500、超时、权限 | 后端 | Codex |
| 混合特征 | 全栈 | Codex（优先后端视角） |

**适用场景**：
- 复杂 Bug 定位
- 跨前后端问题排查
- 性能问题诊断
- 蓝鲸工单处理（自动获取工单详情）

---

## 8. 批量缺陷修复

### 8.1 批量修复：`/bug-batch`

从蓝鲸项目管理平台拉取缺陷清单，按优先级逐个修复。每个缺陷在独立 agent 上下文中使用 debug 流程修复。

**前置条件**：
- 已执行 `/scan` 并关联蓝鲸项目（`project.bkProjectId` 已配置）
- BK-MCP 已安装配置

**使用方式**：
```bash
/bug-batch <operator_user>
/bug-batch fanjj
/bug-batch fanjj --state 待处理 --priority HIGH
```

**参数**：
- `operator_user`（必填）：经办人用户名
- `--state`：缺陷状态筛选，默认 "待处理"
- `--priority`：优先级筛选（HIGH/中/低），默认全部

**执行流程**：

```
Phase 0: 读取项目配置（project.bkProjectId）
Phase 1: 拉取缺陷清单（list_issues）
Phase 2: 获取详情 + 构建任务列表（Hard Stop）
Phase 3: 逐个独立修复（debug 流程）
Phase 4: 汇总报告
```

**关键原则**：
1. **配置驱动** — 项目 ID 从 config 读取，不硬编码
2. **独立上下文** — 每个缺陷在独立 agent 中修复，避免上下文污染
3. **顺序执行** — 按优先级逐个处理，非并行（避免文件冲突）
4. **用户确认** — 任务列表展示后必须获得确认才开始修复
5. **失败容错** — 单个缺陷修复失败不阻塞后续任务

---

## 9. 典型场景实战

### 9.1 场景A：复杂功能开发（智能工作流）

**任务**：实现多租户权限管理系统

```bash
# 对话1：启动并开始执行
/workflow start "实现多租户权限管理系统，支持租户隔离和RBAC"
# ✅ 生成技术设计和任务清单

/workflow execute  # 执行各步骤
# Codex 审查通过 ✅

# 对话2（新窗口）：继续开发
/workflow execute  # 自动从上次位置继续

# 对话3（新窗口）：验证交付
/workflow execute  # 完成剩余步骤
# 🎉 完成！
```

### 9.2 场景B：UI 还原（figma-ui skill）

**任务**：还原 Figma 用户设置页面

```bash
/figma-ui "https://www.figma.com/design/xxxxx?node-id=123:456"
# ✅ 自动获取设计规范
# ✅ 自由编码实现
# ✅ Gemini 视觉审查（visualFidelity ≥ 90）
```

### 9.3 场景C：Bug 调试（debug 命令）

**任务**：修复用户头像上传失败问题

```bash
# 带工作项编号（自动获取缺陷信息）
/debug "p328_600"
# ✅ 自动获取蓝鲸工作项详情
# ✅ 问题分析 + 影响评估
# ✅ 确认方案（Hard Stop）
# ✅ 修复实施 + 模型审查（Codex 或 Gemini）

# 无工作项编号
/debug "用户头像上传失败，返回 413 错误"
```

### 9.4 场景D：代码审查

```bash
# 多模型并行审查（默认）
/diff-review --branch main

# 单模型快速审查
/diff-review --quick --staged
```

### 9.5 场景E：批量缺陷修复

**任务**：处理当前经办人的所有待处理缺陷

```bash
/bug-batch fanjj
# ✅ 自动拉取缺陷清单
# ✅ 展示任务列表等待确认
# ✅ 逐个独立修复（debug 流程）
# ✅ 输出汇总报告
```

### 9.6 场景F：视觉差异验证

**任务**：验证 UI 还原度

```bash
# figma-ui 完成后衔接
/visual-diff http://localhost:3000/user-settings --design ./design.png
# ✅ 像素级差异分析
# ✅ Gemini + Claude 双模型语义验证
# ✅ 输出差异图片 + 综合报告
```

### 9.7 场景G：查看进度并继续

```bash
# 在新对话中
/workflow status
# 显示：当前任务、总进度、下一步建议

/workflow execute  # 继续执行
```

---

## 10. 最佳实践

### 10.1 工作流选择

```
Bug 调试？
  └─ 单个 → /debug（支持 BK-MCP 集成）
  └─ 批量 → /bug-batch（逐个独立修复）

有 Figma 设计稿？
  └─ 是 → /figma-ui（Gemini 审查）
  └─ 验证还原度 → /visual-diff（像素级 + 双模型语义）

有 PRD 文档？
  └─ 是 → /workflow start docs/prd.md

功能开发？
  └─ /workflow start（自动规划执行计划）
```

**工作流选择表**：

| 任务类型 | 推荐工作流 |
|---------|-----------|
| 新功能开发 | `/workflow start` ⭐⭐⭐ |
| Bug 调试 | `/debug` ⭐ |
| 批量缺陷修复 | `/bug-batch` ⭐ |
| UI 还原 | `/figma-ui` |
| 还原度验证 | `/visual-diff` |
| PRD 开发 | `/workflow start docs/prd.md` |
| 代码审查 | `/diff-review` |
| 技术分析 | `/analyze` |

### 10.2 新对话执行模式

**推荐做法**：关键阶段在新对话中执行

```bash
# 对话1：分析 + 方案
/workflow start "需求"
/workflow execute × N  # 执行到方案审查完成

# 对话2：开发实施
/workflow execute × N  # 编码 + 测试

# 对话3：验证交付
/workflow execute × N  # 代码审查 + 文档
```

**优势**：
- ✅ 每个对话上下文独立
- ✅ 审查上下文充足
- ✅ 可随时暂停和恢复

### 10.3 质量保证

- ✅ 依赖质量关卡：Codex 审查
- ✅ 及时重试：审查不通过时 `/workflow execute --retry`
- ✅ 记录决策：所有决策自动记录到任务记忆
- ✅ 文档完整：技术方案、验证报告自动生成

---

## 11. 常见问题

### 11.1 如何选择工作流？

**A**: 优先使用智能工作流 `/workflow start`
- 自动规划执行计划
- 适用大多数场景
- Bug 调试用 `/debug`，批量缺陷用 `/bug-batch`
- UI 还原用 `/figma-ui`，验证还原度用 `/visual-diff`

### 11.2 任务记忆文件在哪？

**A**: `~/.claude/workflows/{project-hash}/workflow-state.json`
- 记录所有步骤状态和进度
- 支持新对话恢复
- 包含审查结果和决策记录

### 11.3 质量关卡失败怎么办？

**A**:
1. 查看审查意见
2. 根据建议优化内容
3. 执行 `/workflow execute --retry` 重新审查

### 11.4 如何在新对话中恢复？

**A**:
```bash
# 在新对话中直接执行
/workflow execute
# ✅ 自动读取任务记忆，继续下一步
```

### 11.5 可以跳过某个步骤吗？

**A**:
- 可以使用 `/workflow execute --skip`（慎用）
- 会记录跳过理由到任务记忆

### 11.6 如何处理外部依赖变更？

**A**:
```bash
# 无参数：同步全部 API（执行 pnpm ytt）
/workflow delta

# PRD 更新
/workflow delta docs/prd-update.md

# API 规格变更（自动解除 api_spec 阻塞）
/workflow delta src/api/UserApi.ts

# 需求描述
/workflow delta "新增导出权限需求"
```

---

## 附录 A：命令速查表

| 命令 | 简介 | 优先级 |
|------|------|-------|
| **智能工作流（Skill）** |||
| `/workflow start "需求"` | 启动智能工作流 | ⭐⭐⭐ |
| `/workflow execute` | 执行下一步 | ⭐⭐⭐ |
| `/workflow status` | 查看当前状态和进度 | ⭐⭐ |
| `/workflow delta` | 增量变更（需求更新、API 同步） | ⭐ |
| `/workflow execute --retry` | 重试失败步骤 | ⭐ |
| `/workflow execute --skip` | 跳过当前步骤（慎用） | |
| `/workflow archive` | 归档已完成工作流 | |
| **其他 Skills** |||
| `/figma-ui "Figma URL"` | UI 还原（Gemini 审查） | ⭐ |
| `/visual-diff "URL"` | 视觉差异验证（像素级 + 双模型） | ⭐ |
| `/analyze "描述"` | 双模型技术分析 | ⭐⭐ |
| `/debug "问题"` | Bug 修复流程 + 模型审查 | ⭐⭐ |
| `/bug-batch <user>` | 批量缺陷修复（蓝鲸集成） | ⭐ |
| `/diff-review` | 多模型代码审查 | ⭐ |
| `/diff-review --quick` | 单模型快速审查 | ⭐ |
| `/scan` | 智能项目扫描 + 蓝鲸关联 | ⭐ |
| `/write-tests` | 测试编写专家 | ⭐ |
| **CLI 工具** |||
| `claude-workflow status` | 查看安装状态和 Agent 状态 | ⭐ |
| `claude-workflow sync` | 同步模板到多个 Agent | ⭐ |
| `claude-workflow sync -c` | 清理安装（删除旧文件后重新安装） | |
| `claude-workflow sync -f` | 强制覆盖所有文件 | |
| `claude-workflow sync -a` | 指定目标 Agent | |
| `claude-workflow init` | 初始化项目配置 | ⭐ |
| `claude-workflow doctor` | 诊断配置问题 | |
| **其他命令** |||
| `/enhance "prompt"` | Prompt 增强 | |
| `/git-rollback` | 交互式 Git 回滚 | |
| `/skill-creator` | Skill 创建指南 | |
| `/agents` | 查看所有可用命令 | |

---

## 附录 B：Prompt 模板

项目使用双模型协作，Prompt 模板位于 `~/.agents/claude-workflow/prompts/`：

| 目录 | 专长 | 使用场景 |
|------|------|----------|
| **codex/** | 后端架构、算法、调试、安全 | API 设计、数据库、性能优化、代码审查 |
| **gemini/** | 前端 UI、CSS、组件、可访问性 | React/Vue 组件、样式、响应式设计 |

**角色提示词**：

| 角色 | Codex | Gemini |
|------|-------|--------|
| 分析 | `codex/analyzer.md` | `gemini/analyzer.md` |
| 架构/前端 | `codex/architect.md` | `gemini/frontend.md` |
| 审查 | `codex/reviewer.md` | `gemini/reviewer.md` |
| 调试 | `codex/debugger.md` | `gemini/debugger.md` |
| 测试 | `codex/tester.md` | `gemini/tester.md` |
| 优化 | `codex/optimizer.md` | `gemini/optimizer.md` |

**使用方式**：通过 `codeagent-wrapper` 的 `ROLE_FILE` 指令在 HEREDOC 中显式指定角色：

```bash
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.agents/claude-workflow/prompts/codex/reviewer.md
<TASK>审查任务</TASK>
EOF
```

---

## 附录 C：快速入门

### 安装

```bash
npm install -g @pic/claude-workflow --registry http://your-registry-host:4873
```

### 新手推荐流程

```bash
# 1. 交互式安装（首次推荐）
claude-workflow sync

# 2. 扫描项目
/scan

# 3. 启动智能工作流
/workflow start "你的功能需求描述"

# 4. 重复执行（直到完成）
/workflow execute
/workflow execute
# ...

# 5. 随时查看状态
/workflow status
```

### 常用 CLI 命令

```bash
# 查看安装状态
claude-workflow status

# 同步到所有检测到的 Agent
claude-workflow sync -y

# 清理安装（移除已删除的 skill）
claude-workflow sync -c -y

# 安装到指定 Agent
claude-workflow sync -a claude-code,cursor -y

# 诊断问题
claude-workflow doctor
```

### 常用命令

```bash
# 功能开发
/workflow start "需求描述"
/workflow execute

# 增量变更
/workflow delta                # 同步 API
/workflow delta docs/prd.md    # PRD 更新

# UI 还原
/figma-ui "Figma URL"

# 视觉验证
/visual-diff http://localhost:3000/page --design ./design.png

# Bug 调试
/debug "问题描述"

# 批量缺陷修复
/bug-batch <经办人>

# 代码审查
/diff-review --branch main

# 技术分析
/analyze "分析内容"
```

### 进阶使用

- 关键阶段在新对话中执行
- 使用 `/workflow status` 了解进度
- 质量关卡失败时使用 `/workflow execute --retry`
- 使用 `claude-workflow doctor` 诊断配置问题
- 使用 `claude-workflow sync -c` 清理安装（移除已删除的 skill）

### 从旧版本迁移

如果你之前使用的是旧版（直接复制到 `~/.claude/`），运行以下命令迁移到新架构：

```bash
claude-workflow sync
```

迁移会：
1. 备份现有文件
2. 复制到 canonical 位置
3. 创建 symlink 替换原有目录
4. 保持向后兼容

---

**文档结束**

如有疑问，请参考：
- 安装状态：`claude-workflow status`
- 诊断问题：`claude-workflow doctor`
- 命令索引：`/agents`
- 项目规范：`CLAUDE.md`
