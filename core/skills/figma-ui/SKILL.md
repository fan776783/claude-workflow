---
name: figma-ui
description: "Use when 用户提供 Figma URL(figma.com/design|file|proto) 要求实现/还原/构建 UI; or 引用现有文件(@components/xxx.vue)说「按设计稿还原/调整/检查」; or 要求把 icon/empty-state 资源换成设计稿里的; or 说「还原设计稿」「按设计稿写」「照着 Figma 写」「convert this design to code」「restore the design」。Figma 画布操作(create/edit/delete nodes)请用 figma-use skill。"
---

> 路径与公共 pre-flight 见 [`../../specs/shared/pre-flight.md`](../../specs/shared/pre-flight.md)。本 skill 只做设计稿获取 + 分诊时可走「纯研究」跳过条件;开始写组件代码前仍须完成 project-config / repo-context / code-specs 跟读。

# Figma UI 实现 workflow

> 默认主路径:**先完成设计获取与资源分诊,再编码,最后用视觉 review 决定是否允许交付**。
>
> ⚠️ 不要绕开本 skill 直接裸调 `mcp__figma-mcp`。本 skill 负责处理 `assetsDir`、临时目录、资源分诊和交付 quality-gate。详细执行步骤见 [`references/playbook.md`](references/playbook.md)。

## Skill Boundaries

| 任务 | 用哪个 skill |
|------|------------|
| Figma URL / 设计稿 → 用户仓库代码(组件/页面/module) | **本 skill** |
| 在 Figma 画布上 create / edit / delete 节点 | `figma-use` |
| 从代码或描述生成完整页面设计稿 | `figma-generate-design` |
| 生成 Code Connect 映射 | `figma-code-connect` |
| 生成 design system 规则(CLAUDE.md / AGENTS.md) | `figma-create-design-system-rules` |

## Core Rules

每条附带理由,帮助在边界情况下自行判断:

- **先分诊再编码** — `get_design_context` 返回后先做 Asset Triage 再写组件。跳过这步会把临时 hash 文件名带进正式目录,后续无法追溯
- **refetch-parent 阻断** — AssetPlan 中存在 `refetch-parent` 时必须先回退重取。子图层拼接复合图形会导致 CSS 定位脆弱
- **promote-only 到正式目录** — 正式资源目录只接收 AssetPlan 中 `promote` 的资源
- **视觉优先** — 精确还原,不做主观"优化"。项目令牌与 Figma 值冲突时优先项目令牌,但微调间距/尺寸维持视觉还原度
- **`assetsDir` + `dirForAssetWrites` 必传** — 缺这个参数会导致资源下载到不可预期位置
- **review 后交付** — 未完成 Visual Review 不宣称完成。自检是发现间距/颜色偏差的最后一道关卡
- **P0 阻断交付** — review 后仍有 P0 时不按"已完成"收口
- **修复上限 3 轮** — 超过 3 轮仍有 P0 时停止推进并请求用户判断
- **当前模型直接实现** — 不调用外部模型代写 UI,保持实现与 review 的一致性

## Prerequisites

- Figma MCP server 已连接并可访问
- 用户提供 Figma URL(`https://figma.com/design/:fileKey/:fileName?node-id=1-2`) 或使用桌面端当前选中节点
- 项目有现成的设计系统或组件库(推荐,非必须)

参考文档:
- [`references/playbook.md`](references/playbook.md) — Phase A/B/C 详细执行流程
- [`references/figma-tools.md`](references/figma-tools.md) — MCP 工具速查
- [`references/visual-review.md`](references/visual-review.md) — 视觉 review 维度
- [`references/troubleshooting.md`](references/troubleshooting.md) — 故障排查

## 三阶段 workflow

