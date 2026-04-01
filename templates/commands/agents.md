---
description: 查看所有可用的 Agent 斜杠命令和使用指南
allowed-tools: Read(*)
---

# 可用的 Agent 命令

快速查看所有可用的 subagent 斜杠命令。

## 📖 符号说明

| 符号 | 含义 |
|------|------|
| ⭐ | 高频使用 |
| ⭐⭐ | 最高优先级 |
| 🎯 | Skill（支持 references 渐进加载） |

---

## 🔍 智能分析类 (Skills)

| 命令 | 功能 |
|------|------|
| `/analyze "描述"` ⭐⭐ 🎯 | Codex 技术分析 + Claude 前端分析 |
| `/debug "问题"` ⭐ 🎯 | Codex 协作调试（后端/逻辑） |

---

## 🔎 审查类 (Skill)

| 命令 | 功能 |
|------|------|
| `/diff-review` ⭐ 🎯 | Claude 单模型快速审查（默认 Quick 模式） |
| `/diff-review --deep` | Codex 协作深度审查 |
| `/diff-review --staged` | 仅审查已暂存变更 |
| `/diff-review --branch <base>` | 审查相对分支的变更 |

---

## 🧪 测试类 (Skill)

| 命令 | 功能 |
|------|------|
| `/write-tests` 🎯 | 测试编写专家（支持 Vitest/Jest/Go/pytest） |

---

## ⚙️ 项目配置类 (Skill)

| 命令 | 功能 |
|------|------|
| `/scan` ⭐ 🎯 | 智能项目扫描，生成配置和上下文报告 |
| `/scan --config-only` | 仅生成配置文件（跳过语义分析） |
| `/scan --context-only` | 仅生成上下文报告 |

---

## 🚀 工作流 (Command)

**统一入口**: `/workflow <action> [args]`

| 动作 | 说明 |
|------|------|
| `/workflow start "需求"` ⭐⭐⭐ | 启动智能工作流 |
| `/workflow execute` | 执行下一个任务 |
| `/workflow execute --retry` | 重试失败步骤 |
| `/workflow execute --skip` | 跳过当前步骤（慎用） |
| `/workflow status` | 查看工作流状态 |
| `/workflow unblock <dep>` | 解除任务阻塞 |
| `/workflow archive` | 归档已完成工作流 |

---

## 🎨 UI 还原 (Skill)

| 命令 | 功能 |
|------|------|
| `/figma-ui <URL>` ⭐ 🎯 | Figma 设计稿到代码（视觉验证） |

---

## 🔧 工具类 (Commands)

| 命令 | 功能 |
|------|------|
| `/workflow <action>` ⭐⭐⭐ | 统一 workflow 命令入口（路由到 planning / executing / delta / runtime） |
| `/git-rollback` | 交互式 Git 回滚（reset/revert） |
| `/enhance` | Prompt 增强 |

---

## 🎯 快速选择

| 我想... | 命令 |
|---------|------|
| 扫描项目（首次必须） | `/scan` ⭐ |
| 开发功能 | `/workflow start` ⭐⭐⭐ |
| 调试/修复 Bug | `/debug` ⭐ |
| 批量修复缺陷 | `/bug-batch` |
| 子 agent 并行调度 | `/dispatching-parallel-agents` |
| 还原 Figma 设计稿 | `/figma-ui` ⭐ |
| 视觉对比验证 | `/visual-diff` |
| 分析/探索问题 | `/analyze` ⭐⭐ |
| 审查代码变更 | `/diff-review` ⭐ |
| 编写测试 | `/write-tests` |

---

## 📊 统计

| 类型 | 数量 |
|------|------|
| Skills | 9 个 |
| Commands | 4 个 |

**Skills**: analyze, bug-batch, debug, diff-review, dispatching-parallel-agents, figma-ui, scan, visual-diff, write-tests

**Commands**: agents, enhance, git-rollback, workflow
