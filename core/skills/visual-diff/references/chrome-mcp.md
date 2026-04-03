# Chrome MCP 截图指南

## 核心工具

| 工具 | 用途 |
|------|------|
| `take_screenshot` | 截取页面或元素截图 |
| `navigate_page` | 导航到指定 URL |
| `wait_for` | 等待元素出现 |
| `take_snapshot` | 获取页面 a11y 树快照 |

## 截图流程

### 1. 导航到页面

```typescript
await mcp__chrome-mcp__navigate_page({
  type: 'url',
  url: 'http://localhost:3000/test/demo-dialog'
});
```

### 2. 等待内容加载

```typescript
// 等待特定文本出现
await mcp__chrome-mcp__wait_for({
  text: '生成场景',
  timeout: 10000
});

// 或等待一段时间确保渲染完成
await new Promise(resolve => setTimeout(resolve, 2000));
```

### 3. 触发弹窗（如需要）

```typescript
// 获取页面快照找到按钮
const snapshot = await mcp__chrome-mcp__take_snapshot({});

// 点击触发按钮
await mcp__chrome-mcp__click({
  uid: '<button-uid-from-snapshot>'
});

// 等待弹窗出现
await mcp__chrome-mcp__wait_for({
  text: '弹窗标题',
  timeout: 5000
});
```

### 4. 截图

```typescript
// 全页面截图
await mcp__chrome-mcp__take_screenshot({
  filePath: '/path/to/output/impl.png',
  format: 'png'
});

// 指定元素截图
await mcp__chrome-mcp__take_screenshot({
  uid: '<element-uid>',
  filePath: '/path/to/output/impl.png',
  format: 'png'
});

// 全页面截图（包括滚动区域）
await mcp__chrome-mcp__take_screenshot({
  fullPage: true,
  filePath: '/path/to/output/impl.png'
});
```

## 常见场景

### 弹窗组件截图

```typescript
// 1. 导航到测试页面
await mcp__chrome-mcp__navigate_page({
  type: 'url',
  url: 'http://localhost:3000/test/demo-dialog'
});

// 2. 点击打开弹窗
const snapshot = await mcp__chrome-mcp__take_snapshot({});
// 从 snapshot 中找到 "打开弹窗" 按钮的 uid
await mcp__chrome-mcp__click({ uid: '<open-btn-uid>' });

// 3. 等待弹窗渲染
await mcp__chrome-mcp__wait_for({ text: '弹窗标题' });

// 4. 截图弹窗
// 方式 A: 截取整个视口
await mcp__chrome-mcp__take_screenshot({
  filePath: './impl.png'
});

// 方式 B: 截取弹窗元素
const dialogSnapshot = await mcp__chrome-mcp__take_snapshot({});
// 找到弹窗容器的 uid
await mcp__chrome-mcp__take_screenshot({
  uid: '<dialog-uid>',
  filePath: './impl.png'
});
```

### 页面组件截图

```typescript
// 1. 导航到页面
await mcp__chrome-mcp__navigate_page({
  type: 'url',
  url: 'http://localhost:3000/dashboard'
});

// 2. 等待加载完成
await mcp__chrome-mcp__wait_for({ text: '仪表盘' });

// 3. 截图
await mcp__chrome-mcp__take_screenshot({
  filePath: './impl.png'
});
```

## 注意事项

1. **等待渲染**：截图前确保页面/组件完全渲染
2. **视口尺寸**：使用 `resize_page` 确保视口尺寸与设计稿一致
3. **元素定位**：使用 `take_snapshot` 获取元素 uid
4. **超时处理**：设置合理的 timeout 避免无限等待
