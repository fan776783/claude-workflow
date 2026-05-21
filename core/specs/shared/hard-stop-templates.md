# Hard Stop Templates

修复 / 批处理 workflow 里两类 Hard Stop 卡点的共享语义。fix-bug、bug-batch 共用此协议,不各自复写"为什么停、怎么停"。

每个 skill 只声明**卡点落在哪个 Phase**、**展示什么内容**、**用哪组 AskUserQuestion options**;停的纪律与判据走本文件。

## 通用纪律

- Hard Stop 输出后**立即停止所有操作**,等用户 / 经办人明确输入,不得继续执行任何后续动作。
- `manual_intervention` 路径同样展示摘要,但提示中明确标注「不会提交 / 不会流转」。

## Gate 1 — 计划确认卡点

**位置**:任何代码改动**之前**(fix-bug Phase 2、bug-batch Phase 4)。

**用途**:用户在动代码前批准方案 / 编排。

**形式选择**:按"审阅体量 × 反馈维度"二选一:

| 条件 | 形式 |
|---|---|
| 审阅展示 ≤ 3 段简短信息 且 反馈维度 ≤ 1(选项互斥、无需带条件) | **A. AskUserQuestion 模式** |
| 审阅展示 ≥ 4 段 或 含 N×子项(如多 FixUnit)、或 ≥ 1 个反馈选项天然需要带条件("改但 X 那块换 Y") | **B. 纯文本模式** |

### A. AskUserQuestion 模式

- 展示分析结果(诊断 / 影响面 / 编排)。
- 调 `AskUserQuestion`,options 由 skill 自定义。最低须含 `确认推进` 路径;按需提供 `按反馈修改`(可拆为多个细化 option)和 `终止` 路径。
- 若 skill 提供 `终止` option → 统一映射 `manual_intervention` + `reason: user_rejected`(见 `core/specs/shared/manual-intervention-reasons.md`)。

### B. 纯文本模式

- 展示分析结果后,**不调 AskUserQuestion**,在末尾输出"反馈方式"提示块。
- 提示块中每个**可直接确认的选项必须带 `1.` / `2.` / `3.` 编号**,用户可回 `1` / `2` 等数字快捷确认;开放式反馈(如"改哪里")不编号,鼓励自由文本。
- skill 内部维护"用户回复 → canonical 路径"的归一化表(参考 `core/skills/workflow-spec/SKILL.md § 用户回复归一化`)。
- 模糊回复("看着办" / "你决定")不归一化,反问用户具体走哪条。
- 若 skill 不提供显式终止选项,用户可缩小范围或停止响应实现等效终止。

## Gate 2 — 提交流转确认卡点

**位置**:对外可见副作用(状态流转到「待验证」/ 移交 QA)**之前**(fix-bug Phase 5、bug-batch Phase 8)。

**用途**:流转到「待验证」是对外可见的共享副作用,不能在用户未人工验证的情况下静默发生。commit 本身可回滚(`refs/backup` / 工作区改动),被卡的是**外部流转**这一步。

**形式**:
- **无条件触发** —— 包括全 `completed` / 顺利路径也必须停。
- **纯文本展示**汇总报告 + 验证提示,**不调 AskUserQuestion** —— 用户需要自由文本表达「未验证 / 验证不通过 / 放弃提交 / 需回滚」等非结构化情况。
- 验证提示必须要求用户**人工验证修复是否正确**(如本地起服务实测)。
- 用户回 `ok` → 执行提交 / 流转;非 `ok` → 一律不提交、不流转,保留改动 / commit / `refs/backup` 等用户接手。

## 使用方式

Skill SKILL.md 里按卡点类型选对应模板:

```markdown
### Phase N: <Gate 1 阶段名>(Hard Stop, 形式 A)

本卡点为 `core/specs/shared/hard-stop-templates.md § Gate 1 形式 A`。展示 <分析模板>,AskUserQuestion options: <skill 自定义>。
```

```markdown
### Phase N: <Gate 1 阶段名>(Hard Stop, 形式 B)

本卡点为 `core/specs/shared/hard-stop-templates.md § Gate 1 形式 B`。展示 <分析模板> + "反馈方式"提示块(可直接确认的选项编号 `1./2./3.`),纯文本不调 AskUserQuestion。归一化表见 skill 内部。
```

```markdown
### Phase M: <Gate 2 阶段名>(Hard Stop)

本卡点为 `core/specs/shared/hard-stop-templates.md § Gate 2`。展示 <汇总模板> + 验证提示,纯文本不调 AskUserQuestion。
```

不再在每个 skill 里复写卡点的触发条件、是否无条件、是否调 AskUserQuestion 这些判据。
