# 视觉审查维度

Visual Review 的详细审查标准。

## 目录

- [视觉还原度](#视觉还原度)
- [可访问性](#可访问性)
- [代码质量](#代码质量)
- [常见问题模式](#常见问题模式)
- [交付门控](#交付门控)

---

## 视觉还原度

### 间距 (Spacing)

| 检查点 | P0 问题 | P1 问题 |
|--------|---------|---------|
| 外边距 | 偏差 > 8px | 偏差 4-8px |
| 内边距 | 偏差 > 8px | 偏差 4-8px |
| 元素间距 | 偏差 > 4px | 偏差 2-4px |

```css
/* ✅ 精确还原 */
padding: 32px 24px 24px;
gap: 16px;

/* ❌ 近似值 */
padding: 30px 25px;
gap: 15px;
```

### 颜色 (Color)

| 检查点 | P0 问题 | P1 问题 |
|--------|---------|---------|
| 背景色 | 明显色差 | 轻微色差 |
| 文字色 | 对比度不足 | 透明度偏差 |
| 边框色 | 颜色错误 | 透明度偏差 |

```css
/* ✅ 使用原值 + fallback */
background: var(--fill-light-02, rgba(194, 204, 241, 0.08));
color: var(--texticon-02hover, rgba(255, 255, 255, 0.9));

/* ❌ 硬编码近似值 */
background: rgba(200, 210, 240, 0.1);
```

### 字体 (Typography)

| 检查点 | P0 问题 | P1 问题 |
|--------|---------|---------|
| 字号 | 偏差 > 2px | 偏差 1-2px |
| 字重 | 错误（400 vs 700） | 相近（500 vs 600） |
| 行高 | 偏差 > 4px | 偏差 2-4px |

```css
/* ✅ 精确还原 */
font-size: 20px;
font-weight: 700;
line-height: 28px;

/* ❌ 使用相对单位导致偏差 */
font-size: 1.25rem;  /* 可能不是 20px */
```

### 布局 (Layout)

| 检查点 | P0 问题 | P1 问题 |
|--------|---------|---------|
| 对齐方式 | 左对齐 vs 居中 | 微调偏差 |
| 尺寸 | 宽高错误 | 比例偏差 |
| 层级 | z-index 错误 | 遮挡问题 |

### 边框 (Border)

| 检查点 | P0 问题 | P1 问题 |
|--------|---------|---------|
| 圆角 | 偏差 > 4px | 偏差 2-4px |
| 边框宽度 | 有无差异 | 粗细偏差 |
| 边框样式 | solid vs dashed | 颜色偏差 |

### 阴影 (Shadow)

| 检查点 | P0 问题 | P1 问题 |
|--------|---------|---------|
| 有无阴影 | 缺失/多余 | - |
| 阴影参数 | 明显偏差 | 轻微偏差 |

### 资源粒度 (Asset Granularity)

| 检查点 | P0 问题 | P1 问题 |
|--------|---------|---------|
| 复合图形 | 错把父图形拆成多个子资源 | 可通过父节点重导出改善 |
| 资源引用 | 使用错误图层或残留 hash 文件名 | 命名不语义化 |

---

## 可访问性

### 语义标签

```html
<!-- ✅ 正确 -->
<button type="button" onclick="close()">关闭</button>
<nav>导航</nav>
<main>主内容</main>

<!-- ❌ 错误 -->
<div onclick="close()">关闭</div>
<div class="nav">导航</div>
```

### ARIA 属性

```html
<!-- 图标按钮必须有 aria-label -->
<button aria-label="关闭弹窗">
  <svg>...</svg>
</button>

<!-- 表单元素关联 label -->
<label for="name">姓名</label>
<input id="name" type="text" />
```

### 键盘支持

可交互元素应支持键盘操作：
- 可聚焦元素添加 `tabindex="0"`
- 支持 Enter / Space 触发操作
- 使用正确的 `role` 属性

```html
<!-- 非按钮元素需要补充键盘支持 -->
<div role="button" tabindex="0">可点击区域</div>
```

### 对比度

| 文本类型 | 最小对比度 |
|----------|-----------|
| 正文 | 4.5:1 (WCAG AA) |
| 大文本 (18px+) | 3:1 |
| UI 组件 | 3:1 |

---

## 代码质量

### 组件结构

| 检查点 | 好的实践 | 问题示例 |
|--------|----------|----------|
| 组件大小 | < 300 行 | 单文件 800+ 行 |
| 嵌套层级 | < 5 层 | div 套 div 超过 7 层 |
| Props 设计 | 类型明确 | any 类型 |

### 样式隔离

避免全局样式污染，根据项目框架选择合适的隔离方案：

| 方案 | 适用场景 | 示例 |
|------|----------|------|
| Scoped styles | Vue SFC | `<style scoped>` |
| CSS Modules | React / Vue / 通用 | `import styles from './Button.module.css'` |
| BEM 命名 | 无框架约束时 | `.block__element--modifier` |

### 命名规范

```javascript
// ✅ 语义化命名
const handleClose = () => {};
const isDialogVisible = false;

// ❌ 模糊命名
const fn = () => {};
const flag = false;
```

---

## 常见问题模式

### P0 级（必须修复）

```css
/* 布局错位 */
.container {
  display: block;  /* 应该是 flex */
}

/* 颜色明显偏差 */
background: #1a1a1a;  /* 设计稿是 #1d1d25 */
```

```html
<!-- 缺少语义标签 -->
<div class="btn" onclick="submit()">提交</div>
<!-- 应该是 -->
<button type="submit">提交</button>
```

```text
复合插画被拆成多个子 SVG，导致实现靠 CSS 叠加定位。
→ 应回退到父节点重导出单张资源。
```

### P1 级（应修复）

```css
/* 间距偏差 */
padding: 30px;  /* 设计稿是 32px */
gap: 15px;      /* 设计稿是 16px */

/* 字体细节 */
font-weight: 600;  /* 设计稿是 700 */
```

```html
<!-- 缺少 aria-label -->
<button><svg>...</svg></button>
<!-- 应该是 -->
<button aria-label="关闭"><svg>...</svg></button>
```

```text
资源名称仍是 hash 或语义不明，导致后续维护困难。
→ 应在 Asset Triage 阶段先完成语义化命名。
```

### P2 级（建议修复）

```javascript
// 命名不规范
const d = new Date();
// 应该是
const currentDate = new Date();
```

```css
/* 可简化的样式 */
margin-top: 0;
margin-right: 0;
margin-bottom: 0;
margin-left: 0;
/* 应该是 */
margin: 0;
```

---

## 交付门控

审查完成后，按问题清单中最高严重程度决定交付：

| 条件 | 决策 |
|------|------|
| 无 P0 问题 | ✅ 可交付 |
| 仅剩 P1 问题 | ⚠️ 可交付，摘要中列出未修复的 P1 |
| 仍有 P0 问题 | ❌ 不可交付，进入修复循环或请求用户指导 |

修复循环最多 3 轮，每轮优先处理 P0，再处理 P1。超过 3 轮仍有 P0 时停止推进。
