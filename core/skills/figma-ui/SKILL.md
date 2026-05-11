---
name: figma-ui
description: "Use when 用户提供 Figma URL 并有明确的代码实现意图（实现/还原/构建/写/改/调/做/convert/implement/restore/build/match/create code）; or 引用现有文件说「按设计稿还原/调整/检查还原度」「和设计不一致」; or 要求换 icon/资源为设计稿里的。仅提供 URL 而无实现动作词（读取/查看/提取/导出/分析）时不触发,走 figma-data。Figma 画布操作(create/edit/delete nodes)走 figma-use。"
---

<CONTEXT>
开始写组件代码前 Read `.claude/code-specs/{pkg}/{layer}/index.md`（按涉及文件映射）+ `core/specs/shared/glossary.md`。设计稿获取 + 分诊阶段可跳过。
</CONTEXT>

# Figma UI 实现 workflow（Web）

> 默认主路径：**先通过 figma-data 完成设计获取与资源分诊，再编码，最后用视觉 review 决定是否允许交付**。
>
> ⚠️ Phase A（设计获取 + 资源分诊）由 `figma-data` skill 负责。本 skill 从 Design Package 开始，只做 Phase B（编码）+ Phase C（验证）。

## 依赖

- **figma-data** — 提供 Design Package（designContext + ElementManifest + DesignAnchors + AssetPlan）
- CLI 路径：`core/skills/figma-data/cli/figma.mjs`（截图等验证命令仍需调用）

## Skill Boundaries

| 任务 | 用哪个 skill |
|------|------------|
| Figma MCP 连接 + 设计数据获取 + 资源分诊 → Design Package | `figma-data` |
| Design Package → Web 代码实现 + 验证 | **本 skill** |
| 在 Figma 画布上 create / edit / delete 节点 | `figma-use` |
| 从代码或描述生成完整页面设计稿 | `figma-generate-design` |
| 生成 Code Connect 映射 | `figma-code-connect` |
| 生成 design system 规则(CLAUDE.md / AGENTS.md) | `figma-create-design-system-rules` |

## Core Rules

- **Design Package 就绪才编码** — 必须有完整的 AssetPlan 和 ElementManifest 才进入 Phase B
- **promote-only 到正式目录** — 正式资源目录只接收 AssetPlan 中 `promote` 的资源
- **视觉优先** — 精确还原，不做主观"优化"。项目令牌与 Figma 值冲突时优先项目令牌，但微调间距/尺寸维持视觉还原度
- **review 后交付** — 未完成 Visual Review 不宣称完成
- **P0 阻断交付** — review 后仍有 P0 时不按"已完成"收口
- **修复上限 3 轮** — 超过 3 轮仍有 P0 时停止推进并请求用户判断
- **当前模型直接实现** — 不调用外部模型代写 UI

## 执行步骤

### Phase A: 设计获取 + 资源分诊（委托 figma-data）

执行 `figma-data` skill 的完整流程，获得 Design Package：
- `taskId`, `taskDir`, `screenshot`
- `designContext`
- `ElementManifest`（P0/P1/P2 元素 checklist）
- `DesignAnchors`（CHANGE_ARTIFACT 时）
- `AssetPlan`（每个资源的 decision + targetName）

**Gate → Phase B**: Design Package 就绪（AssetPlan 完成且无 `refetch-parent`）。

**Abort → Exit**: figma-data 返回降级产出（无 AssetPlan，仅 screenshot + metadata）时：
- 将截图 + 节点结构呈现给用户
- 告知 Phase B 无法启动（缺少 designContext + AssetPlan）
- 提供修复步骤：① Figma Desktop → Preferences → Dev Mode MCP → Allowed directories 添加项目路径；② 或切换 Remote MCP（`claude mcp add figma-mcp --transport http --url https://mcp.figma.com/mcp`）
- **停止 workflow，不继续编码**

### Phase B: 编码

1. **项目适配** — 将 Figma 参考代码转为项目框架/设计系统/convention
2. **只消费 AssetPlan 中的资源** — `inline` 用代码表达，`promote` 用已命名资源引用
3. **编码收口** — 将 `promote` 资源移入正式目录并重命名

