---
name: figma-ui
description: "Use when 用户提供 Figma URL 并有明确的代码实现意图（实现/还原/构建/写/改/调/做/convert/implement/restore/build/match/create code）; or 引用现有文件说「按设计稿还原/调整/检查还原度」「和设计不一致」; or 要求换 icon/资源为设计稿里的。仅提供 URL 而无实现动作词（读取/查看/提取/导出/分析）时不触发,走 figma-data。Figma 画布操作(create/edit/delete nodes)走 figma-use。"
argument-hint: <Figma URL>
---

<CONTEXT>
开始写组件代码前 Read `.claude/code-specs/{pkg}/{layer}/index.md`（按涉及文件映射）+ `core/specs/shared/glossary.md`。设计稿获取 + 分诊阶段可跳过。
</CONTEXT>

# Figma UI 实现 workflow（Web）

> 默认主路径：**先通过 figma-data 完成设计获取与资源分诊，再编码，最后用视觉 review 决定是否允许交付**。
>
> ⚠️ Phase A（设计获取 + 资源分诊）由 `figma-data` skill 负责。本 skill 从 Design Package 开始，只做 Phase B（编码）+ Phase C（验证）。

## 依赖

- **figma-data** — 提供 Design Package（designContext + ElementManifest + DesignInventory + AssetPlan）
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
- **CHANGE_ARTIFACT 未出 ChangeManifest 不编码** — 修改已有页面必须先过 Phase B.0（delta sweep + 编辑点枚举 + 传播决策），manifest `confirmed` 才动代码
- **promote-only 到正式目录** — 正式资源目录只接收 AssetPlan 中 `promote` 的资源
- **视觉优先** — 精确还原，不做主观"优化"。项目令牌与 Figma 值冲突时优先项目令牌，但微调间距/尺寸维持视觉还原度
- **review 后交付** — 未完成 Visual Review 不宣称完成
- **P0 阻断交付** — review 后仍有 P0 时不按"已完成"收口
- **修复上限 3 轮** — 超过 3 轮仍有 P0 时停止推进并请求用户判断
- **当前模型直接实现** — 不调用外部模型代写 UI

## 执行步骤

### Phase A: 设计获取 + 资源分诊（委托 figma-data）

**委托前先判定 taskType**（ADR-0005）：用户引用现有文件/页面 + 修改动词（改/调整/更新/对齐新设计）→ `CHANGE_ARTIFACT`；全新页面/组件 → `CREATE_ARTIFACT`；歧义 → AskUserQuestion 后再委托。判定结果传给 figma-data（CLI `--taskType` 透传）。

执行 `figma-data` skill 的完整 workflow，获得 Design Package：
- `schemaVersion`（必须 = `"1.1"`，见下方 Gate 0）
- `taskType`（`CREATE_ARTIFACT` / `CHANGE_ARTIFACT`）
- `taskId`, `taskDir`, `screenshot`
- `designContext`
- `ElementManifest`（P0/P1/P2 元素 checklist）
- `DesignInventory`（CHANGE_ARTIFACT 时必有：元素级 7 维设计值清单 + state variants，纯设计侧）
- `AssetPlan`（每个资源的 decision + targetName）

**Gate 0 → contract assert（ADR-0001 Decision 6 + ADR-0005）**: 读取 Design Package 后**先校验**：
1. `schemaVersion === "1.1"`——不存在或不匹配 → figma-data 输出过期或 server 漂移；要求用户更新 `@justinfan/agent-workflow` 后重跑，**停止 workflow**
2. `taskType === "CHANGE_ARTIFACT"` ⇒ `design-inventory.md` 存在——缺失视同 schema mismatch 处理（回 figma-data Step 5 补产，不得继续）
- 不要"宽容"地继续——schema mismatch 意味下游 contract 失效，强行解析会静默错位。

**Gate → Phase B**: Design Package 就绪（contract assert 通过 + AssetPlan 完成且无 `refetch-parent`）。CHANGE_ARTIFACT 还须先过 Phase B.0（见下）。

**Abort → Exit**: figma-data 返回降级产出（无 designContext / 无 AssetPlan）时，按输出形态识别两种降级：
- `{mode: "read-only-fallback", reason, ...}`（exit 0）→ tool_not_found 降级。`reason` 含 `get_design_context not available on server (tool_not_found)`：Figma MCP 升级删/改了 tool，`figma-data` 已在 stderr 输出 `{"kind":"tool_not_found",...}`；用户需更新 figma-data 或检查 Figma Desktop MCP 版本
- `{error: "dir_not_allowed", message, fallback: "screenshot_and_metadata", ...}`（exit 4）→ 目录被拒。① Figma Desktop → Preferences → Dev Mode MCP → Allowed directories 添加项目路径；② 或切换 Remote MCP（`claude mcp add figma-mcp --transport http --url https://mcp.figma.com/mcp`）。截图 + metadata 由 figma-data 按其降级流程手动补取
- 两种情况都：将截图 + 节点结构（metadata）呈现给用户，告知 Phase B 无法启动（缺少 designContext + AssetPlan），**停止 workflow，不继续编码**

### Phase B.0: 修改点全量枚举（仅 CHANGE_ARTIFACT，编码前必经）

