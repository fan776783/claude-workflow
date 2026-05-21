# UI Prototype

在一个路由上生成**多个结构性不同的 UI 变体**,用浮动底栏切换。用户在浏览器里翻,选一个(或从几个里拼),然后丢掉其余。

如果问题是关于逻辑/状态而非外观 → 错分支,用 [LOGIC.md](LOGIC.md)。

## 何时用

- "这个页面应该长什么样?"
- "想看几个方案再决定"
- "换个布局试试"
- 任何用户会花一天在脑子里比较三个模糊 mockup 的场景

## 两种子形态——强烈偏好 A

UI prototype 在**真实上下文中**更容易判断——真 header、真 sidebar、真数据密度。独立路由是真空:每个变体单独看都行。

### Sub-shape A — 现有页面内变体(默认)

路由已存在。变体用 `?variant=` URL 参数门控,在**同一路由**渲染。已有的 data fetching / params / auth 不动,只换渲染子树。

如果要 prototype 的东西还没有页面但**自然属于某个页面**(dashboard 新 section / settings 新 card / 已有 flow 新步骤)→ 仍是 A。挂在 host 页面内。

### Sub-shape B — 新路由(最后手段)

仅当要 prototype 的东西确实没有任何现有页面可以宿主时——全新 top-level surface / 无法嵌入的 flow。

创建 throwaway 路由,遵循项目已有路由 convention。路径或文件名含 `prototype` 字样。同样 `?variant=` 模式。

选 B 前自问:真的没有现有页面可以嵌入?空路由隐藏了有填充页面才会暴露的设计问题。

## workflow

### 1. 明确问题,定 N 个变体

默认 **3 个**。超过 5 个不再是"结构性不同"而是噪声。

一行写清计划:`"Settings 页面三个变体,通过 ?variant= 切换,在现有 /settings 路由上。"`

### 2. 生成结构性不同的变体

每个变体必须:
- 服务于页面的目的和可用数据
- 使用项目的组件库/样式系统(Tailwind / shadcn / MUI / plain CSS)
- 导出清晰组件名:`VariantA` / `VariantB` / `VariantC`

**变体必须结构性不同** — 不同布局、不同信息层级、不同主 affordance。三个微调过的 card grid 不是 UI prototype,是壁纸。两个变体太像 → 重做一个,显式约束"不用 card grid"。

### 3. 接线

路由上一个 switcher 组件:

```tsx
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

Sub-shape A: data fetching 在 switcher 上面不动。Sub-shape B: throwaway 路由挂同样 switcher。

### 4. 浮动切换栏

固定底部居中,三要素:左箭头 / 变体标签 / 右箭头。

行为:
- 点击箭头更新 URL search param(用框架 router),reload-stable
- ← → 键盘也能切(input/textarea/contenteditable 获焦时不截获)
- 视觉上与页面内容明显不同(高对比 pill + shadow)
- `NODE_ENV !== 'production'` 时才显示

放在项目 shared UI 目录,两种 sub-shape 复用。

### 5. 交给用户

展示 URL + variant 参数。典型反馈:"想要 B 的 header + C 的 sidebar"——这才是真实设计。

### 6. 捕获答案 + 清理

赢家确定后记录哪个、为什么(commit message / ADR / NOTES.md)。然后:
- **Sub-shape A** — 删败者变体 + switcher,赢家 fold 进现有页面
- **Sub-shape B** — 赢家提升为正式路由,删 throwaway 路由 + switcher

不留变体组件和 switcher 烂尾。

## Anti-patterns

- 变体只差颜色/文案 — tweak ≠ prototype
- 变体间共享太多代码 — 共享 `<Header>` 行,共享 `<Layout>` 不行,否则无法独立探索布局
- 变体连真实 mutation — 只读 prototype 够了;需要 mutate 就指向 stub
- 把 prototype 代码直接发布 — prototype 约束下写的(无测试、最小 error handling),fold 时重写
