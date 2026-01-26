# Claude Code 工作流体系指南

> 基于 Claude Code 的智能化开发工作流体系

**文档版本**：v4.0.0
**最后更新**：2026-01-24
**包版本**：@pic/claude-workflow v1.2.11

---

## 📖 目录

- [1. 概述](#1-概述)
- [2. 工作流安装与配置](#2-工作流安装与配置)
- [3. 智能工作流](#3-智能工作流)
- [4. 其他工作流](#4-其他工作流)
  - [4.1 UI 还原工作流](#41-ui-还原工作流figma-ui)
  - [4.2 后端工作流](#42-后端工作流workflow-start---backend)
- [5. 智能分析命令](#5-智能分析命令)
- [6. 审查命令](#6-审查命令)
- [7. 调试命令](#7-调试命令)
- [8. 典型场景实战](#8-典型场景实战)
- [9. 最佳实践](#9-最佳实践)
- [10. 常见问题](#10-常见问题)
- [附录 A：命令速查表](#附录-a命令速查表)
- [附录 B：Agent 定义](#附录-bagent-定义)
- [附录 C：快速入门](#附录-c快速入门)

---

## 1. 概述

### 1.1 什么是工作流体系

Claude Code 工作流体系是一套基于 AI 和斜杠命令的智能化开发流程，涵盖从需求分析到质量验证的完整开发生命周期。

**核心价值**：
- ✅ **npm 包安装**：`npm install -g @pic/claude-workflow` 一行命令完成安装
- ✅ **智能升级**：自动备份、3-way merge、保留用户修改
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
│         @pic/claude-workflow (v1.2.11)                       │
│          npm 包工作流工具集 - 一次安装，所有项目通用            │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  npm 包管理      │  │ 用户级存储架构   │  │ CLI 工具         │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • npm install   │  │ • ~/.claude/    │  │ • status 状态    │
│ • npm update    │  │ • 多项目隔离     │  │ • sync 同步      │
│ • postinstall   │  │ • 避免Git冲突    │  │ • init 初始化    │
│ • 3-way merge   │  │ • 自动备份       │  │ • doctor 诊断    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ 智能规划引擎     │  │  任务记忆管理    │  │  质量关卡系统   │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • 复杂度分析     │  │ • 进度持久化     │  │ • Codex 方案审查 │
│ • 步骤自动生成   │  │ • 新对话恢复     │  │ • Codex 代码审查 │
│ • 5-22步规划    │  │ • 决策记录       │  │ • 评分门槛控制   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│核心工作流       │  │ CLI 工具         │  │  分析审查       │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • workflow-start│  │ • status 状态   │  │ • /analyze      │
│ • workflow-exec │  │ • sync 同步     │  │ • /diff-review  │
│ • figma-ui      │  │ • init 初始化   │  │ • /write-tests  │
│ • backend-start │  │ • doctor 诊断   │  │ • /debug        │
│ • status/retry  │  │                 │  │                 │
│ • skip/unblock  │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Prompt 模板    │  │  MCP 双模型协作  │  │  文档输出       │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • codex/        │  │ • Gemini (前端) │  │ • 任务记忆       │
│ • gemini/       │  │ • Codex (后端)  │  │ • 技术方案      │
│ • claude/       │  │ • Figma MCP     │  │ • 验证报告      │
│                 │  │ • BK-MCP        │  │ • 工作流总结     │
│                 │  │ • Context7      │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 1.3 命令总览

项目核心命令：

| 类别 | 核心命令 | 说明 |
|------|---------|------|
| **智能工作流** ⭐⭐⭐ | `/workflow-start`, `/workflow-execute` | 自动规划和执行（推荐） |
| **后端工作流** | `/workflow-start --backend` | PRD → 需求分析 → 方案设计 → 执行 |
| **UI 还原** | `/figma-ui` | Figma 设计稿 → 前端代码（Skill） |
| **工作流辅助** | `/workflow-status`, `/workflow-retry-step`, `/workflow-skip-step`, `/workflow-unblock` | 状态查看、重试、跳过、解除阻塞 |
| **CLI 工具** | `claude-workflow status/sync/init/doctor` | 状态查看、同步、初始化、诊断 |
| **智能分析** | `/analyze` | 双模型技术分析（Codex + Gemini 并行） |
| **代码审查** | `/diff-review`, `/diff-review --quick` | 多模型并行审查 / 单模型快速审查 |
| **调试** | `/debug` | 多模型调试（Codex 后端 + Gemini 前端） |
| **测试** | `/write-tests` | Vitest 测试专家编写测试 |
| **项目配置** | `/scan` | 智能项目扫描（检测技术栈 + 生成上下文报告） |
| **其他工具** | `/enhance`, `/git-rollback` | Prompt 增强、Git 回滚 |
| **帮助** | `/agents` | 查看所有可用 Agent 命令 |

---

## 2. 工作流安装与配置

### 2.1 npm 包安装（推荐）

`@pic/claude-workflow` 是一个 npm 包，提供标准化的工作流命令、Agent 定义和文档。

#### 全局安装

```bash
# 全局安装（推荐）
npm install -g @pic/claude-workflow --registry http://your-registry-host:4873

# 或作为开发依赖
npm install -D @pic/claude-workflow --registry http://your-registry-host:4873
```

**安装过程会自动：**
1. ✅ 将工作流文件复制到 `~/.claude/` 目录
2. ✅ 检测版本变化，智能合并用户修改
3. ✅ 冲突文件写入 `.new` 后缀，需手动合并

#### 升级

```bash
npm update -g @pic/claude-workflow --registry http://your-registry-host:4873
```

**升级时会自动**：
1. 备份当前配置到 `~/.claude/.claude-workflow/backups/`
2. 智能合并文件（3-way merge，保留用户修改）
3. 冲突文件写入 `.new` 后缀，需手动合并

### 2.2 CLI 命令

安装后可使用 `claude-workflow` 命令行工具：

```bash
# 查看安装状态
claude-workflow status

# 同步/更新模板
claude-workflow sync

# 强制覆盖所有文件
claude-workflow sync --force

# 初始化项目配置
claude-workflow init

# 诊断问题
claude-workflow doctor
```

#### 命令说明

| 命令 | 说明 |
|------|------|
| `status` | 显示已安装版本、模板文件数量、最后同步时间 |
| `sync` | 同步模板到 `~/.claude/`，智能合并用户修改 |
| `sync -f/--force` | 强制覆盖所有文件（慎用） |
| `init` | 在当前项目创建 `.claude/config/project-config.json` |
| `doctor` | 诊断配置问题，检测缺失文件和依赖 |

### 2.3 目录结构

安装完成后的目录结构：

```
~/.claude/
├── commands/              # 15 个斜杠命令
├── prompts/               # 双模型协作 Prompt 模板
│   ├── codex/             # Codex 角色提示词
│   └── gemini/            # Gemini 角色提示词
├── skills/                # Skill 定义（如 figma-ui）
├── docs/                  # 技术文档模板
├── utils/                 # 工具函数
├── workflows/             # 工作流状态（按项目隔离，使用后自动创建）
├── logs/                  # 操作日志（使用后自动创建）
└── .claude-workflow/      # 包元信息
    ├── meta.json          # 版本信息
    ├── originals/         # 原始模板（用于升级比对）
    └── backups/           # 升级备份
```

### 2.4 环境变量

- `CLAUDE_WORKFLOW_SKIP_POSTINSTALL=1` - 跳过 postinstall 自动复制

### 2.5 依赖检测

工具包会自动检测以下依赖：

| 级别 | 依赖 | 用途 | 缺失时处理 |
|------|------|------|-----------|
| **必需** | Node.js >= 18 | 运行环境 | ❌ 安装失败 |
| **推荐** | Claude Code | AI 辅助编程工具 | ⚠️ 显示警告 |
| **推荐** | Git | 版本控制 | ⚠️ 显示警告 |
| **可选** | Codex MCP | 代码分析和生成 | ℹ️ 提示功能受限 |
| **可选** | Gemini MCP | 前端设计原型 | ℹ️ 提示功能受限 |
| **可选** | Figma MCP | 设计稿解析 | ℹ️ 提示功能受限 |
| **可选** | BK-MCP | 蓝鲸工作项集成 | ℹ️ 提示功能受限 |

**工作流自动适配**：
- 缺少 Codex MCP → 跳过 Codex Gate 步骤
- 缺少 Figma MCP → UI 还原需手动提供设计规范
- 缺少 BK-MCP → Bug 修复工作流跳过缺陷信息获取和状态流转

详见：`~/.claude/docs/dependency-check.md`

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
/workflow-fix-bug "p328_600"

# 2. 如果配置成功，系统会自动：
#    - 从蓝鲸获取工单 p328_600 的详情
#    - 流转状态到"处理中"
#    - 完成后自动更新状态到"待验证"

# 3. 如果配置失败，系统会提示并跳过 BK-MCP 相关步骤
```

---

**Codex MCP（代码分析和生成）**：

Codex MCP 是工作流体系的**核心 AI 引擎**，提供：
- ✅ 多轮对话与会话持久化（SESSION_ID）
- ✅ 并行任务执行支持
- ✅ 推理追踪能力（reasoning trace）
- ✅ 企业级错误处理
- ✅ 三种沙箱模式（read-only/workspace-write/full-access）

**安装命令**：
```bash
# 安装 Codex MCP
claude mcp add codex -s user --transport stdio -- uvx --from git+https://github.com/GuDaStudio/codexmcp.git codexmcp

# 验证安装
claude mcp list
# 成功标志：显示 "codex: uvx ... - ✓ Connected"
```

**安装教程**：[GuDaStudio/codexmcp](https://github.com/GuDaStudio/codexmcp)

**快速验证**：
```bash
# 在 Claude Code 中使用 Codex
/codex-analyze "分析当前项目的架构设计"

# 或在智能工作流中自动调用（步骤 8 和 13）
/workflow-start "实现用户认证功能"
```

---

**Gemini MCP（前端设计与需求分析）**：

Gemini MCP 用于调用 Google Gemini 模型，**专精前端设计和需求理解**：
- ✅ **前端原型**：编写 CSS、HTML、React/Vue 组件代码
- ✅ **样式精通**：UI 组件设计、样式调整、响应式布局
- ✅ **需求清晰化**：辅助生成引导性问题，明确用户需求
- ✅ **任务规划**：生成 Step-by-step 的实施计划
- ✅ 多轮对话与会话持久化（SESSION_ID）

**重要限制**：
- ⚠️ **上下文长度仅 32k**：请控制单次输入的代码量
- ⚠️ **后端能力弱**：严禁让 Gemini 编写复杂后端业务逻辑

**安装命令**：
```bash
# 安装 Gemini MCP
claude mcp add gemini -s user --transport stdio -- uvx --from git+https://github.com/GuDaStudio/geminimcp.git geminimcp

# 验证安装
claude mcp list
# 成功标志：显示 "gemini: uvx ... - ✓ Connected"
```

**安装教程**：[GuDaStudio/geminimcp](https://github.com/GuDaStudio/geminimcp)

**使用场景**：
```bash
# 1. 前端组件设计（推荐）
# 当需要实现 UI 组件时，优先让 Gemini 出具原型代码

# 2. 需求分析阶段
# 让 Gemini 帮助生成引导性问题，明确用户需求

# 3. UI 还原工作流
# /workflow-ui-restore 会自动调用 Gemini 生成前端代码
```

---

**多模型协作机制**：

工作流体系支持 **Gemini + Codex 双模型协作**，发挥各自优势：

| 模型 | 擅长领域 | 使用场景 |
|------|---------|---------|
| **Gemini** | 前端代码、UI设计、需求理解 | 组件原型、样式调整、需求分析 |
| **Codex** | 后端逻辑、Bug定位、代码审查 | 业务逻辑、Debug、代码Review |

**协作原则**：
1. 前端任务 → 优先调用 Gemini 获取原型代码
2. 后端任务 → 调用 Codex 获取实现方案
3. 代码完成后 → 必须使用 Codex 进行代码审查
4. 两者仅提供参考，最终代码需人工审核重写

---

**其他 MCP 服务**：

- **Figma MCP** - 设计稿解析：配置后可启用 `/workflow-ui-restore` 自动获取设计稿信息
- **Chrome MCP** - 浏览器自动化：用于 UI 测试、页面交互和自动化截图

详见：[MCP 配置指南](dependency-check.md)

### 2.6 用户级存储架构

**重要变更**：工作流状态从项目目录迁移到用户目录，完全避免 Git 冲突！

#### 目录结构

```
~/.claude/                              # 用户级目录（不提交 Git）
├── commands/                           # 工作流命令（15 个）
├── skills/                             # Skill 定义
├── docs/                               # 技术文档
├── prompts/                            # 双模型协作 Prompt
├── utils/                              # 工具函数
├── workflows/                          # 工作流状态（按项目隔离）
│   ├── a13dcda9d96c/                   # 项目 1（基于 cwd hash）
│   │   ├── workflow-state.json        # 工作流记忆
│   │   ├── context-summary-*.md        # 上下文摘要
│   │   ├── operations-log.md           # 操作日志
│   │   └── .project-meta.json          # 项目元数据
│   └── b2c3d4e5f6a1/                   # 项目 2
└── logs/                               # 操作日志（按项目）
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
/workflow-start "添加用户认证功能"

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
~/.claude/init-project.sh
```

详见：`~/.claude/AUTO-INIT-FEATURE.md`

### 2.8 项目配置文件

**最小配置**（`.claude/config/project-config.json`）：

```json
{
  "project": {
    "name": "my-project",
    "type": "single",
    "rootDir": "."
  },
  "tech": {
    "packageManager": "npm",
    "framework": "react"
  },
  "workflow": {
    "defaultModel": "sonnet"
  }
}
```

**注意**：项目配置应提交到 Git，供团队共享；工作流状态存储在 `~/.claude/`，不提交 Git。

---

## 3. 智能工作流

### 3.1 核心概念

**智能工作流 = 自动规划 + 自动记忆 + 智能执行**

只需记住 **2个命令**：
```bash
/workflow-start "功能需求"    # 启动：分析需求并生成执行计划
/workflow-execute             # 执行：自动执行下一步（可重复调用）
```

### 3.2 工作原理

#### 启动阶段（/workflow-start）

```
1. 使用 sequential-thinking 分析需求复杂度
   ├─ 简单任务：< 300行，< 1天 → 生成 5 个步骤
   ├─ 中等任务：300-1000行，1-2天 → 生成 13 个步骤
   └─ 复杂任务：> 1000行，> 2天 → 生成 22 个步骤

2. 生成详细的分步执行计划
   ├─ 每个步骤包含：ID、名称、action、预计时间
   ├─ 设置质量关卡（Codex 审查）
   └─ 定义依赖关系和产出物

3. 创建任务记忆文件
   └─ 保存到 .claude/workflow-state.json
```

#### 执行阶段（/workflow-execute）

```
1. 读取任务记忆，找到当前待执行步骤
2. 根据 action 类型执行相应操作
   ├─ context_load → 调用 /context-load
   ├─ codex_review_design → 调用 Codex 审查方案 ⭐
   ├─ code → 提示用户编码
   ├─ codex_review_code → 调用 Codex 审查代码 ⭐
   └─ ...
3. 检查质量关卡（评分 < 80 自动阻止）
4. 更新任务记忆，标记步骤完成
5. 提示继续或完成
```

### 3.3 任务记忆文件

**路径**：`.claude/workflow-state.json`

```json
{
  "task_name": "多租户权限管理",
  "complexity": "complex",
  "current_step_id": 8,
  "total_steps": 22,
  "status": "in_progress",

  "steps": [
    {
      "id": 8,
      "name": "Codex 方案审查",
      "action": "codex_review_design",
      "status": "completed",
      "quality_gate": true,
      "threshold": 80,
      "actual_score": 85
    }
    // ... 更多步骤
  ],

  "quality_gates": {
    "codex_design_review": {
      "step_id": 8,
      "threshold": 80,
      "actual_score": 85,
      "passed": true
    }
  },

  "artifacts": {
    "context_summary": ".claude/context-summary-xxx.md",
    "tech_design": ".claude/tech-design/xxx.md",
    "verification_report": ".claude/verification-report-xxx.md"
  }
}
```

### 3.4 复杂度自动适配

#### 简单任务（5步）

```
1. 快速上下文收集
2. 直接编码实现
3. 编写单元测试
4. 运行验证
5. 代码提交
```

#### 中等任务（13步）

```
1-3.  需求分析（加载上下文、需求拆解、用户确认）
4-6.  技术方案（探索实现、生成方案、Codex审查 ⭐）
7-9.  开发实施（实现功能、编写测试、运行验证）
10-11. 质量验证（Codex代码审查 ⭐、质量验证）
12-13. 文档交付（补充文档、代码提交）
```

#### 复杂任务（22步）

```
1-3.  需求分析（上下文、需求分析、用户确认）
4-9.  技术方案（架构评估、探索代码、专项分析、
                生成方案、Codex审查 ⭐、优化方案）
10-12. 开发实施（实现功能、编写测试、运行测试）
13-17. 质量验证（Codex代码审查 ⭐、架构审查、
                 专项审查、性能验证、生成报告）
18-22. 文档交付（更新方案、API文档、使用文档、
                 代码提交、生成总结）
```

### 3.5 质量关卡机制

#### Codex 方案审查（设计阶段）

```typescript
// 步骤示例：步骤 8
const result = await codex({
  PROMPT: `审查技术方案文档：.claude/tech-design/xxx.md

重点关注：
1. 需求拆解是否完整
2. 架构设计是否合理
3. 实施计划是否可行
4. 风险评估是否充分
5. 验收标准是否明确

请提供综合评分（0-100分）`,
  sandbox: "read-only"
});

// 评分 < 80 → 自动阻止进入开发阶段
// 评分 ≥ 80 → 通过，继续执行
```

#### Codex 代码审查（验证阶段）

```typescript
// 步骤示例：步骤 13
const result = await codex({
  PROMPT: `审查代码实现

技术方案：.claude/tech-design/xxx.md
修改的文件：${files}

重点关注：
1. 代码实现是否符合技术方案
2. 是否正确使用可复用组件
3. 错误处理是否完善
4. 代码质量（可读性、可维护性）

请提供代码质量评分（0-100分）`,
  sandbox: "read-only",
  SESSION_ID: memory.codex_session_id  // 复用会话
});

// 评分 < 80 → 自动阻止交付
// 评分 ≥ 80 → 通过，可交付
```

### 3.6 任务保护机制

**问题**：如果重新执行 `/workflow-start` 会不会覆盖之前的任务进度？

**答案**：不会！系统内置了自动保护机制。

#### 自动检测和备份

启动新任务时，系统会自动检测并保护现有任务：

```typescript
// Step 0：检测现有任务（自动执行）
if (fileExists('.claude/workflow-state.json')) {
  const existingMemory = readFile('.claude/workflow-state.json');

  if (existingMemory.status !== 'completed') {
    // 1. 自动备份到带时间戳的文件
    const backupPath = `.claude/workflow-state-backup-${Date.now()}.json`;
    backup(existingMemory, backupPath);

    // 2. 询问用户如何处理
    const choice = askUser({
      question: "⚠️ 检测到未完成的任务，如何处理？",
      options: [
        "继续执行旧任务",           // 放弃新任务
        "开始新任务（备份旧任务）",  // 创建新任务
        "取消操作"                  // 什么都不做
      ]
    });
  }
}
```

#### 保护策略

| 现有任务状态 | 系统行为 | 备份位置 |
|-------------|---------|----------|
| **未完成** (`in_progress`) | ⚠️ 询问用户确认 | `.claude/workflow-state-backup-{timestamp}.json` |
| **已完成** (`completed`) | ✅ 自动归档 | `.claude/workflow-state-completed-{timestamp}.json` |
| **不存在** | ✅ 直接创建 | - |

#### 恢复备份

```bash
# 1. 查看所有备份
ls -lh .claude/workflow-state-*.json

# 2. 查看备份内容
cat .claude/workflow-state-backup-1737123456789.json | \
  grep -E '"task_name"|"current_step_id"|"total_steps"'

# 输出：
# "task_name": "多租户权限管理",
# "current_step_id": 8,
# "total_steps": 22

# 3. 恢复特定备份
cp .claude/workflow-state-backup-1737123456789.json \
   .claude/workflow-state.json

# 4. 继续执行
/workflow-execute
```

#### 清理旧备份

```bash
# 查看所有备份
ls -lh .claude/workflow-state-*.json

# 删除已完成任务的备份
rm .claude/workflow-state-completed-*.json

# 删除特定备份（确认后执行）
rm .claude/workflow-state-backup-1737123456789.json
```

### 3.7 使用示例

#### 示例1：简单任务（连续执行）

```bash
# 对话1
/workflow-start "添加导出PDF按钮"
# ✅ 分析为"简单任务"，生成 5 个步骤

/workflow-execute  # 步骤1: 快速上下文收集
/workflow-execute  # 步骤2: 直接编码实现
/workflow-execute  # 步骤3: 编写单元测试
/workflow-execute  # 步骤4: 运行验证
/workflow-execute  # 步骤5: 代码提交
# 🎉 完成！
```

#### 示例2：复杂任务（新对话分批执行）

```bash
# ========== 对话1：需求分析 + 方案设计 ==========
/workflow-start "实现多租户权限管理系统"
# ✅ 分析为"复杂任务"，生成 22 个步骤

/workflow-execute  # 步骤1: 加载上下文
/workflow-execute  # 步骤2: 需求分析
/workflow-execute  # 步骤3: 用户确认
/workflow-execute  # 步骤4: 架构评估
/workflow-execute  # 步骤5: 探索代码
/workflow-execute  # 步骤6: 专项分析
/workflow-execute  # 步骤7: 生成技术方案
/workflow-execute  # 步骤8: Codex 方案审查 ⭐
# Codex 评分：85/100 ✅ 通过

# ========== 对话2（新窗口）：开发实施 ==========
/workflow-execute  # 自动从步骤9开始
/workflow-execute  # 步骤10: 实现功能
/workflow-execute  # 步骤11: 编写测试
/workflow-execute  # 步骤12: 运行测试

# ========== 对话3（新窗口）：质量验证 + 交付 ==========
/workflow-execute  # 步骤13: Codex 代码审查 ⭐
# Codex 评分：90/100 ✅ 通过

/workflow-execute  # 步骤14-22: 审查、文档、交付
# 🎉 完成！
```

### 3.8 辅助命令

```bash
# 查看当前状态和进度
/workflow-status

# 重试当前步骤（质量关卡失败后）
/workflow-retry-step

# 跳过当前步骤（慎用）
/workflow-skip-step
```

### 3.9 核心优势

| 对比项 | 智能工作流 | 传统手动流程 |
|-------|-----------|------------|
| **命令数量** | 2个 | 多个复杂命令 |
| **步骤规划** | ✅ 自动生成 | ❌ 需手动规划 |
| **进度记忆** | ✅ 自动持久化 | ❌ 需手动跟踪 |
| **新对话恢复** | ✅ 无缝恢复 | ❌ 需重新开始 |
| **质量保障** | ✅ 双重Codex审查 | ❌ 手动审查 |
| **适用场景** | 所有复杂度 | 需预判复杂度 |

---

## 4. 其他工作流

### 4.1 UI 还原工作流（/figma-ui）

**适用场景**：
- ✅ 有明确的 Figma 设计稿
- ✅ 需要高保真还原设计
- ✅ 注重组件复用和代码质量

**关键特性**：
- 🎨 自动提取 Figma 设计规范
- 🤖 **Gemini 生成前端代码原型**（前端设计的代码基点）
- 📐 智能识别可复用组件
- ✅ Codex 自动化质量验证

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

**重要原则**：
- ✅ **Gemini 优先**：UI 代码必须先从 Gemini 获取原型
- ✅ **Gemini 32k 限制**：注意上下文长度，仅传入 UI 相关信息
- ✅ **Codex Review**：编码后必须使用 Codex 执行 review
- ❌ 严禁直接调用 Figma MCP 工具，必须通过 figma-ui skill

---

### 4.2 后端工作流（/workflow-start --backend）

**适用场景**：
- ✅ 有明确的 PRD 产品需求文档
- ✅ 需要完整的需求分析和方案设计
- ✅ 后端业务逻辑开发

#### 工作流程

```
PRD.md → xq.md（需求分析）→ fasj.md（方案设计）→ workflow-state.json（执行计划）
           ↓                    ↓
        暂停审查              暂停审查
```

**特点**：
- 每生成一个文档后暂停，等待用户审查修改
- 与 Codex 协作讨论，确保需求理解和方案设计的准确性
- 文档存储在项目级目录，便于团队共享

#### 10步后端工作流

```
阶段1：需求分析
  1. 生成需求分析文档（xq.md）
  2. 审查需求分析文档（暂停）

阶段2：方案设计
  3. 生成方案设计文档（fasj.md）
  4. Codex 方案审查（质量关卡）
  5. 审查并修订方案设计（暂停）

阶段3：开发实施
  6. 生成实施计划
  7. 执行开发任务

阶段4：验证交付
  8. 自测与验证
  9. Codex 代码审查（质量关卡）
  10. 完善文档并总结
```

**文档结构**：

**xq.md（需求分析文档）**：
- 元信息、背景与业务目标
- 范围与边界（In Scope / Out of Scope）
- 角色与主体、关键业务流程
- 功能需求拆解（FR-01, FR-02, ...）
- 非功能需求、数据与接口线索
- 风险、依赖与假设、验收标准

**fasj.md（方案设计文档）**：
- 设计目标与原则、架构与边界
- 模块与职责划分
- 数据模型设计（领域模型、持久化模型）
- 接口设计（API 契约、请求响应结构）
- 非功能设计、数据迁移与兼容性
- 实施计划（工作项列表、里程碑）

**使用示例**：
```bash
# 启动后端工作流
/workflow-start --backend "docs/user-management-prd.md"

# 审查 xq.md 后继续
/workflow-execute

# 审查 fasj.md 后继续
/workflow-execute
```

**配置要求**：
- 需要在 `project-config.json` 中配置 `backend.fasjSpecPath`（方案设计规范路径）
- 首次使用时会自动询问配置方式

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

### 7.1 多模型调试：`/debug`

使用 **Codex 后端诊断 + Gemini 前端诊断** 的多模型调试，支持 Bug 修复全流程。

**使用方式**：
```bash
/debug "问题描述"
/debug "p328_600"  # 支持蓝鲸工单号
```

**执行流程**：
1. 问题分析与信息收集
2. Codex 后端诊断（API、数据库、业务逻辑）
3. Gemini 前端诊断（组件、状态、样式）
4. 交叉验证定位根因
5. 修复实现与验证

**适用场景**：
- 复杂 Bug 定位
- 跨前后端问题排查
- 性能问题诊断
- 蓝鲸工单处理（自动获取工单详情）

---

## 8. 典型场景实战

### 8.1 场景A：复杂功能开发（智能工作流）

**任务**：实现多租户权限管理系统

```bash
# 对话1：启动并开始执行
/workflow-start "实现多租户权限管理系统，支持租户隔离和RBAC"
# ✅ 生成执行计划

/workflow-execute  # 执行各步骤
# 双模型审查通过 ✅

# 对话2（新窗口）：继续开发
/workflow-execute  # 自动从上次位置继续

# 对话3（新窗口）：验证交付
/workflow-execute  # 完成剩余步骤
# 🎉 完成！
```

### 8.2 场景B：UI 还原（figma-ui skill）

**任务**：还原 Figma 用户设置页面

```bash
/figma-ui "https://www.figma.com/design/xxxxx?node-id=123:456"
# ✅ 自动获取设计规范
# ✅ Gemini 生成前端代码原型
# ✅ Codex 代码审查
# 🎉 完成！
```

### 8.3 场景C：Bug 调试（debug 命令）

**任务**：修复用户头像上传失败问题

```bash
# 带工作项编号（自动获取缺陷信息）
/debug "p328_600"
# ✅ 自动获取蓝鲸工作项详情
# ✅ Codex 后端诊断 + Gemini 前端诊断
# ✅ 定位根因并修复

# 无工作项编号
/debug "用户头像上传失败，返回 413 错误"
```

### 8.4 场景D：代码审查

```bash
# 多模型并行审查（默认）
/diff-review --branch main

# 单模型快速审查
/diff-review --quick --staged
```

### 8.5 场景E：查看进度并继续

```bash
# 在新对话中
/workflow-status
# 显示：当前步骤、总进度、下一步建议

/workflow-execute  # 继续执行
```

---

## 9. 最佳实践

### 9.1 工作流选择

```
Bug 调试？
  └─ 是 → /debug（支持 BK-MCP 集成）

有 Figma 设计稿？
  └─ 是 → /figma-ui（Gemini + Codex）

有 PRD 文档的后端开发？
  └─ 是 → /workflow-start --backend（PRD → xq.md → fasj.md）

功能开发？
  └─ /workflow-start（自动规划执行计划）
```

**工作流选择表**：

| 任务类型 | 推荐工作流 |
|---------|-----------|
| 新功能开发 | `/workflow-start` ⭐⭐⭐ |
| Bug 调试 | `/debug` ⭐ |
| UI 还原 | `/figma-ui` |
| 后端开发（有PRD） | `/workflow-start --backend` |
| 代码审查 | `/diff-review` |
| 技术分析 | `/analyze` |

### 9.2 新对话执行模式

**推荐做法**：关键阶段在新对话中执行

```bash
# 对话1：分析 + 方案
/workflow-start "需求"
/workflow-execute × N  # 执行到方案审查完成

# 对话2：开发实施
/workflow-execute × N  # 编码 + 测试

# 对话3：验证交付
/workflow-execute × N  # 代码审查 + 文档
```

**优势**：
- ✅ 每个对话上下文独立
- ✅ 审查上下文充足
- ✅ 可随时暂停和恢复

### 9.3 质量保证

- ✅ 依赖质量关卡：双模型审查
- ✅ 及时重试：审查不通过时 `/workflow-retry-step`
- ✅ 记录决策：所有决策自动记录到任务记忆
- ✅ 文档完整：技术方案、验证报告自动生成

---

## 10. 常见问题

### 10.1 如何选择工作流？

**A**: 优先使用智能工作流 `/workflow-start`
- 自动规划执行计划
- 适用大多数场景
- Bug 调试用 `/debug`，UI 还原用 `/figma-ui`

### 10.2 任务记忆文件在哪？

**A**: `~/.claude/workflows/{project-hash}/workflow-state.json`
- 记录所有步骤状态和进度
- 支持新对话恢复
- 包含审查结果和决策记录

### 10.3 质量关卡失败怎么办？

**A**:
1. 查看审查意见
2. 根据建议优化内容
3. 执行 `/workflow-retry-step` 重新审查

### 10.4 如何在新对话中恢复？

**A**:
```bash
# 在新对话中直接执行
/workflow-execute
# ✅ 自动读取任务记忆，继续下一步
```

### 10.5 可以跳过某个步骤吗？

**A**:
- 可以使用 `/workflow-skip-step`（慎用）
- 会记录跳过理由到任务记忆

### 10.6 如何解除任务阻塞？

**A**:
```bash
# 当后端接口或设计稿就绪时
/workflow-unblock api_spec    # 解除 API 依赖阻塞
/workflow-unblock design_spec # 解除设计稿依赖阻塞
```

---

## 附录 A：命令速查表

| 命令 | 简介 | 优先级 |
|------|------|-------|
| **智能工作流** |||
| `/workflow-start "需求"` | 启动智能工作流，自动规划执行计划 | ⭐⭐⭐ |
| `/workflow-execute` | 执行下一步（重复调用） | ⭐⭐⭐ |
| `/workflow-status` | 查看当前状态和进度 | ⭐⭐ |
| `/workflow-retry-step` | 重试当前步骤（质量关卡失败后） | ⭐ |
| `/workflow-skip-step` | 跳过当前步骤（慎用） | |
| `/workflow-unblock` | 解除任务阻塞依赖 | |
| **其他工作流** |||
| `/figma-ui "Figma URL"` | UI 还原（Gemini + Codex） | ⭐ |
| `/workflow-start --backend "PRD路径"` | 后端工作流（PRD→xq.md→fasj.md→执行） | ⭐ |
| **CLI 工具** |||
| `claude-workflow status` | 查看安装状态 | ⭐ |
| `claude-workflow sync` | 同步模板到 ~/.claude | ⭐ |
| `claude-workflow sync -f` | 强制覆盖所有文件 | |
| `claude-workflow init` | 初始化项目配置 | ⭐ |
| `claude-workflow doctor` | 诊断配置问题 | |
| **分析与审查** |||
| `/analyze "描述"` | 双模型技术分析（Codex + Gemini 并行） | ⭐⭐ |
| `/diff-review` | 多模型并行代码审查（默认） | ⭐ |
| `/diff-review --quick` | 单模型快速审查 | ⭐ |
| `/diff-review --staged` | 审查已暂存变更 | ⭐ |
| `/diff-review --branch main` | 审查整个分支 | ⭐ |
| **调试与测试** |||
| `/debug "问题描述"` | 多模型调试（Codex + Gemini） | ⭐⭐ |
| `/write-tests` | Vitest 测试专家编写测试 | ⭐ |
| **其他工具** |||
| `/scan` | 智能项目扫描（检测技术栈 + 生成上下文报告） | ⭐ |
| `/enhance "prompt"` | Prompt 增强 | |
| `/git-rollback` | 交互式 Git 回滚 | |
| `/agents` | 查看所有可用 Agent 命令 | |

---

## 附录 B：Prompt 模板

项目使用双模型协作，Prompt 模板位于 `~/.claude/prompts/`：

| 目录 | 专长 | 使用场景 |
|------|------|----------|
| **codex/** | 后端架构、算法、调试、安全 | API 设计、数据库、性能优化、代码审查 |
| **gemini/** | 前端 UI、CSS、组件、可访问性 | React/Vue 组件、样式、响应式设计 |

**角色提示词**：

| 角色 | Codex | Gemini |
|------|-------|--------|
| 分析 | `codex/analyzer.md` | `gemini/analyzer.md` |
| 架构 | `codex/architect.md` | `gemini/frontend.md` |
| 审查 | `codex/reviewer.md` | `gemini/reviewer.md` |
| 调试 | `codex/debugger.md` | `gemini/debugger.md` |
| 测试 | `codex/tester.md` | `gemini/tester.md` |
| 优化 | `codex/optimizer.md` | `gemini/optimizer.md` |

这些 Prompt 由 `codeagent-wrapper` 在双模型协作流程中自动使用。

---

## 附录 C：快速入门

### 安装

```bash
npm install -g @pic/claude-workflow --registry http://your-registry-host:4873
```

### 新手推荐流程

```bash
# 1. 启动智能工作流
/workflow-start "你的功能需求描述"

# 2. 重复执行（直到完成）
/workflow-execute
/workflow-execute
# ...

# 3. 随时查看状态
/workflow-status
```

### 常用命令

```bash
# 功能开发
/workflow-start "需求描述"
/workflow-execute

# UI 还原
/figma-ui "Figma URL"

# Bug 调试
/debug "问题描述"

# 代码审查
/diff-review --branch main

# 技术分析
/analyze "分析内容"
```

### 进阶使用

- 关键阶段在新对话中执行
- 使用 `/workflow-status` 了解进度
- 质量关卡失败时使用 `/workflow-retry-step`
- 使用 `claude-workflow doctor` 诊断配置问题

---

**文档结束**

如有疑问，请参考：
- 安装状态：`claude-workflow status`
- 诊断问题：`claude-workflow doctor`
- 命令索引：`/agents`
- 项目规范：`CLAUDE.md`