构建 ChangeManifest（inline 维护或落 `taskDir/change-manifest.md` 均可，账本内容必须完整；详细执行见 [`references/change-playbook.md`](references/change-playbook.md)）：

1. **Delta sweep** — DesignInventory 逐元素逐维度 vs 现有代码，差异才成 entry；用户没提的 delta 照收（标 `mentionedByUser: false`）；逆向 pass 抓 removed 候选
2. **编辑点枚举** — 6 条搜索 recipe（R1 组件引用 / R2 旧值字面量 / R3 token 链 / R4 断点【以上硬】/ R5 伪状态 / R6 重复 markup【advisory】），searchLog 记录 query + hits，硬 recipe 缺失 = gate fail
3. **传播决策** — 组件/token 消费者超出目标页 → 显式 `propagate-all` / `scoped` / `ask-user`

**Gate B.0**: 存在未提及 delta / removal / ask-user / `codeValue: unlocated` → Hard Stop 一次性列全表（节点内默认 in-scope，节点外默认 ask，removal 默认不删）；全部无歧义 → auto-pass。manifest `status: confirmed` 才进 B.1。

### Phase B: 编码

1. **项目适配** — 将 Figma 参考代码转为项目框架/设计系统/convention
2. **只消费 AssetPlan 中的资源** — `inline` 用代码表达，`promote` 用已命名资源引用
3. **编码收口** — 将 `promote` 资源移入正式目录并重命名

CHANGE_ARTIFACT 纪律：严格按 manifest `sites[]` 编辑，同一 entry 全改或全不改；中途发现新 site 先补 manifest 行再动手。

**Gate → Phase C**: 代码完成，正式目录只含 promote 资源。

### Phase C: 验证 + 修复

**C.0 模式陷阱**（入口无条件）— 检查**本次任务编辑的文件集合**（任务 diff 范围，工作区原有无关脏文件不计入）：其中存在已有 UI 文件被实质修改（路由注册 / barrel export 等接线性改动豁免）但 `taskType !== "CHANGE_ARTIFACT"` → 模式误判。恢复路径：以 `--taskType CHANGE_ARTIFACT` 重跑 figma-data 补产 DesignInventory，再回 Phase B.0 补建 ChangeManifest。

CREATE_ARTIFACT 分支：

4. **覆盖率检查** — 对照 ElementManifest 确认 P0/P1 元素全部实现
5. **Anchor Verification** — 从 designContext 提取根容器及关键子容器数值，机械比对代码实际值（见 playbook.md C.1.5），width/height 不匹配 = P0
6. **Visual Review** — 对照截图输出问题清单，按 P0/P1/P2 分级
7. **修复循环** — 有 P0 则修复并重新 review，最多 3 轮
8. **交付决策** — 无 P0 可交付；仍有 P0 则请求用户指导

CHANGE_ARTIFACT 分支（机械对账，取代 CREATE 分支 step 4-5；详见 [`references/change-playbook.md`](references/change-playbook.md)）：

- **C.1Δ Delta 覆盖对账** — 每个 manifest entry 终结于 `applied / verified-unchanged / out-of-scope / unresolved`，有 `unresolved` = P0
- **C.1.5 数值比对** — 比对域 = 全部 entry × sites，逐 site 重读代码值 vs designValue
- **C.2a 残值清零** — 用 B.0 定死的 residue pattern 对账 preCount → afterCount，不归零且无 justify = P0（对账结果 inline 或落 `_residue.md` 均可）
- **C.2b Diff 双射** — 每个 git diff hunk 映射到 entry / 传播决策 / AssetPlan，未映射 = scope creep P0（inline 或落 `_coverage.md` 均可）。**清 scope creep 只能定向 re-edit，禁对整文件 `git checkout/restore/stash`**——脏树上会抹掉未提交存量改动（详见 change-playbook.md C.2b）
- **Visual Review / 修复循环 / 交付决策** — 同 CREATE 分支 step 6-8；交付摘要必须报告对账实际数字（entry 终态统计 + 残值对账），对账须真跑，落盘可选

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
| "目测差不多，不必 review" | 回 Phase C Visual Review（CREATE step 6 / CHANGE 对账门后的 review） |
| "先说完成，回头补 review" | 回 Phase C 交付决策（CREATE step 8 / CHANGE C.5 交付摘要） |
| "改已有页面，先改了再补 manifest" | 回 Phase B.0，manifest `confirmed` 才编码 |
| "residue 没归零但应该是巧合" | 逐条 justify（inline 或 `_residue.md`），禁止批量豁免 |
| "diff 混进 formatter 重排，`git checkout` 撤掉" | 禁破坏性 git（脏树会抹未提交存量）；定向 re-edit 还原，非 formatter-conformant 文件不做整文件格式化 |

## 参考文档

- [`references/playbook.md`](references/playbook.md) — Phase B/C 详细执行 workflow（CREATE_ARTIFACT 主路径）
- [`references/change-playbook.md`](references/change-playbook.md) — CHANGE_ARTIFACT 修改点枚举 + 对账门
- [`references/visual-review.md`](references/visual-review.md) — 视觉 review 维度
- `figma-data` skill — Phase A 执行 workflow + MCP 参数 + 故障排查
