# Claude Code 工作流体系指南

> 基于 Claude Code 的智能化开发工作流体系

**文档版本**：v3.1.0
**最后更新**：2025-12-01
**包版本**：@pic/claude-workflow v1.0.2

---

## 📖 目录

- [1. 概述](#1-概述)
- [2. 工作流安装与配置](#2-工作流安装与配置)
- [3. 智能工作流](#3-智能工作流)
- [4. 其他工作流](#4-其他工作流)
- [5. 专项分析命令](#5-专项分析命令)
- [6. 审查命令](#6-审查命令)
- [7. 典型场景实战](#7-典型场景实战)
- [8. 最佳实践](#8-最佳实践)
- [9. 常见问题](#9-常见问题)

---

## 1. 概述

### 1.1 什么是工作流体系

Claude Code 工作流体系是一套基于 AI 和斜杠命令的智能化开发流程，涵盖从需求分析到质量验证的完整开发生命周期。

**核心价值**：
- ✅ **npm 包安装**：`npm install -g @pic/claude-workflow` 一行命令完成安装
- ✅ **智能升级**：自动备份、3-way merge、保留用户修改
- ✅ **CLI 工具**：`claude-workflow status/sync/init/doctor` 命令行管理
- ✅ **多模型协作**：Gemini（前端） + Codex（后端）双模型互补
- ✅ **零配置体验**：首次使用自动检测并初始化项目
- ✅ **用户级存储**：工作流状态存储在 `~/.claude/`，完全避免 Git 冲突
- ✅ **极简使用**：仅需2个命令即可完成复杂任务
- ✅ **智能规划**：根据需求自动生成5-22个步骤
- ✅ **自动记忆**：任务进度持久化，支持新对话恢复
- ✅ **质量保证**：内置双重 Codex 审查机制
- ✅ **效率提升**：自动化繁琐的分析和验证工作
- ✅ **多项目管理**：自动识别和隔离不同项目的工作流状态

### 1.2 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│         @pic/claude-workflow (v1.0.2)                        │
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
│核心工作流 (5个) │  │ CLI 工具         │  │  专项分析 (6个) │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • workflow-start│  │ • status 状态   │  │ • performance   │
│ • quick-dev     │  │ • sync 同步     │  │ • deps          │
│ • fix-bug       │  │ • init 初始化   │  │ • route         │
│ • ui-restore    │  │ • doctor 诊断   │  │ • store等       │
│ • backend-start │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  基础工具链      │  │  MCP 双模型协作  │  │  文档输出       │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • context-load  │  │ • Gemini (前端) │  │ • 任务记忆       │
│ • explore-code  │  │ • Codex (后端)  │  │ • 技术方案      │
│ • codex-analyze │  │ • Figma MCP     │  │ • 验证报告      │
│ • write-tests   │  │ • BK-MCP        │  │ • 工作流总结     │
│                 │  │ • Context7      │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 1.3 命令总览

项目核心命令：

| 类别 | 核心命令 | 说明 |
|------|---------|------|
| **智能工作流** ⭐⭐⭐ | `/workflow-start`, `/workflow-execute` | 自动规划和执行（推荐） |
| **后端工作流** | `/workflow-backend-start` | PRD → 需求分析 → 方案设计 → 执行 |
| **其他工作流** | `/workflow-quick-dev`, `/workflow-fix-bug`, `/workflow-ui-restore` | 快速开发、Bug修复、UI还原 |
| **CLI 工具** | `claude-workflow status/sync/init/doctor` | 状态查看、同步、初始化、诊断 |
| **专项分析** | `/analyze` | 智能分析（自动识别场景） |
| **审查** | `/diff-review` | 基于 git diff 的代码审查 |
| **测试** | `/write-tests` | 调用 Vitest 测试专家编写测试 |

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
├── commands/              # 14 个工作流命令
├── agents/                # 3 个 Agent 定义
├── docs/                  # 6 个技术文档
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
├── commands/                           # 工作流命令（25+ 个）
├── docs/                               # 技术文档
├── agents/                             # Agent 定义
├── utils/                              # 工具函数
├── workflows/                          # 工作流状态（按项目隔离）
│   ├── a13dcda9d96c/                   # 项目 1（基于 cwd hash）
│   │   ├── workflow-memory.json        # 工作流记忆
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
   └─ 保存到 .claude/workflow-memory.json
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

**路径**：`.claude/workflow-memory.json`

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
if (fileExists('.claude/workflow-memory.json')) {
  const existingMemory = readFile('.claude/workflow-memory.json');

  if (existingMemory.status !== 'completed') {
    // 1. 自动备份到带时间戳的文件
    const backupPath = `.claude/workflow-memory-backup-${Date.now()}.json`;
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
| **未完成** (`in_progress`) | ⚠️ 询问用户确认 | `.claude/workflow-memory-backup-{timestamp}.json` |
| **已完成** (`completed`) | ✅ 自动归档 | `.claude/workflow-memory-completed-{timestamp}.json` |
| **不存在** | ✅ 直接创建 | - |

#### 恢复备份

```bash
# 1. 查看所有备份
ls -lh .claude/workflow-memory-*.json

# 2. 查看备份内容
cat .claude/workflow-memory-backup-1737123456789.json | \
  grep -E '"task_name"|"current_step_id"|"total_steps"'

# 输出：
# "task_name": "多租户权限管理",
# "current_step_id": 8,
# "total_steps": 22

# 3. 恢复特定备份
cp .claude/workflow-memory-backup-1737123456789.json \
   .claude/workflow-memory.json

# 4. 继续执行
/workflow-execute
```

#### 清理旧备份

```bash
# 查看所有备份
ls -lh .claude/workflow-memory-*.json

# 删除已完成任务的备份
rm .claude/workflow-memory-completed-*.json

# 删除特定备份（确认后执行）
rm .claude/workflow-memory-backup-1737123456789.json
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

### 4.1 快速开发工作流（/workflow-quick-dev）

**适用场景**：
- ✅ 功能需求明确，无需复杂需求分析
- ✅ 开发周期 < 1天
- ✅ 代码变更 < 300 行
- ✅ 已有类似实现可参考

#### 3步快速流程

```
第1步：快速上下文加载
  └─ /context-load "功能描述"

第2步：探索与实现
  ├─ 探索现有实现（/explore-code）
  └─ 快速实现（直接编码）

第3步：快速验证
  ├─ 功能测试
  └─ 代码质量检查（可选）
```

**使用示例**：
```bash
/workflow-quick-dev "添加导出为 PDF 的按钮"
```

---

### 4.2 UI 还原工作流（/workflow-ui-restore）

**适用场景**：
- ✅ 有明确的 Figma 设计稿
- ✅ 需要高保真还原设计
- ✅ 需要响应式适配

#### 5步 UI 还原流程

```
第1步：获取 Figma 设计上下文
  ├─ get_design_context（颜色、间距、字体）
  └─ get_screenshot（设计截图）

第2步：分析设计规范

第3步：加载项目 UI 上下文

第4步：实现 UI 组件
  ├─ 组件结构设计
  ├─ Tailwind CSS 实现
  ├─ 响应式适配
  └─ 交互状态实现

第5步：质量验证
  ├─ 视觉还原度检查
  ├─ /review-ui
  └─ 响应式测试
```

**使用示例**：
```bash
/workflow-ui-restore "https://www.figma.com/file/xxxxx"
```

---

### 4.3 后端工作流（/workflow-backend-start）

**适用场景**：
- ✅ 有明确的 PRD 产品需求文档
- ✅ 需要完整的需求分析和方案设计
- ✅ 后端业务逻辑开发

#### 工作流程

```
PRD.md → xq.md（需求分析）→ fasj.md（方案设计）→ workflow-memory.json（执行计划）
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

**使用示例**：
```bash
# 启动后端工作流
/workflow-backend-start "docs/user-management-prd.md"

# 审查 xq.md 后继续
/workflow-execute

# 审查 fasj.md 后继续
/workflow-execute
```

---

## 5. 专项分析命令

| 命令 | 核心功能 | 典型场景 |
|------|---------|---------|
| `/analyze-performance` ⭐ | Bundle体积、加载性能、运行时性能 | 性能优化、体积控制 |
| `/analyze-deps` ⭐ | Monorepo依赖、版本冲突、安全漏洞 | 依赖升级、安全审计 |
| `/analyze-route` ⭐ | 路由配置、微前端同步、懒加载 | 路由优化、微前端调试 |
| `/analyze-store` ⭐ | Pinia/Zustand架构、性能问题 | 状态优化、跨应用同步 |
| `/analyze-i18n` | next-intl/vue-i18n、翻译完整性 | 国际化审查、翻译补全 |
| `/analyze-requirements` | 需求拆解、依赖关系、风险评估 | 复杂需求分析 |

---

## 6. 审查命令

| 命令 | 核心功能 | 典型场景 |
|------|---------|---------|
| `/architect-review` | 专家级代码审查、架构建议 | 代码重构、架构决策 |
| `/review-tracking` ⭐ | 埋点完整性、规范性、数据质量 | 新功能上线前 |
| `/review-observability` ⭐ | Sentry配置、性能监控、日志系统 | 监控优化、错误排查 |
| `/review-ui` | 组件设计、Props设计、Tailwind规范 | UI组件开发、设计评审 |
| `/review-api` | API规范、错误处理、安全性 | API集成、安全审计 |

---

## 7. 典型场景实战

### 7.1 场景A：复杂功能开发（智能工作流）

**任务**：实现多租户权限管理系统

```bash
# 对话1：启动并开始执行
/workflow-start "实现多租户权限管理系统，支持租户隔离和RBAC"
# ✅ 生成 22 个步骤

/workflow-execute  # 步骤1-8：需求分析 + 技术方案
# 步骤8: Codex方案审查，评分85，通过 ✅

# 对话2（新窗口）：开发实施
/workflow-execute  # 步骤9-12：编码 + 测试

# 对话3（新窗口）：验证交付
/workflow-execute  # 步骤13-22：Codex代码审查 + 文档
# 步骤13: Codex代码审查，评分90，通过 ✅
# 🎉 完成！评分89/100
```

### 7.2 场景B：简单功能开发（快速工作流）

**任务**：添加用户头像上传功能

```bash
/workflow-quick-dev "添加用户头像上传功能"
# ✅ 自动加载上下文
# ✅ 探索现有文件上传实现
# ✅ 快速实现并验证
# 🎉 完成！总耗时 < 30分钟
```

### 7.3 场景C：UI 还原（UI 还原工作流）

**任务**：还原 Figma 用户设置页面

```bash
/workflow-ui-restore "https://www.figma.com/file/xxxxx"
# ✅ 自动获取设计规范
# ✅ 分析颜色、间距、字体
# ✅ 加载UI上下文
# ✅ 实现组件（Tailwind CSS + 响应式）
# ✅ UI审查通过
# 🎉 完成！总耗时 < 45分钟
```

### 7.4 场景D：查看进度并继续

```bash
# 在新对话中
/workflow-status
# 显示：当前步骤10，总共22步，已完成9步

/workflow-execute  # 继续执行步骤10
```

---

## 8. 最佳实践

### 8.1 工作流选择

```
有Figma设计稿？
  └─ 是 → /workflow-ui-restore

简单功能（< 300行，< 1天）？
  └─ 是 → /workflow-quick-dev

复杂功能或不确定复杂度？
  └─ /workflow-start（自动适配）
```

### 8.2 新对话执行模式

**推荐做法**：关键阶段在新对话中执行

```bash
# 对话1：分析 + 方案（约30-60分钟）
/workflow-start "需求"
/workflow-execute × N  # 执行到Codex方案审查完成

# 对话2：开发实施（主要开发时间）
/workflow-execute × N  # 编码 + 测试

# 对话3：验证交付（约1-2小时）
/workflow-execute × N  # Codex代码审查 + 文档
```

**优势**：
- ✅ 每个对话上下文独立
- ✅ Codex审查上下文充足
- ✅ 可随时暂停和恢复

### 8.3 质量保证

- ✅ 依赖质量关卡：Codex评分 < 80自动阻止
- ✅ 及时重试：评分不足时优化后 `/workflow-retry-step`
- ✅ 记录决策：所有决策自动记录到任务记忆
- ✅ 文档完整：技术方案、验证报告自动生成

### 8.4 效率提升

- ✅ 简单任务连续执行：在同一对话完成5步
- ✅ 复杂任务分批执行：新对话中恢复
- ✅ 查看状态：`/workflow-status` 随时了解进度
- ✅ 复用会话：Codex 方案审查和代码审查复用SESSION_ID

---

## 9. 常见问题

### 9.1 如何选择工作流？

**A**: 优先使用智能工作流 `/workflow-start`
- 自动适配任务复杂度（简单/中等/复杂）
- 适用所有场景
- 除非明确是简单功能或UI还原

### 9.2 任务记忆文件在哪？

**A**: `.claude/workflow-memory.json`
- 记录所有步骤状态和进度
- 支持新对话恢复
- 包含Codex审查评分和决策记录

### 9.3 质量关卡失败怎么办？

**A**:
1. 查看Codex审查意见（在技术方案或验证报告中）
2. 根据建议优化内容
3. 执行 `/workflow-retry-step` 重新审查
4. 评分 ≥ 80 即可继续

### 9.4 如何在新对话中恢复？

**A**:
```bash
# 在新对话中直接执行
/workflow-execute
# ✅ 自动读取任务记忆，继续下一步
```

### 9.5 可以跳过某个步骤吗？

**A**:
- 可以使用 `/workflow-skip-step`（慎用）
- 会记录跳过理由到任务记忆
- 跳过质量关卡会记录风险

### 9.6 重新执行 workflow-start 会覆盖旧任务吗？

**A**: 不会！系统内置了自动保护机制 🔒

**未完成的任务**：
- 自动备份到 `.claude/workflow-memory-backup-{时间戳}.json`
- 询问用户：继续旧任务 / 开始新任务 / 取消操作
- 防止意外覆盖

**已完成的任务**：
- 自动归档到 `.claude/workflow-memory-completed-{时间戳}.json`
- 直接创建新任务

**恢复备份**：
```bash
# 查看备份
ls -lh .claude/workflow-memory-*.json

# 恢复备份
cp .claude/workflow-memory-backup-{时间戳}.json \
   .claude/workflow-memory.json

# 继续执行
/workflow-execute
```

详见：[3.6 任务保护机制](#36-任务保护机制)

---

## 附录 A：命令速查表

| 命令 | 简介 | 优先级 |
|------|------|-------|
| **智能工作流** |||
| `/workflow-start` | 启动智能工作流 | ⭐⭐⭐ |
| `/workflow-execute` | 执行下一步（重复调用） | ⭐⭐⭐ |
| `/workflow-status` | 查看当前状态 | ⭐⭐ |
| `/workflow-retry-step` | 重试当前步骤 | ⭐ |
| `/workflow-skip-step` | 跳过当前步骤（慎用） | |
| **其他工作流** |||
| `/workflow-quick-dev` | 快速开发工作流（3步） | ⭐ |
| `/workflow-ui-restore` | UI 还原工作流（5步） | ⭐ |
| `/workflow-fix-bug` | Bug 修复工作流 | ⭐ |
| `/workflow-backend-start` | 后端工作流（PRD→设计→执行） | ⭐ |
| **CLI 工具** |||
| `claude-workflow status` | 查看安装状态 | ⭐ |
| `claude-workflow sync` | 同步模板 | ⭐ |
| `claude-workflow init` | 初始化项目配置 | ⭐ |
| `claude-workflow doctor` | 诊断配置问题 | |
| **分析与审查** |||
| `/analyze` | 智能分析（自动识别场景） | ⭐ |
| `/diff-review` | 基于 git diff 的代码审查 | ⭐ |
| `/write-tests` | 调用 Vitest 测试专家编写测试 | |
| `/init-project-config` | 初始化项目配置 | |
| `/agents` | 查看所有可用 Agent 命令 | |

---

## 附录 B：快速入门

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
