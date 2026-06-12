# figma CHANGE_ARTIFACT 契约——DesignInventory + ChangeManifest 对账门治漏改

figma-ui 修改已有页面（CHANGE_ARTIFACT）高频漏改。用户实测分布：⑥未提及 delta（最高频）、①共享组件其他实例、④响应式断点、⑤token/全局/组件多层样式分裂；②同页重复 markup 与 ③伪状态低频。根因审计（4 路诊断 + 20 failure-mode 枚举）：整条 pipeline 没有任何一步计算"哪些代码位置必须改"——ElementManifest 是设计树分类非 delta（元素"存在"≠"已按新设计更新"，C.1 覆盖检查在已有页面恒过）；DesignAnchors 只盖根容器盒数值且唯一读代码指令（原 figma-data SKILL.md Step 5 末句）无定位程序、隐含单一位置假设；Phase B 无编辑点枚举步骤；Phase C 验证域 = 单节点 × 单截图 × 默认态 × 单视口，漏改点进不了问题清单，3 轮修复循环结构上无法补救；CHANGE 模式本身靠"修改已有组件时"一句话非正式触发，下游 gate 不 assert，机制可静默消失。决定把漏改从"截图目测要碰巧看见"改造为"账本对不上 = gate failure"（codemod 纪律：enumerate-first → transform → verify-residue）：figma-data 产纯设计侧 **DesignInventory**（元素级 7 维设计值 + state variants，替代 DesignAnchors，schemaVersion 1.0→1.1 + taskType 进契约）；figma-ui 新增 **Phase B.0** 构建 ChangeManifest（delta sweep 抓未提及 delta + 6 recipe 编辑点枚举 + 传播决策 + Hard Stop）；Phase C CHANGE 分支换成三道机械对账门（C.1Δ delta 覆盖 / C.2a 残值清零 / C.2b diff 双射）+ C.0 模式陷阱（限本任务编辑文件集合）。

## Status

accepted（2026-06-12，via 多 agent 诊断 workflow + `/grill` 4 个决策节点 + `/quick-plan`）。

## Decisions

1. **硬 gate 按实测分布分级**：searchLog 中 R1 组件引用 / R2 旧值字面量 / R3 token 链 / R4 断点为【硬】（缺失 = Gate B.0 fail），R5 伪状态 / R6 重复 markup 为【advisory】（可 N/A + 原因）。低频类不上硬 gate，避免 agent 在不相关项目刷 N/A 理由的 busywork。
2. **designValue vs codeValue 对比归 figma-ui Phase B.0**，figma-data 只产纯设计侧 DesignInventory。理由：figma-data 定位是 MCP 数据层，原 Step 5 读代码句恰是"无定位程序"根因句，搬出去修好而非在越界方向加码；编辑点枚举需要项目 code-specs 上下文（figma-ui `<CONTEXT>` 声明，figma-data 没有）；Read-only 模式不被污染。
3. **Hard Stop 默认值**：一次性列全表；用户指名节点内 delta 默认 in-scope（治 ⑥），节点外默认 ask（防设计师 WIP 噪音过改），removed 候选永远默认不删（删错代价 > 多留）；零未提及 delta + 零歧义 → auto-pass。用户排除的 entry 标 `out-of-scope` 保留在 manifest（审计可追溯），不物理删除。
4. **一期 / 二期切分**：一期 = skill 文档全量 + CLI `--taskType` echo + schemaVersion 1.1 + `tests/test_figma_cli.js`（mock MCP server，figma.mjs 从零测试起步）+ mobile-frame 追取 ask（④高频故进核心路径）。二期带触发条件：`manifest-lint` 子命令（CLI 重跑 residue pattern 核对 count，agent 报数变 harness 验数）— 触发条件是一期观察到 agent 谎报 grep 结果 / 跳过对账；per-variant 截图矩阵 — 触发条件是伪状态漏改实际发生；PreToolUse hook 强制 gate（CHANGE 模式 taskDir 无 manifest 时 deny Edit）— manifest-lint 仍不足时的升级路径。
5. **schemaVersion 1.0 → 1.1**：契约移除 DesignAnchors（语义变更）+ 新增必填 taskType，按 figma-data `references/troubleshooting.md` 升版规则必须 bump；figma-ui Gate 0 同步 assert `"1.1"` + `CHANGE_ARTIFACT ⇒ design-inventory.md 存在`（缺失视同 schema mismatch，fail-loud，复用 ADR-0001 Decision 6 语义）。CLI 对 `--taskType` 做枚举校验（仅 `CREATE_ARTIFACT|CHANGE_ARTIFACT`，非法值 exit 6 enum_invalid）——typo 不校验会让 Gate 0 的 `CHANGE ⇒ DesignInventory` 蕴含式空真，整套机制静默失效，恰是本 ADR 要消灭的失败类。`DELETE_ARTIFACT` 是 server 接受但不产 Design Package 的值，走 `raw`。