**Gate → Phase C**: 代码完成，正式目录只含 promote 资源。

### Phase C: 验证 + 修复

4. **覆盖率检查** — 对照 ElementManifest 确认 P0/P1 元素全部实现
5. **Anchor Verification**（有 DesignAnchors 时） — 机械比对数值，width/height 不匹配 = P0
6. **Visual Review** — 对照截图输出问题清单，按 P0/P1/P2 分级
7. **修复循环** — 有 P0 则修复并重新 review，最多 3 轮
8. **交付决策** — 无 P0 可交付；仍有 P0 则请求用户指导

**Exit**: 无 P0 + 已出交付摘要 + 临时目录已 cleanup。

## 项目适配原则

Figma MCP 输出通常是 React + Tailwind 格式，需转换为项目实际框架与 convention：
- Tailwind 工具类替换为项目偏好的样式方案或设计令牌
- 复用项目现有组件（按钮、输入框、排版、图标包装器），不重复造轮子
- 使用项目的颜色体系、字体规范和间距令牌
- 遵循项目的路由、状态管理和数据获取模式

### 设计系统集成

| 场景 | 策略 |
|------|------|
| 项目组件完全匹配设计 | 直接复用 |
| 项目组件大致匹配，需微调 | 扩展现有组件，添加变体 |
| 需要大量覆盖样式 | 新建组件（避免样式冲突） |
| 项目无对应组件 | 按项目设计系统规范新建 |

设计令牌映射：
- 优先将 Figma 变量映射到项目已有的设计令牌
- 项目令牌与 Figma 值冲突时，优先使用项目令牌，但微调间距/尺寸保持视觉一致
- 无法映射时保留 Figma 原值 + CSS 变量 fallback

### 样式策略

按项目 convention 选择样式方案。核心原则：**保留 Figma 原始数值，不用近似值**。

| 项目方案 | 做法 |
|---------|------|
| Tailwind | 用 arbitrary values 保留原值：`bg-[rgba(194,204,241,0.08)]`；有项目令牌时优先令牌 |
| CSS Modules / Scoped | 用 CSS 变量 + Figma 原值作 fallback |
| 设计令牌体系 | 映射到已有令牌；无法映射时保留原值 |

从 `.claude/code-specs` 或项目现有代码推断当前使用的方案，不要假设一定用 Tailwind。

### 资源消费约束

编码阶段只允许消费两类结果：
1. `AssetPlan.decision = inline`：直接用代码表达
2. `AssetPlan.decision = promote`：引用已命名资源

不要在编码阶段临时决定资源去留、直接引用 hash 文件名或从任务目录外"借用"资源。

## Visual Review 严重程度

| 严重程度 | 含义 | 交付影响 |
|----------|------|----------|
| **P0** | 布局错位、颜色明显偏差、关键元素缺失 | **必须修复才能交付** |
| **P1** | 间距微调(2-8px)、字体细节、透明度偏差 | 应修复，不阻塞交付 |
| **P2** | 装饰细节、可简化样式、命名规范 | 建议修复 |

每个问题包含：元素名称、问题类别(spacing / color / typography / layout / border / shadow / accessibility)、设计稿值、实现值、修复建议。详细 review 维度见 [`references/visual-review.md`](references/visual-review.md)。

## Red Flags

| 念头 | 修正 |
|------|------|
| "Design Package 还没完整就先写页面" | 回 Phase A，等 figma-data 完成 |
| "先用 hash 文件名，最后统一改" | 回 AssetPlan 资源命名 |
| "目测差不多，不必 review" | 回 Phase C step 6 |
| "先说完成，回头补 review" | 回 Phase C step 8 |

## 参考文档

- [`references/playbook.md`](references/playbook.md) — Phase B/C 详细执行流程
- [`references/visual-review.md`](references/visual-review.md) — 视觉 review 维度
- `figma-data` skill — Phase A 执行流程 + MCP 参数 + 故障排查
