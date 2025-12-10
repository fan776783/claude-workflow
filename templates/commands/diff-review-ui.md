---
description: UI Diff 审查 - 基于 git diff 的前端/UI 专项代码审查
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git *), mcp__gemini__gemini(*)
examples:
  - /diff-review-ui
    审查未提交的 UI 代码变更
  - /diff-review-ui --staged
    审查已暂存的 UI 变更
  - /diff-review-ui --branch main
    审查当前分支相对 main 的所有 UI 变更
---

# UI Diff 代码审查

基于 git diff 的前端/UI 专项审查，整合 Claude 与 Gemini 双重视角。

## 命令对比

| 命令 | 适用场景 | 审查模型 |
|------|----------|----------|
| `/diff-review` | 快速日常检查 | Claude |
| `/diff-review-deep` | 重要功能/后端逻辑 | Claude + Codex |
| `/diff-review-ui` | 前端/UI 变更 | Claude + Gemini |

## 输入格式

根据用户指定的来源获取 diff：

| 参数 | 来源 | git 命令 |
|------|------|----------|
| (默认) | 未暂存变更 | `git diff` |
| `--staged` | 已暂存变更 | `git diff --cached` |
| `--all` | 全部未提交 | `git diff HEAD` |
| `--branch <base>` | 对比分支 | `git diff <base>...HEAD` |

## 文件过滤

自动识别 UI 相关文件，仅对以下类型进行审查：

```
# 组件文件
*.tsx, *.jsx, *.vue, *.svelte, *.astro, *.mdx

# 样式文件
*.css, *.scss, *.less, *.sass, *.pcss, *.postcss
*.module.css, *.module.scss
*.styled.ts, *.styled.tsx      # styled-components
*.css.ts                        # vanilla-extract
*.cva.ts                        # class-variance-authority

# 样式配置与设计令牌
tailwind.config.*, postcss.config.*
theme.ts, *.theme.ts, *.tokens.json

# Storybook
*.stories.tsx, *.stories.jsx, *.stories.mdx

# 静态资源
*.svg                           # SVG 图标
```

若 diff 中无 UI 相关文件，提示用户并建议使用 `/diff-review` 或 `/diff-review-deep`。

