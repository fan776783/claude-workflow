---
name: figma-ui
description: "Use when 用户提供 Figma URL(figma.com/design|file|proto) 要求实现/还原/构建 UI; or 引用现有文件说「按设计稿还原/调整/检查」「和设计不一致」「还原度不够」; or 要求把 icon/empty-state/插画资源换成设计稿里的; or 用户贴了 Figma 截图要求照着写; or 说「还原设计稿」「按设计稿写」「照着 Figma 写」「换个 icon」「这个组件和设计对不上」「convert this design to code」「restore the design」「implement this design」「match the mockup」。即使用户没明确说 Figma，只要上下文涉及设计稿→代码还原就应触发。Figma 画布操作(create/edit/delete nodes)请用 figma-use skill。"
---

<CONTEXT>
开始写组件代码前 Read `.claude/code-specs/{pkg}/{layer}/index.md`（按涉及文件映射）+ `core/specs/shared/glossary.md`。设计稿获取 + 分诊阶段可跳过。
</CONTEXT>

# Figma UI 实现 workflow

> 默认主路径:**先完成设计获取与资源分诊,再编码,最后用视觉 review 决定是否允许交付**。
>
> ⚠️ 不要绕开本 skill 直接裸调 MCP 或 CLI。本 skill 负责处理 `assetsDir`、临时目录、资源分诊和交付 quality-gate。详细执行步骤见 [`references/playbook.md`](references/playbook.md)。

## 运行入口

CLI 路径（相对本 skill）：`cli/figma.mjs`，Node ≥ 18，无需安装依赖。

调用形式：
```bash
node <skill-root>/figma-ui/cli/figma.mjs <subcommand> [args...]
```

CLI 封装 Figma Desktop MCP Server（`http://127.0.0.1:3845/mcp`）全部工具,替代原生 MCP tool 调用,并自动管理资产临时目录和差集计算。

### 高频命令

```bash
# 获取设计上下文 + 自动管理资产目录（推荐入口）
node cli/figma.mjs design --url "https://figma.com/design/xxx/Name?node-id=42-15"
node cli/figma.mjs design --nodeId 42:15 --taskId my-task

# 获取截图
node cli/figma.mjs screenshot --url "https://figma.com/design/xxx/Name?node-id=42-15"

# 获取节点结构（分块场景）
node cli/figma.mjs get_metadata --nodeId 0:1

# 获取 Design Token
node cli/figma.mjs get_variable_defs --nodeId 42:15

# 清理任务临时目录
node cli/figma.mjs cleanup --taskId my-task
node cli/figma.mjs cleanup  # 清理全部 tmp

# 连通性检查
node cli/figma.mjs doctor
```

### `design` 命令详解

`design` 是最核心的高层命令,自动完成：
1. 创建 `${assetsDir}/.figma-ui/tmp/${taskId}` 临时目录
2. 调用 `get_design_context` 并传入 `dirForAssetWrites`
3. 等待异步资产写入（3s）
4. 计算目录差集得到 `newlyDownloadedFiles`
5. 输出 JSON（含 designContext + newlyDownloadedFiles + screenshot 路径）

输出示例：
```json
{
  "taskId": "a1b2c3d4",
  "taskDir": "/project/public/images/.figma-ui/tmp/a1b2c3d4",
  "newlyDownloadedFiles": ["6e134c6c...svg", "e0e0f6ac...png"],
  "totalFilesInDir": 2,
  "screenshot": "/project/public/images/.figma-ui/tmp/a1b2c3d4/_screenshot.png",
  "designContext": "..."
}
```

### URL 便利参数

所有命令支持 `--url`,自动提取 `fileKey` + `nodeId`：
- 标准 URL：`/design/:fileKey/:name?node-id=42-15` → `fileKey` + `nodeId=42:15`
- Branch URL：`/design/:fileKey/branch/:branchKey/:name` → 用 `branchKey` 作为 fileKey

### 环境变量

