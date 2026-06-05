# No Placeholders 规则

Plan 中出现 placeholder token 即为 plan failure。**token 集由 `plan-review` CLI 的 `lintPlaceholder` 拥有并自动校验**——覆盖英文类（`TBD` / `TODO` / `implement later` / `Similar to Task N` 等）、中文类（`待补充` / `稍后完善` / `[待定]` / `【占位】` 等）与未渲染的 `{{name}}` 模板残留。无需人工扫描，也不要在 prose 里另行维护 token 清单（清单以 lint 实现为准，prose 复写必然漂移）。

> 裸 `占位` **不**进 lint：前端语境 `占位图` / `占位符` / `占位 icon` / `展示占位` 是高频业务名词，误报率 100%。真·填空用 `【占位】`。

## 语义型占位（人工判定，不在 lint 范围）

下列语法上无法识别，Self-Review 摘要应人工确认：

- 仅描述"做什么"不展示"怎么做"的步骤（非显然模式——复杂正则/算法/配置结构——须给代码块；显然改动不要求，对齐 SKILL.md「Actionable Steps」）
- 引用未在任何 task 定义的类型或函数

## ready 影响

`lintPlaceholder.hits` 非空 → `cmdPlanReview` 返回 `ready=false`，必须修复后才能进入 execute。