## Considered Options

- **数据层方案单独落地（ChangeManifest 全量由 figma-data 产出，含 code sites）** — 拒绝。评审覆盖度最高（~16/20 failure modes）但把 6 维代码搜索塞进 figma-data，击穿 figma-data/figma-ui 的 Skill Boundaries 表（设计数据获取 vs repo 分析），Read-only 模式行为分裂加深。delta 表达力保留，落点改 figma-ui（Decision 2）。
- **验证层方案单独落地（只加 Phase C 对账，不加 B.0 枚举）** — 拒绝。"漏改不可交付"但不"漏改难发生"，每轮修复循环才发现一批漏点，3 轮上限内可能修不完；且编辑后才做传播分类，shared-component 改错方向（该 fork 的改成了全局传播）无法在编辑前拦截。其对账门机制全部吸收进 Phase C CHANGE 分支。
- **纯流程方案（EditPlan 全靠 skill 指令，无契约升版）** — 拒绝。模式判定与 manifest 完整性全凭 agent 自觉，"no sweep findings → auto-pass"存在自我豁免循环；需要 taskType 进契约 + Gate 0 assert + git-status 文件系统证据陷阱三道结构性强制才闭环。
- **manifest-lint / hook 强制进一期** — 拒绝。治"agent 谎报数字"，但在无失败证据前加运行时复杂度；一期靠"交付摘要必须引用 _coverage.md / _residue.md 实际内容"使跳过结构性变难，二期按触发条件升级（Decision 4）。
- **沿用 DesignAnchors 增量扩展（加维度、加深度）** — 拒绝。锚点机制的"figma-data 读代码 + 单一位置假设"是根因不是参数问题；扩维度不解决 sites 枚举与传播决策缺失。

## Consequences

非直观下游警示：

- **schemaVersion skew fail-loud**：旧 canonical 安装（figma-data 1.0 输出）遇新 figma-ui Gate 0 assert `"1.1"` → 停机要求 `agent-workflow update`。这是 ADR-0001 既有语义的复用，不是新行为；但 CHANGE 路径首次出现"taskType 缺失也停机"，用户若手动裸调 CLI 旧形式（不传 `--taskType`）得到 `CREATE_ARTIFACT` 默认 echo，figma-ui 若判定为修改任务会在 Gate 0 拦截不一致。
- **C.0 模式陷阱的三重限定**：判定限于本次任务编辑的文件集合（任务 diff 范围，不用全仓 `git status`——工作区原有脏文件不计入，纪律同 diff-review context-capture）；CREATE 任务固有接线性改动（路由注册 / barrel export / AssetPlan promote 移动）豁免；触发条件是 `taskType !== "CHANGE_ARTIFACT"`（fail-safe 方向，typo 值也触发）。误触发的恢复路径是先 `--taskType CHANGE_ARTIFACT` 重跑 figma-data 补产 DesignInventory 再进 B.0（B.0.1 依赖它），代价是多建一次 manifest（安全方向），可接受。
- **residue pattern 编码前定死**：C.2a 的对账力完全取决于 B.0 时 pattern 的质量；CSS-in-JS / 动态拼接 class 名场景 grep 必然漏（写进 change-playbook 比例规则的已知边界），此时 sites 枚举退化为 R1 组件引用 + 人工 Read，对账退化为 C.1Δ 终态闭环——机制降级但不失效。
- **figma.mjs 测试为新模式**：`tests/test_figma_cli.js` 起 mock MCP HTTP server + subprocess spawn，单例 ~3.3s（cmdDesign 硬编码 3s 资产等待）。后续给 figma.mjs 加子命令时沿用该 harness；勿在测试里并行多个 design 调用（共享 mock server 串行即可）。
- **ux-elaboration 不受影响**：其 Layout Anchors 是独立概念（写 Spec §4.4），与被替换的 DesignAnchors 无引用关系（全仓 grep 验证）；figma-data Read-only 模式（用户直接触发读设计稿）不产 DesignInventory，行为不变。
- **二期触发条件是观察值不是日期**：manifest-lint 与 hook 强制的触发输入来自一期实战的 searchLog 遵守率与 Hard Stop 噪音观察；若一期机制实测足够，二期永不落地是预期内结果。