## 执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                     Phase 1: 获取 Diff                       │
├─────────────────────────────────────────────────────────────┤
│  1. 根据参数执行 git diff 命令                                │
│  2. 过滤出 UI 相关文件的变更                                  │
│  3. 若无 UI 文件，提示并退出（避免浪费配额）                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Phase 2: Claude 初审                        │
├─────────────────────────────────────────────────────────────┤
│  从代码质量角度审查：                                         │
│  - TypeScript 类型安全                                       │
│  - 组件 Props 设计                                           │
│  - 状态管理与数据获取                                         │
│  - 事件处理和副作用                                          │
│  - 渲染性能                                                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Phase 3: Gemini UI 专项审查                 │
├─────────────────────────────────────────────────────────────┤
│  从前端设计角度审查：                                         │
│  - 样式实现与动画                                            │
│  - 响应式与多模式（Dark/Light）                               │
│  - 可访问性（a11y）                                          │
│  - 交互状态与空态                                            │
│  - 组件复用与媒体优化                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Phase 4: 综合报告                           │
├─────────────────────────────────────────────────────────────┤
│  合并两轮审查结果：                                           │
│  - 按 P0→P3 排序，去重合并                                    │
│  - 标注问题来源（Claude/Gemini/Both）                         │
│  - 生成最终 Verdict 和 Confidence                            │
└─────────────────────────────────────────────────────────────┘
```

## 审查指南

### Claude 审查重点（代码质量）

1. **类型安全**：Props/State 类型定义是否完整
2. **组件设计**：Props 接口是否合理，是否过度耦合
3. **状态管理**：useState/useReducer 使用是否恰当
4. **副作用处理**：useEffect 依赖数组是否正确
5. **事件处理**：事件绑定、防抖节流是否合理
6. **渲染性能**：不必要的重渲染、大列表未虚拟化
7. **数据获取**：SWR/React Query 使用、缓存策略

### Gemini 审查重点（UI/UX 质量）

1. **样式实现**：Tailwind/CSS 使用是否规范，是否有冗余
2. **动画与过渡**：
   - 动画是否流畅、有意义
   - `prefers-reduced-motion` 兼容
3. **响应式设计**：
   - 移动端适配是否完整
   - 断点是否合理
4. **多模式支持**：
   - Dark/Light 模式切换
   - High-Contrast 模式兼容
5. **可访问性（a11y）**：
   - 语义化 HTML（button vs div）
   - ARIA 属性（`aria-label`, `aria-describedby`, `aria-live`）
   - 键盘导航与焦点管理
   - 颜色对比度
   - 表单 label 关联
   - 触控目标尺寸（≥44px）
   - 焦点陷阱与对话框关闭
6. **交互状态**：
   - hover/active/focus/disabled 覆盖
   - Loading/Error/Empty 状态
   - Skeleton/Placeholder
   - 触屏设备反馈
7. **组件复用**：是否应该抽取公共组件
8. **媒体优化**：
   - 图片格式与尺寸
   - 懒加载实现
   - `prefers-reduced-data` 考虑
9. **国际化（i18n）**：
   - RTL 布局支持（`dir="rtl"`）
   - 文本溢出处理

### 忽略的问题

- 纯后端逻辑变更（应使用 `/diff-review-deep`）
- 琐碎的样式偏好（除非违反项目规范）
- 预先存在的问题（非本次变更引入）

## 优先级与评分定义

### 优先级

| 级别 | 含义 | UI 场景示例 |
|------|------|------------|
| P0 | 紧急阻塞 | 页面崩溃、严重布局错乱、关键交互失效 |
| P1 | 紧急 | 可访问性严重缺失、移动端无法使用 |
| P2 | 正常 | 交互状态不完整、样式不规范 |
| P3 | 低优先级 | 轻微样式优化、代码可读性 |

### 评分基准

| 分数区间 | 含义 |
|----------|------|
| 90-100 | UI 质量优秀，可直接上线 |
| 70-89 | 基本可用，建议修复发现的问题 |
| 50-69 | 存在明显 UI 缺陷，需改动后上线 |
| < 50 | UI 质量差，应阻塞上线 |

## Gemini 调用规范

```typescript
// Phase 3: Gemini UI 专项审查
const geminiResult = await mcp__gemini__gemini({
  PROMPT: `You are a senior frontend developer and UI/UX expert. Review the following git diff for UI/frontend code quality.

## Important Constraints
- **Only review UI-related changes** (components, styles, layouts)
- Focus on what's changed in this diff, not pre-existing issues
- If context is insufficient, mark as [Uncertain] and state assumptions
- If the diff is truncated, note the missing scope first
- Sort findings by severity (P0→P3), limit to 8 issues

## Changed Files
${uiFiles.join('\n')}

## Diff Content
\`\`\`diff
${diffContent}
\`\`\`

${truncatedFiles.length > 0 ? `## Truncated Files (not reviewed)\n${truncatedFiles.join('\n')}` : ''}

## Review Focus Areas

### 1. Styling & Animation
- Is Tailwind/CSS usage idiomatic and efficient?
- Any redundant or conflicting styles?
- Are design tokens/variables used appropriately?
- Are animations meaningful and respect \`prefers-reduced-motion\`?

### 2. Responsive & Multi-mode
- Is mobile-first approach followed?
- Are breakpoints consistent with project standards?
- Dark/Light mode support?
- High-contrast mode compatibility?

### 3. Accessibility (a11y)
- Semantic HTML elements (button vs div, etc.)
- ARIA attributes (\`aria-label\`, \`aria-describedby\`, \`aria-live\`)
- Keyboard navigation and focus management
- Focus traps and dialog close handling
- Color contrast compliance
- Form label associations
- Touch target size (≥44px)

### 4. Interaction States
- hover, active, focus, disabled states covered?
- Loading, error, empty states handled?
- Skeleton/placeholder for async content?
- Touch device feedback?

### 5. Component & Media
- Should any code be extracted to reusable components?
- Are existing components being reused appropriately?
- Image format, sizing, and lazy loading?
- \`prefers-reduced-data\` consideration?

### 6. Internationalization
- RTL layout support (\`dir="rtl"\`)?
- Text overflow handling for translations?

## Output Format

### Gemini UI Review Score
**Score**: X/100
> Scoring: 90+=Excellent | 70-89=Good with issues | 50-69=Needs work | <50=Poor

### Findings

List up to 8 issues, sorted by priority (P0→P3):

#### [PX] Issue Title
- **File**: \`file path\`
- **Lines**: start-end
- **Category**: Styling/Responsive/Accessibility/Interaction/Component/Media/i18n
- **Impact**: Description of user impact
- **Suggestion**: How to fix (code snippet if helpful, max 3 lines)
- **[Uncertain]**: (optional) Missing context or assumptions made

If no issues found: **No findings from Gemini UI review.**`,
  sandbox: false
});
```

**⚠️ Gemini 使用注意**：
- 上下文有效长度**仅为 32k**，大 diff 需截断
- 仅传入 UI 相关文件的 diff，过滤后端代码
- 严禁让 Gemini 审查后端逻辑

## 输出格式

```
# UI Review Report

