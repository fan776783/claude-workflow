# HTML Report

候选展示的可视化模式。默认走 SKILL.md §3 的 markdown 列表;用户说「出可视化报告 / HTML / 图表」时走本协议。

自包含单 HTML 文件,Tailwind + Mermaid 走 CDN,落到 `~/.claude/tmp/architecture-review-{YYYYMMDD-HHmm}.html`(目录不存在则创建),写完用对应平台命令打开:
- macOS: `open <path>`
- Linux: `xdg-open <path>`
- Windows: `start <path>`

打开后告诉用户绝对路径。

## 设计原则

- **图扛叙述权重**,文字稀疏。一张图需要一段话才能看懂 → 重画
- **Mermaid 处理 graph 类**(依赖、调用流、时序);**手写 div / 内联 SVG 处理 editorial 类**(mass diagram、剖面、collapse)。混用,别全 Mermaid → 同质化
- **每张图都是 before/after 并排**。单边图没意义
- 术语用 `core/specs/shared/architecture-language.md`(Module / Interface / Seam / Depth 等)。domain 概念用 `core/specs/shared/glossary.md`
- 不堆 UI 控件、不放交互、不放序号——schematic 风格,不是 dashboard

## 脚手架

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review — {{repo}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

repo 名 + 日期 + 紧凑图例(实线方块=module / 虚线=seam / 红箭头=leakage / 厚黑边=deep module)。

## Candidate Card

每个候选一个 `<article>`,字段:

- **Title** — 一句话命名 deepening(如「Collapse Order intake pipeline」)
- **Badge row** — Strength badge(枚举值见 SKILL.md §3,色映射:Strong=emerald / Worth exploring=amber / Speculative=slate)+ 依赖分类 tag(`in-process` / `local-substitutable` / `ports & adapters` / `mock`,见 `references/DEEPENING.md`)
- **Files** — monospaced(`font-mono text-sm`)
- **Before / After 图** — 并排两列,中心 element
- **Problem** — 一句话,什么痛
- **Solution** — 一句话,改什么
- **Wins** — bullets,每条 ≤6 字,glossary 术语:「locality: bug 集中一处」「leverage: 一接口 N 调用点」「删 4 个 shallow wrapper」
- **ADR callout** — 冲突时,amber 框一行:_"contradicts ADR-0007 — 重新讨论因为…"_

无解释段落。图需要解释 → 重画图。

## 图表模式

挑合适的、混用。

### 1. Mermaid flowchart(依赖 / 调用流主力)

「X 调 Y 调 Z 一团乱」用这个。Tailwind 卡片包裹,classDef 给 leakage 红色 / deep module 黑色:

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

Sequence diagram 适合「before 6 round-trip / after 1」。

### 2. 手画 boxes-and-arrows(Mermaid 布局不听话时)

module 作 `<div>` + border,arrow 用绝对定位容器内的内联 SVG `<line>` / `<path>`。after 想画「一个厚边 deep module + 灰化内部」时 Mermaid 力度不够,用这个。

### 3. 剖面 / cross-section(layered shallowness)

水平条堆叠(`h-12 border-l-4`)展示一个调用穿过几层。Before: 6 层薄、每层啥也不做。After: 1 层厚、合并职责。

### 4. Mass diagram(interface 和 implementation 一样宽)

每 module 两个矩形——interface 表面 + implementation。Before: interface 矩形几乎和 implementation 一样高(shallow)。After: interface 矩形短、implementation 矩形长(deep)。

### 5. Call-graph collapse

Before: 嵌套盒子的函数调用树。After: 同一棵树合并成一个盒子,内部调用淡化显示。

## 样式

- editorial 风,不是 corporate dashboard。留白宽松
- 配色克制:一个 accent(emerald 或 indigo)+ 红(leakage)+ amber(警告)
- 图保持 ~320px 高,before/after 并排不滚动
- module label 用 `text-xs uppercase tracking-wider`——schematic 感不是 UI 感
- 唯二脚本是 Tailwind CDN + Mermaid ESM。静态报告,无 app 代码

## Top Recommendation Section

等价于 SKILL.md §3 收尾段的 HTML 形态:一个大一号 card,候选名 + 一句话理由 + 锚点到对应卡片。

## 术语 / 文风

架构名词与 Avoid 清单走 `core/specs/shared/architecture-language.md`(顶部 `<CONTEXT>` 已注入)。Wins bullet 用 leverage / locality 兑现收益,不写「更易维护」「代码更整洁」——不在词表、不挣钱。文风遵循项目 § 输出文风。
