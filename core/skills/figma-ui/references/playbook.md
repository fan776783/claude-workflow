# Figma UI Playbook — Phase B/C 详细执行

> Phase A（设计获取 + 资源分诊）已迁移至 `figma-data` skill。本文件覆盖 Phase B（编码）和 Phase C（验证 + 修复）的字段定义、详细步骤、示例与降级方案。
>
> ⚠️ `taskType=CHANGE_ARTIFACT`（修改已有页面）时，编码前必经 Phase B.0（ChangeManifest 构建），Phase C 走对账分支——两者见 [`change-playbook.md`](./change-playbook.md)。本文件的 Phase B/C 步骤是 CREATE_ARTIFACT 主路径。

---

## Phase B: 编码

### 输入

来自 figma-data 的 Design Package：
- `ElementManifest`、`AssetPlan`、`DesignInventory`（CHANGE_ARTIFACT 时）
- `designContext`、`screenshot`、`taskDir`
- CHANGE_ARTIFACT 时另有 Phase B.0 产出的 `change-manifest.md`（`status: confirmed`）

### 项目适配原则

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

### 编码规范

| 规范 | 说明 |
|------|------|
| **视觉优先** | 像素级还原，不做主观"优化" |
| **保留原值** | 使用 Figma 原始值 + CSS 变量 fallback |
| **最小包装** | 避免不必要的组件包装层 |
| **Mock 数据** | 使用设计稿原文，跳过 i18n |

