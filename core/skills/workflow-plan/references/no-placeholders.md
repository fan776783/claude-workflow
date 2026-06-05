# No Placeholders 规则

Plan 中出现以下任一 token 即为 plan failure。`plan-review` CLI 的 `lintPlaceholder` 自动校验,无需人工扫描。

## 英文 tokens（hard block）

- `TBD`
- `TODO`
- `implement later`
- `fill in details`
- `Add appropriate error handling`
- `add validation`
- `Write tests for the above`(无实际测试代码)
- `Similar to Task N`(必须重复代码,读者可能乱序)

## 中文 / 模板语言 tokens（hard block）

- `待补充`
- `暂未确定`
- `稍后完善`
- 形如 `TODO` + 后续完善描述
- `[填这里]`
- `[待定]`
- `【占位】`（显式括号标记）

> 裸 `占位` **不**进 lint：前端语境 `占位图` / `占位符` / `占位 icon` / `展示占位` 是高频业务名词,误报率 100%。真·填空用 `【占位】`。

## 模板残留（hard block）

- `{{name}}` 形式的未渲染模板占位符,落盘后不应出现。

## 语义型占位（人工判定,不在 lint 范围）

下列不进 lint(语法上无法识别),但 Self-Review 摘要应人工确认:

- 仅描述"做什么"不展示"怎么做"的步骤(非显然模式——复杂正则/算法/配置结构——须给代码块;显然改动不要求,对齐 SKILL.md「Actionable Steps」)
- 引用未在任何 task 定义的类型或函数

## ready 影响

`lintPlaceholder.hits` 非空 → `cmdPlanReview` 返回 `ready=false`,必须修复后才能进入 execute。