| 变量 | 说明 |
|------|------|
| `FIGMA_MCP_URL` | 覆盖 MCP endpoint（默认 `http://127.0.0.1:3845/mcp`） |

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
- **通过 CLI `design` 命令调用** — CLI 自动管理 `dirForAssetWrites`；直接 raw call 时必须手动传,否则资源下载到不可预期位置
- **review 后交付** — 未完成 Visual Review 不宣称完成。自检是发现间距/颜色偏差的最后一道关卡
- **P0 阻断交付** — review 后仍有 P0 时不按"已完成"收口
- **修复上限 3 轮** — 超过 3 轮仍有 P0 时停止推进并请求用户判断
- **当前模型直接实现** — 不调用外部模型代写 UI,保持实现与 review 的一致性

## Prerequisites

- Figma Desktop MCP Server 运行中（`node cli/figma.mjs doctor` 验证）
- Image Source 设为 **Download**（Figma Desktop → Preferences → Dev Mode MCP）
- 用户提供 Figma URL 或使用桌面端当前选中节点

连接失败或首次配置 → 见 [`references/troubleshooting.md`](references/troubleshooting.md) "MCP 连接"章节。

参考文档:
- [`references/playbook.md`](references/playbook.md) — Phase A/B/C 详细执行流程
- [`references/figma-tools.md`](references/figma-tools.md) — 底层参数 + Image Source 机制
- [`references/visual-review.md`](references/visual-review.md) — 视觉 review 维度
- [`references/troubleshooting.md`](references/troubleshooting.md) — 连接配置 + 故障排查

## 执行步骤

### Phase A: 设计获取 + 资源分诊

1. **获取设计数据** — `node cli/figma.mjs design --url <url> --taskId <id>`
2. **提取 ElementManifest** — 从 designContext 分类出 P0/P1/P2 元素作为覆盖率 checklist
3. **提取 DesignAnchors**（修改已有组件时） — 记录根容器 width/height/padding/border-radius 数值
4. **Asset Triage** — 对 `newlyDownloadedFiles` 逐个标记 `inline`/`promote`/`discard`/`refetch-parent`
5. **产出 AssetPlan** — 每个资源有 decision + targetName

**Gate → Phase B**: AssetPlan 完成且无未处理的 `refetch-parent`。

### Phase B: 编码

6. **项目适配** — 将 Figma 参考代码转为项目框架/设计系统/convention
7. **只消费 AssetPlan 中的资源** — `inline` 用代码表达，`promote` 用已命名资源引用
8. **编码收口** — 将 `promote` 资源移入正式目录并重命名

**Gate → Phase C**: 代码完成，正式目录只含 promote 资源。

### Phase C: 验证 + 修复

9. **覆盖率检查** — 对照 ElementManifest 确认 P0/P1 元素全部实现
10. **Anchor Verification**（有 DesignAnchors 时） — 机械比对数值，width/height 不匹配 = P0
11. **Visual Review** — 对照截图输出问题清单，按 P0/P1/P2 分级
12. **修复循环** — 有 P0 则修复并重新 review，最多 3 轮
13. **交付决策** — 无 P0 可交付；仍有 P0 则请求用户指导

**Exit**: 无 P0 + 已出交付摘要 + 临时目录已 cleanup。

每步的字段定义、示例、降级方案见 [`references/playbook.md`](references/playbook.md)。

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

## Red Flags（偏离信号）

| 念头 | 修正 |
|------|------|
| "先写页面,AssetPlan 后面补" | 回 Phase A step 4 |
| "复合图形先用几个 SVG 拼" | 回 Phase A,执行 `refetch-parent` |
| "先用 hash 文件名,最后统一改" | 回 step 4 资源命名 |
| "目测差不多,不必 review" | 回 Phase C step 11 |
| "先说完成,回头补 review" | 回 Phase C step 13 |

## 底层参数参考

CLI 已封装常用参数。进阶参数（`artifactType`、`taskType`、`clientFrameworks` 等）和 Remote 专属工具见 [`references/figma-tools.md`](references/figma-tools.md)。
