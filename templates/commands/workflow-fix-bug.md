---
description: "[DEPRECATED] 已弃用，请使用 /debug 命令"
argument-hint: "<Bug 描述或工单号>"
allowed-tools: Read(*)
examples:
  - /debug "用户头像上传失败"
---

# ⚠️ 命令已弃用

`/workflow-fix-bug` 已被 `/debug` 命令替代。

## 迁移指南

### 新命令

```bash
/debug "问题描述"
```

### 功能对比

| 功能 | /workflow-fix-bug (旧) | /debug (新) |
|------|------------------------|-------------|
| 问题诊断 | Codex 单模型 | Codex + Gemini 双模型并行 |
| 前端问题 | 有限支持 | Gemini 专项诊断 |
| 后端问题 | Codex 诊断 | Codex 专项诊断 |
| 修复验证 | 单模型审查 | 双模型交叉审查 |
| BK-MCP 集成 | ✅ 支持 | ❌ 已移除 |
| 工作流记忆 | ✅ 支持 | ❌ 已移除 |

### 已移除功能

以下功能在 `/debug` 中不再支持：

1. **BK-MCP 工单集成**
   - 自动获取缺陷信息
   - 自动流转工单状态
   - 如需此功能，请手动调用 BK-MCP 工具

2. **工作流记忆/状态**
   - 跨会话状态保存
   - 如需复杂工作流，请使用 `/workflow-start`

### 推荐用法

```bash
# 简单 Bug 调试（推荐）
/debug "用户头像上传失败"

# 复杂 Bug 修复（需要工作流管理）
/workflow-start "修复 [p328_600] 用户头像上传失败"
```

## 立即使用新命令

请使用以下命令替代：

```bash
/debug "$ARGUMENTS"
```
