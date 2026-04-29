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
3. 调用时传入：
```
get_design_context(fileKey, nodeId="42:15", dirForAssetWrites="${assetsDir}/.figma-ui/tmp/${taskId}")
```

### Issue: fileKey missing / invalid

**原因**: 使用远程 MCP 时未传 `fileKey`，或 URL 解析错误

**解决**:
1. 从 URL `https://figma.com/design/:fileKey/:fileName?node-id=1-2` 提取 `/design/` 后的路径段
2. 远程 MCP 必须传 `fileKey`；桌面端 MCP 可省略
3. 确认 fileKey 格式正确（通常是字母数字混合字符串）

---

## 数据问题

### Issue: designContext 返回为空或被截断

**原因**: 节点过于复杂或嵌套层级过多

**解决**: 分块获取：
1. 调用 `get_metadata(fileKey, nodeId)` 获取节点结构概览
2. 从返回的 XML 中识别关键子节点的 nodeId
3. 对每个子节点分别调用 `get_design_context`，合并结果

---

## 资源问题

### Issue: 图片资源无法加载

**原因**: Figma MCP 资源端点不可访问

**解决**:
1. 确认 MCP 服务运行中
2. 直接使用 localhost URL，不要修改
3. 检查网络/防火墙

---

## Visual Review

### Issue: review后仍有 P0 问题

**原因**: 存在未修复的视觉问题

**解决**:
1. 检查问题清单中的 P0/P1 问题
2. 按修复建议逐条修复
3. 最多循环 3 次
4. 超过则请求用户指导

---

## 视觉验证

### Issue: 实现与设计不匹配

**原因**: 视觉细节偏差

**解决**: 对照 Phase A 截图逐项检查：
- [ ] 间距：padding、margin、gap
- [ ] 颜色：背景、文字、边框
- [ ] 字体：大小、粗细、行高
- [ ] 布局：对齐、尺寸、层级
- [ ] 边框：圆角、宽度、样式
- [ ] 阴影：有无、参数

### Issue: 设计令牌与实现不一致

**原因**: 项目设计令牌值与 Figma 设计值不同

**解决**:
1. 优先使用项目令牌保持一致性
2. 微调间距/尺寸保持视觉还原度
3. 在代码注释中记录偏差原因