## Summary
| Field | Value |
|-------|-------|
| Verdict | ✅ CORRECT / ❌ INCORRECT |
| Confidence | 0.XX |
| Claude Score | XX/100 |
| Gemini Score | XX/100 |
| Gemini Status | success / degraded / failed |
| UI Files | X / Y total files |
| Truncated | true / false |
| Truncated Files | file1.tsx, file2.css (if any) |

**Explanation**: <综合两轮审查的结论>

---

## Claude Findings (Code Quality)

> 如无发现，输出：**No findings from Claude review.**

### [PX] <标题>
| Field | Value |
|-------|-------|
| File | `<文件路径>` |
| Lines | <start>-<end> |
| Source | Claude |
| Severity | P0/P1/P2/P3 |
| Category | Types/Props/State/Effects/Events/Rendering/DataFetching |

<问题说明>

```suggestion
<可选修复代码，限 3 行>
```

---

## Gemini Findings (UI/UX Quality)

> 如无发现，输出：**No findings from Gemini UI review.**
> 若 Gemini 调用失败，输出：**Gemini review degraded: <原因>**

### [PX] <标题>
| Field | Value |
|-------|-------|
| File | `<文件路径>` |
| Lines | <start>-<end> |
| Source | Gemini |
| Severity | P0/P1/P2/P3 |
| Category | Styling/Responsive/Accessibility/Interaction/Component/Media/i18n |
| Impact | <用户影响> |

<问题说明>

**[Uncertain]**: <若有不确定性，说明缺失信息或假设>

```suggestion
<可选修复代码，限 3 行>
```

---

## Cross-Review Consensus

> 两个模型都发现的问题（高置信度）
> 匹配规则：同一文件 + 行号区间重叠（±5行容差）+ 关键词相似

### [PX] <标题>
| Field | Value |
|-------|-------|
| File | `<文件路径>` |
| Lines | <start>-<end> |
| Source | Both |
| Severity | P0/P1/P2/P3 |
| Confidence | 0.XX (elevated +0.15) |

<综合说明>

---

## Review Statistics
| Metric | Value |
|--------|-------|
| UI Files Reviewed | X |
| Non-UI Files Skipped | X |
| Truncated Files | X |
| Lines Changed | +X / -X |
| Claude Findings | X |
| Gemini Findings | X |
| Consensus Issues | X |
| Gemini Call Status | success/degraded/failed |
```

## 格式规则

1. **Summary 表格**：包含双模型评分、Gemini 状态、UI 文件比例、截断信息
2. **分区输出**：Claude Findings（代码质量）、Gemini Findings（UI/UX 质量）、Cross-Review Consensus
3. **Category 区分**：
   - Claude: Types/Props/State/Effects/Events/Rendering/DataFetching
   - Gemini: Styling/Responsive/Accessibility/Interaction/Component/Media/i18n
4. **Impact 字段**：Gemini Findings 必须说明用户影响
5. **优先级排序**：所有 Findings 按 P0→P3 排序输出
6. **Consensus 匹配**：同一文件 + 行号重叠（±5行容差）+ 关键词相似
7. **Statistics**：统计 UI 文件、非 UI 文件、截断文件数量

## 降级与容错

### Gemini 调用失败

若 Gemini 调用失败：
1. Summary 中 `Gemini Status` 设为 `failed`
2. `Gemini Score` 设为 `N/A`
3. Gemini Findings 区块输出：`**Gemini review failed: <错误原因>**`
4. 可选：Claude 生成"UI 关注点待检查"占位清单提醒人工复核
5. 最终 Verdict 仅基于 Claude 审查结果
6. Confidence 降低 0.2

### 大 Diff 处理

若 UI 文件 diff 超过 4000 行（Gemini 32k 限制）：
1. Summary 标注 `Truncated: true` 并列出被截断的文件
2. 按风险排序分片：组件文件 → 交互复杂度高 → 纯样式文件
3. 优先保留 `.tsx/.jsx/.vue`，截断纯 `.css/.scss`
4. 在 Explanation 中说明截断情况和受影响的审查范围

### 无 UI 文件

若 diff 中无 UI 相关文件：
1. 输出提示：`No UI files detected in this diff.`
2. 建议使用 `/diff-review` 或 `/diff-review-deep`
3. 不执行后续审查流程，避免浪费配额

## Verdict 综合规则

| 场景 | Verdict 规则 |
|------|-------------|
| 双模型均无 P0/P1 | ✅ CORRECT |
| 任一模型发现 P0 | ❌ INCORRECT |
| Gemini 发现 P1 可访问性问题 | ❌ INCORRECT |
| Consensus 存在 P1+ | ❌ INCORRECT |
| Gemini 失败，Claude 无 P0/P1 | ✅ CORRECT (degraded) |

**工作目录**：当前项目目录（自动识别 `process.cwd()`）
