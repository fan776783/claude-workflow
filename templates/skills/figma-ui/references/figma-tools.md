# Figma MCP 工具速查

## 核心工具

| 工具 | 用途 | 必传参数 |
|------|------|----------|
| `get_design_context` | 获取结构化设计数据 + 代码 | `nodeId`, `dirForAssetWrites` |
| `get_screenshot` | 获取节点截图用于视觉验证 | `nodeId` |
| `get_metadata` | 获取节点 XML 结构概览 | `nodeId` |

## 标准工作流

```
1. get_design_context  ─── 获取设计数据（必传 dirForAssetWrites）
         │
         ├─ 正常返回 ───────────────────────────────────┐
         │                                              │
         └─ 返回空/截断 ─→ get_metadata ─→ 分块重新获取 ─┘
                                                        │
2. get_screenshot  ←────────────────────────────────────┘
         │
3. 开始编码
```

## 调用示例

```typescript
// 1. 获取设计上下文
const designContext = await mcp__figma-mcp__get_design_context({
  nodeId: '42:15',
  dirForAssetWrites: 'public/images/.figma-ui/tmp/task-1'
});

// 2. 获取视觉参考
await mcp__figma-mcp__get_screenshot({
  nodeId: '42:15'
});

// 3. 复杂节点分块获取
const metadata = await mcp__figma-mcp__get_metadata({
  nodeId: '42:15'
});
```

## 资源处理规则

| 规则 | 说明 |
|------|------|
| localhost URL | 直接使用，不转换 |
| 禁止新增图标包 | 所有资源来自 Figma |
| 禁止占位符 | 有 localhost URL 时必须使用 |

## 输出转换

Figma MCP 默认输出 React + Tailwind，需要转换为项目框架：

1. **框架适配**：React → Vue/Nuxt 等
2. **样式保留**：优先保留 Figma 原始值
3. **组件复用**：识别并复用项目现有组件