代码质量的详细检查标准见 [`./visual-review.md#代码质量`](./visual-review.md#代码质量)。

### 样式策略

按项目 convention 选择样式方案。核心原则：**保留 Figma 原始数值，不用近似值**。

| 项目方案 | 做法 |
|---------|------|
| Tailwind | 用 arbitrary values 保留原值：`bg-[rgba(194,204,241,0.08)]`；有项目令牌时优先令牌 |
| CSS Modules / Scoped | 用 CSS 变量 + Figma 原值作 fallback |
| 设计令牌体系 | 映射到已有令牌；无法映射时保留原值 |

```text
✅ rgba(194, 204, 241, 0.08)  — Figma 原值
❌ rgba(200, 210, 240, 0.1)   — 近似值（视觉可能一样但追溯困难）
```

从 `.claude/code-specs` 或项目现有代码推断当前使用的方案，不要假设一定用 Tailwind。

### 资源消费约束

编码阶段只允许消费两类结果：
1. `AssetPlan.decision = inline`：直接用代码表达
2. `AssetPlan.decision = promote`：引用已命名资源引用

不要在编码阶段临时决定资源去留、直接引用 hash 文件名或从任务目录外"借用"资源。

### 编码收口

编码完成后，只提升 `promote` 资源到正式目录：
1. 遍历 AssetPlan 中 `decision = promote` 的条目
2. 在 `assetsDir` 下创建 `targetDir`
3. 将 `originalFile` 移动并重命名为 `targetName`

---

## Phase C: 验证 + 修复

### 输入
- Phase B 的最终实现代码
- `ElementManifest`、`AssetPlan`、`DesignInventory`（如有）、设计上下文、截图
- CHANGE_ARTIFACT 时：`change-manifest.md`（C.1Δ / C.2a / C.4 对账输入，见 [`change-playbook.md`](./change-playbook.md)）

### C.1 覆盖率检查

对照 `ElementManifest`，确保 P0/P1 元素已实现。有遗漏则返回 Phase B 补充。CHANGE_ARTIFACT 时本检查由 C.1Δ delta 覆盖对账取代（元素"存在"不等于"已按新设计更新"）。

### C.1.5 Anchor Verification（数值机械比对）

CREATE_ARTIFACT：比对域 = 根容器及关键子容器的数值属性，设计值在 C.1.5 执行时从 designContext 提取。CHANGE_ARTIFACT：比对域 = ChangeManifest 全部 entry × sites（逐 site 重读编辑后代码值，设计值来自 DesignInventory）。逐条比对设计值与代码实际值，输出比对表：

```text
| 属性           | 设计值              | 代码值              | 判定 |
|----------------|---------------------|---------------------|------|
| width          | 900px               | 880px               | ❌ P0 |
| height         | 720px               | (未设置)            | ❌ P0 |
| padding        | 32px 24px 24px      | 32px 24px 24px      | ✅    |
| border-radius  | 16px                | 16px                | ✅    |
```

width/height 不匹配直接标记为 P0；padding、border-radius、gap 等属性参照 visual-review.md 已有分级阈值判定 severity（如 padding 偏差 4-8px 为 P1，>8px 为 P0）。这一步是机械比对，不依赖截图目测，专门防止"看起来差不多但数值不对"的问题。

### C.2 Visual Review

对照设计数据和截图，review 实现与设计稿的视觉一致性。输出**问题清单**，按严重程度分级（分级表见主 SKILL.md）。

review 重点：
1. 视觉还原度：间距、颜色、字体、布局、边框、阴影
2. 可访问性：语义标签、ARIA、键盘支持
3. 代码质量：结构清晰、样式隔离

### C.3 修复循环

```text
有 P0 问题 → 必须修复
有 P1 问题 → 应修复（每轮优先处理 P0，再处理 P1）
最多 3 轮，超过则请求用户指导
```

### C.4 交付决策

| 条件 | 决策 |
|------|------|
| 无 P0 问题 | ✅ 可交付 |
| 仅剩 P1 问题 | ⚠️ 可交付，摘要中列出未修复的 P1 |
| 仍有 P0 问题 | ❌ 不可交付，请求用户指导 |

### C.5 交付摘要

```text
┌──────────────┬────────────────────────────────────────────┐
│     项目     │                    内容                    │
├──────────────┼────────────────────────────────────────────┤
│ 新建文件     │ components/xxx/ComponentName.vue           │
│ 修改文件     │ pages/test/index.vue（添加入口）            │
│ 资源目录     │ public/images/xxx/                         │
│ AssetPlan    │ promote: N / inline: N / discard: N        │
├──────────────┼────────────────────────────────────────────┤
│ 审查结果     │ P0: 0 / P1: N / P2: N                      │
│ 未修复 P1    │ （如有，逐条列出）                          │
│ 对账证据     │ （CHANGE 时必填：entry 终态统计 +           │
│ (CHANGE)     │  residue preCount→afterCount，引用          │
│              │  _coverage.md / _residue.md 实际内容）      │
├──────────────┼────────────────────────────────────────────┤
│ 临时目录     │ ✅ 当前任务临时资源已收口                  │
└──────────────┴────────────────────────────────────────────┘
```

---

## Examples

### 示例 1: 实现按钮组件

用户提供：`https://figma.com/design/kL9xQn2VwM8pYrTb4ZcHjF/DesignSystem?node-id=42-15`

执行 workflow：
```bash
# Phase A（figma-data 执行）
node core/skills/figma-data/cli/figma.mjs design --url "https://figma.com/design/kL9xQn2VwM8pYrTb4ZcHjF/DesignSystem?node-id=42-15" --taskId btn-primary
# → 产出 Design Package

# Phase B（本 skill 执行）
# 1. 检查项目是否有现成按钮组件 → 有则扩展变体，无则按项目规范新建
# 2. 将 Figma 颜色映射到项目设计令牌
# 3. 编码收口：promote 资源移入正式目录

# Phase C
# 4. 对照 _screenshot.png 验证 padding、border-radius、字体
# 5. 清理
node core/skills/figma-data/cli/figma.mjs cleanup --taskId btn-primary
```

### 示例 2: 实现 Dashboard 页面

用户提供：`https://figma.com/design/pR8mNv5KqXzGwY2JtCfL4D/Dashboard?node-id=10-5`

执行 workflow：
```bash
# Phase A（figma-data 执行，分块获取）
node core/skills/figma-data/cli/figma.mjs get_metadata --nodeId 10:5
node core/skills/figma-data/cli/figma.mjs design --nodeId 20:1 --taskId dash-header
node core/skills/figma-data/cli/figma.mjs design --nodeId 20:2 --taskId dash-sidebar
node core/skills/figma-data/cli/figma.mjs design --nodeId 20:3 --taskId dash-content
# → 各区块 Design Package

# Phase B（本 skill 执行）
# 各区块编码 + 资源收口

# Phase C
node core/skills/figma-data/cli/figma.mjs screenshot --nodeId 10:5 --outDir ./screenshots
# Visual Review → 修复循环 → 交付

node core/skills/figma-data/cli/figma.mjs cleanup
```

---

## 降级方案

### 复杂页面

对于复杂页面（多个独立区块），figma-data 分块产出 Design Package 后：
1. 各区块独立编码
2. 分块验证
3. 整页截图做最终 Visual Review

### 设计偏差处理

项目设计令牌与 Figma 值不一致时：
- 优先使用项目令牌保持一致性
- 微调间距和尺寸保持视觉还原度
- 在代码注释中记录偏差原因
