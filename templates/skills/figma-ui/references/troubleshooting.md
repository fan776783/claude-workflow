# 故障排查

## MCP 连接

### Issue: MCP server not found

**原因**: Figma MCP 未配置或 Figma Desktop 未启动

**解决**:
1. 确保 Figma Desktop 已打开
2. 启用 MCP 服务：Figma Desktop → Settings → Enable MCP Server
3. 添加 MCP 配置：
```bash
claude mcp add figma-mcp --url http://127.0.0.1:3845/mcp
```
4. 重启 Claude Code

---

## 参数错误

### Issue: Path for asset writes as tool argument is required

**原因**: 调用 `get_design_context` 时未传 `dirForAssetWrites`

**解决**:
1. 先获取 `assetsDir`（从 ui-config.json 或使用默认值）
2. 构造临时目录：`${assetsDir}/.figma-ui/tmp/${taskId}`
3. 调用时传入 `dirForAssetWrites`

```typescript
await mcp__figma-mcp__get_design_context({
  nodeId: '42:15',
  dirForAssetWrites: `${assetsDir}/.figma-ui/tmp/${taskId}`
});
```

---

## 数据问题

### Issue: designContext 返回为空或被截断

**原因**: 节点过于复杂或嵌套层级过多

**解决**: 执行分块获取
```typescript
const metadata = await mcp__figma-mcp__get_metadata({ nodeId });
for (const childId of extractChildNodeIds(metadata)) {
  const childContext = await mcp__figma-mcp__get_design_context({
    nodeId: childId,
    dirForAssetWrites: taskAssetsDir
  });
  mergeContext(designContext, childContext);
}
```

---

## 资源问题

### Issue: 图片资源无法加载

**原因**: Figma MCP 资源端点不可访问

**解决**:
1. 确认 MCP 服务运行中
2. 直接使用 localhost URL，不要修改
3. 检查网络/防火墙

---

## Gemini Review

### Issue: Gemini 调用超时

**原因**: 网络问题或 Gemini 服务不可用

**解决**: 使用降级方案
- 当前模型按相同 JSON 格式自行审查
- 交付摘要注明："降级 visualFidelity: XX/100 (原因: Gemini 超时)"

### Issue: visualFidelity 始终低于门控

**原因**: 存在未修复的视觉问题

**解决**:
1. 检查 review.visualFidelity.issues 中的 P0/P1 问题
2. 按 suggestion 修复
3. 最多循环 3 次
4. 超过则请求用户指导

---

## 视觉验证

### Issue: 实现与设计不匹配

**原因**: 视觉细节偏差

**解决**: 对照 screenshot 逐项检查：
- [ ] 间距：padding、margin、gap
- [ ] 颜色：背景、文字、边框
- [ ] 字体：大小、粗细、行高
- [ ] 布局：对齐、尺寸、层级
- [ ] 边框：圆角、宽度、样式
- [ ] 阴影：有无、参数