```text
Phase A: 设计获取 + 资源分诊
    │  A.1 解析 URL → fileKey + nodeId
    │  A.2 获取 assetsDir
    │  A.3 get_design_context (含资源下载)
    │  A.4 get_screenshot (视觉参考基准)
    │  A.5 ElementManifest + DesignAnchors (修改已有组件必做)
    │  A.6-A.7 Asset Triage → AssetPlan
    │  A.8 复合图形识别 (必要时 refetch parent)
    ▼
Phase B: 编码
    │  项目适配 (框架 + 设计系统 + 令牌映射)
    │  保留 Figma 原始值,最小包装
    │  只消费 inline / promote 资源
    │  按 AssetPlan 收口正式资源
    ▼
Phase C: 验证 + 修复
    │  C.1 覆盖率检查 (ElementManifest)
    │  C.1.5 Anchor Verification (有 DesignAnchors 时机械比对)
    │  C.2 Visual Review (P0/P1/P2 分级)
    │  C.3 修复循环 (最多 3 轮)
    │  C.4-C.5 交付决策 + 摘要
```

每个 Phase 的字段定义、决策矩阵、示例代码、降级方案均在 [`references/playbook.md`](references/playbook.md)。

## Asset Triage 决策矩阵(高频核心,inline 保留)

| 场景 | 决策 |
|------|------|
| 纯布局 / 文本 / 简单边框 / 简单渐变 | `inline`(直接代码实现,不保留资源) |
| 复杂插画 / 位图 / 照片 | `promote`(纳入正式资源计划) |
| 明显无用或重复下载 | `discard`(本次任务临时文件) |
| 疑似错误粒度的子图层导出 | `refetch-parent`(停止编码,先导出父节点) |

命名原则:`{feature}-{role}.{ext}`。Figma MCP 返回的 `localhost` URL 直接使用,不转换;不引入新图标包,所有资源来自 Figma。

> ⚠️ 还没完成 AssetPlan 就开始写组件,是最常见的 workflow 偏离。资源决策拖到后面处理时,hash 文件名很可能已经散落在代码各处。

## Visual Review 严重程度

| 严重程度 | 含义 | 交付影响 |
|----------|------|----------|
| **P0** | 布局错位、颜色明显偏差、关键元素缺失 | **必须修复才能交付** |
| **P1** | 间距微调(2-8px)、字体细节、透明度偏差 | 应修复,不阻塞交付 |
| **P2** | 装饰细节、可简化样式、命名规范 | 建议修复 |

每个问题包含:元素名称、问题类别(spacing / color / typography / layout / border / shadow / accessibility)、设计稿值、实现值、修复建议。详细 review 维度见 [`references/visual-review.md`](references/visual-review.md)。

## Red Flags

出现下面这些念头说明正在偏离 workflow:
- "先把页面写出来,AssetPlan 后面再补。" → 回到 Phase A
- "这个复合图形先用几个 SVG 拼一下。" → 回到 Phase A,执行 `refetch-parent`
- "先引用 hash 文件名,最后再统一改。" → 回到资源命名步骤
- "目测已经很像了,不必做 review。" → 回到 Phase C
- "先说完成,回头再补 review 结果。" → 回到 Phase C

## Exit Criteria

只有满足以下全部条件,才允许把任务表述为"已完成"或"可交付":
- 已完成视觉 review,无 P0 问题
- 若曾进入修复循环,修复后已重新 review 并以最新结果判定
- 不存在未解决的 `refetch-parent`
- 正式资源目录只包含 `promote` 资源
- 已给出交付摘要

## MCP 参数速查

| 工具 | 必传参数 | 说明 |
|------|----------|------|
| `get_design_context` | `nodeId`, `dirForAssetWrites`;远程 MCP 加传 `fileKey` | 获取结构化设计数据 + 下载资源 |
| `get_screenshot` | `nodeId`;远程 MCP 加传 `fileKey` | 获取视觉参考截图 |
| `get_metadata` | `nodeId`;远程 MCP 加传 `fileKey` | 获取节点结构概览(分块获取用) |
