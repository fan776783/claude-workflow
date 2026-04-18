# Knowledge Bootstrap（已迁出）

Knowledge 骨架生成和内容填充的完整流程不再由 `/workflow-plan` 承担，已迁移到独立命令链：

- `/scan` Part 5：在项目扫描阶段识别是否需要 bootstrap，并提示用户。
- `/knowledge-bootstrap`：生成 `.claude/knowledge/` 骨架（frontend / backend / guides 三层）。
- `/knowledge-update`：把代码分析、execute 阶段沉淀的候选内容晋升到正式规范文件。

在 `/workflow-plan` 里保留的是**轻量 advisory 读取**（Step 1.5）：通过 `getKnowledgeContext()`（`core/utils/workflow/task_runtime.js`）读取 `.claude/knowledge/` 目录下所有可用内容（根 `index.md` + 各层 `index.md` + 已填充的规范文件），汇总成 Constraints 输入。读取只要目录存在就生效，不依赖任何单一文件是否就位；过程不写文件、不阻塞流程。

如需查看 bootstrap 的生成规则、模板映射和用户提示文案，请阅读对应命令的 SKILL.md 文件，而不是本文件。
