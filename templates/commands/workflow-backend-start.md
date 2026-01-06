---
description: 后端工作流启动（别名，等同于 /workflow-start --backend）
argument-hint: "<PRD文档路径>"
allowed-tools: SlashCommand(*)
---

# 后端工作流启动（别名）

此命令已合并到 `/workflow-start`，保留此别名以保持向后兼容。

---

## 自动转发

```typescript
// 将参数转发到 /workflow-start --backend
const prdPath = $ARGUMENTS[0];

if (!prdPath) {
  console.log(`
❌ 请提供 PRD 文档路径

用法：
  /workflow-backend-start "docs/user-management-prd.md"

或使用新命令：
  /workflow-start --backend "docs/user-management-prd.md"
  `);
  return;
}

console.log(`
📋 此命令已合并到 /workflow-start

正在转发到：/workflow-start --backend "${prdPath}"
`);

// 执行 /workflow-start --backend
SlashCommand({ command: `/workflow-start --backend "${prdPath}"` });
```

---

## 推荐使用新命令

```bash
# 旧命令（仍可用）
/workflow-backend-start "docs/prd.md"

# 新命令（推荐）
/workflow-start --backend "docs/prd.md"
```

---

## 完整文档

请参阅 `/workflow-start` 命令的文档，了解后端工作流的完整说明：

- 后端工作流执行流程
- xq.md / fasj.md 文档结构
- 后端配置说明
- 使用示例
