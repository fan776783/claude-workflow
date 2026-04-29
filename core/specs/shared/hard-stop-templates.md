# Hard Stop 模板

AskUserQuestion 在真决策点的统一模板。skill 里调用时改为"见 `core/specs/shared/hard-stop-templates.md § <模板名>`"，不再复写 options 和 question。

## 何时该用 Hard Stop

用户真正需要介入的决策点才用 AskUserQuestion。以下属于**非决策点**，改用自然语言提示："XXX 如上，如需 <alternative> 请回复"即可：

- 展示增强后 prompt / 研究结论 / plan 摘要后的"要不要用"
- 展示分析假设表、影响面评估、候选方案对比
- 展示诊断结果，让用户在没有 code 改动前 review

**真决策点**（保留 Hard Stop）：
- 即将改代码前（fix-bug Phase 2）
- 即将触发批量修复 / 状态流转（bug-batch FixUnit 编排）
- 即将archive / 删除分支 / force push
- 资源清理失败的降级选择（team cleanup）
- 方案审批（workflow-plan spec 审批、workflow-review verdict）

## 模板

### T1: Proceed / Abort（二选一，"继续或终止"）

场景：方案已展示，问用户是否进入下一步可能触发写操作的阶段。

```
question: "<一句话问是否按此方案进入 <下一阶段>？>"
options:
  - proceed — 确认方案，进入 <下一阶段>
  - abort — 拒绝方案，回到上一阶段重新分析或终止
```

示例填充：fix-bug Phase 2 完成后问"是否按此修复方案进入 Phase 3 编码？"

### T2: Confirm / Revise / Upgrade（三选一，轻量规划）

场景：plan 或delta方案展示完，用户可能要改方案、升级到更重的workflow。

```
question: "<一句话问如何处理此 <产物名>？>"
options:
  - confirm — 确认，由用户执行或下游流程消费
  - revise — 修改，根据用户反馈回到生成阶段重跑
  - cancel — 放弃，标记失败或退出
```

示例填充：workflow-delta Step 5 "如何处理本次delta？"（见 `core/skills/workflow-delta/SKILL.md`），选项为 `apply` / `manual_edit` / `cancel`。

**反例（不要套用 T2）**：quick-plan Step 4 展示 plan 摘要 → "要不要用" 属于本文件 § 何时该用 Hard Stop 列出的**非决策点**，必须改用自然语言提示（`core/skills/quick-plan/SKILL.md:74` 明确写"不调 AskUserQuestion"）。

### T3: Confirm / Use Alternative / Reject（三选一，修复方案）

场景：方案有主推 + 备选，用户要在主推、备选、终止之间选。

```
question: "<一句话问是否执行此修复方案？>"
options:
  - confirm — 按推荐方案进入下一阶段
  - use_alternative — 切到备选方案后再进入下一阶段
  - reject — 终止流程，标记 manual_intervention + reason: user_rejected
```

示例填充：fix-bug Phase 2.2 Hard Stop。

### T4: Retry / Force / Keep（三选一，清理失败降级）

场景：资源清理操作失败，需要用户在重试、强制、保留之间选。

```
question: "<一句话说明清理失败原因并问如何处理？>"
options:
  - retry_<action> — 再试一次当前清理动作
  - force_<action> — 跳过现有阻塞（如 shutdown 剩余队友）后再清理
  - keep_<state> — 放弃清理，保留 runtime 目录 / 状态由用户手动处理
```

示例填充：team cleanup 失败时的三选项。

## 使用方式

Skill SKILL.md 里写：

```markdown
展示方案后调用 AskUserQuestion。模板见 `core/specs/shared/hard-stop-templates.md § T3`，填充字段：
- 推荐方案：<动态内容>
- 备选方案：<动态内容>
```

不再在每个 skill 里复写三列选项表。
