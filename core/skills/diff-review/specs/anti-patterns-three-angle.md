# 三角度反模式清单（Reuse / Quality / Efficiency）

> 代码审查共享锚点。参照 Claude Code 内置 `simplify` skill 的三角度分类，适用于本仓库的所有 review skill：
> - `diff-review`（含 `--session` 模式）：当前模型自审（`review-pipeline.md` Layer C）读取本清单作为反模式锚点
> - `workflow-review`：Stage 2 `single_reviewer` / `dual_reviewer` 作为锚点；`multi_angle` 与 `quad_review` 模式下，三段分别作为 Reuse / Quality / Efficiency 三个子 Agent 的专属 prompt 片段（`quad_review` 另有一路 Codex 走 `correctness` category，不使用本文档）

## Reuse 角度

1. **已有工具覆盖新代码**：先在 utils / shared / 邻近模块里搜一遍，再决定是否新写函数
2. **重复实现既有功能**：新函数命中已有函数语义时，直接建议替换
3. **内联逻辑应抽到已有工具**：hand-rolled 字符串处理、路径拼接、环境判断、type guard 等是常见候选

## Quality 角度

1. **冗余 / 重复的 state**：与已有 state 重复存一份，或能从已有值推导出来；observer / effect 能直接调用就不要绕 state
2. **参数膨胀**：一味往旧函数里加参数，而不是重新抽象
3. **复制粘贴的变体**：近似的代码块应统一成共享抽象
4. **破坏抽象**：暴露内部细节、越过既有分层边界
5. **stringly-typed**：字符串硬编码应改常量、枚举（string union）或 branded type
6. **无意义的 JSX 嵌套**：包裹 Box 没有布局价值 → 用内层 `flexShrink / alignItems` 等 props 搞定
7. **深层嵌套条件**：三目链、if/else / switch 嵌套 3 层以上 → early return、guard clause、lookup table 或 if/else-if cascade
8. **无意义注释**：解释代码 WHAT 的注释直接删；只保留说明隐藏约束 / 非直觉不变量 / workaround 的 WHY。也不要把改动叙述（`for Y flow` / `used by X` / `added for issue #123`）写进注释，这些属于 PR 描述

## Efficiency 角度

1. **不必要的工作**：重复计算、重复读文件、重复网络调用、N+1
2. **错失的并发**：独立操作串行跑本可以并行
3. **热路径阻塞**：启动 / 每请求 / 每渲染路径被塞了新的阻塞动作
4. **循环里的 no-op 更新**：轮询 / interval / event handler 里无条件触发 state / store 更新 → 加 change-detection；如果 wrapper 接 updater/reducer，需保证 same-reference 返回不破坏上游 early return
5. **多余的存在性检查**：先检查文件/资源存在再操作的 TOCTOU 反模式 → 直接操作并处理错误
6. **内存问题**：无界结构、没清理的订阅、泄漏的事件监听
7. **过度宽范围操作**：整文件读 / 全量拉取，只用一部分
