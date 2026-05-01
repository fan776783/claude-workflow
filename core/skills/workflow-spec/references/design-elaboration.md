# 设计深化指南（Step 4.D）

> Step 4 Spec 文本扩写完成后、Step 4.5 Codex Review 之前的条件阶段。

## 触发与分支

| 信号 | 前端 | 后端 | 全栈 |
|------|------|------|------|
| `ux_gate_required=true` | ✓ | — | ✓ |
| § 5.1 含 API/Service/DB 模块 | — | ✓ | ✓ |

纯 CLI / 工具类项目跳过本阶段。

---

## 分支详情

- **前端分支（§ 4.4 UX & UI Design）**：见 [design-elaboration-frontend.md](./design-elaboration-frontend.md)
- **后端分支（§ 5.6 System Design）**：见 [design-elaboration-backend.md](./design-elaboration-backend.md)

---

## 全栈项目执行策略

1. 主会话完成 § 4.4.1 User Flow + § 4.4.2 Page Hierarchy
2. 主会话执行设计稿关联交互
3. **并行**：主会话 → § 5.6 后端系统设计，子 Agent → § 4.4.3 布局锚点提取
4. 回收子 Agent 产出，合并写入 spec.md

---

## 错误处理

| 场景 | 处理 |
|------|------|
| Figma MCP 不可用 | 提示用户改用截图路径，或标记为 infer |
| 子 Agent 超时 | 降级为 infer，不阻塞 |
| 截图无法识别 | 标记人工补充 |
| 用户全部选 skip | 所有页面走 infer，主会话内联 |
| Figma URL 无 node-id | `get_metadata(fileKey)` 列出 frame，让用户选择 |
