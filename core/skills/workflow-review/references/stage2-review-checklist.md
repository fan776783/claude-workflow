# Stage 2 代码质量审查清单

> 供 Stage 2 子 Agent Prompt 引用。主流程在 `SKILL.md` Step 3。

## 审查维度

| 类别 | 检查内容 |
|------|----------|
| **架构设计** | 关注点分离、可扩展性 |
| **代码质量** | DRY 原则、错误处理、类型安全 |
| **测试质量** | 测试逻辑而非 mock、边界覆盖 |
| **安全性** | 输入验证、权限检查、数据泄露 |
| **代码复用** | 参考运行时 `.claude/.agent-workflow/specs/guides/code-reuse-checklist.md`；具体反模式见下文 Reuse 角度 |
| **效率** | 重复计算 / 并发漏配 / 热路径阻塞 / 内存泄漏等；具体反模式见下文 Efficiency 角度 |
| **跨层完整性** | 跨 3+ 层时参考运行时 `.claude/.agent-workflow/specs/guides/cross-layer-checklist.md` |
| **组件复杂度** | 单组件 JSX 是否超过 200 行？是否需要拆分？ |
| **功能堆砌** | 主入口文件是否包含 3+ 个独立功能面板？是否缺少路由？ |

## 三角度反模式清单（Reuse / Quality / Efficiency）

> single_reviewer 和 dual_reviewer 模式可以把下列三段当作具体锚点；
> multi_angle 模式下这三段分别作为三个子 Agent 的专属 prompt 片段。

### Reuse 角度

1. **已有工具覆盖新代码**：先在 utils / shared / 邻近模块里搜一遍，再决定是否新写函数
2. **重复实现既有功能**：新函数命中已有函数语义时，直接建议替换
3. **内联逻辑应抽到已有工具**：hand-rolled 字符串处理、路径拼接、环境判断、type guard 等是常见候选

### Quality 角度

1. **冗余 state**：能推导的值不应再存一份，observer / effect 能直接调用就不要绕 state
2. **参数膨胀**：一味往旧函数里加参数，而不是重新抽象
3. **复制粘贴的变体**：近似的代码块应统一成共享抽象
4. **破坏抽象**：暴露内部细节、越过既有分层边界
5. **stringly-typed**：字符串硬编码应改常量、枚举（string union）或 branded type
6. **无意义的 JSX 嵌套**：包裹 Box 没有布局价值 → 用内层 `flexShrink / alignItems` 等 props 搞定
7. **深层嵌套条件**：三目链、if/else / switch 嵌套 3 层以上 → early return、guard clause、lookup table 或 if/else-if cascade
8. **无意义注释**：解释代码 WHAT 的注释直接删；只保留说明隐藏约束 / 非直觉不变量 / workaround 的 WHY

### Efficiency 角度

1. **不必要的工作**：重复计算、重复读文件、重复网络调用、N+1
2. **错失的并发**：独立操作串行跑本可以并行
3. **热路径阻塞**：启动 / 每请求 / 每渲染路径被塞了新的阻塞动作
4. **循环里的 no-op 更新**：轮询 / interval / event handler 里无条件触发 state / store 更新 → 加 change-detection；如果 wrapper 接 updater/reducer，需保证 same-reference 返回不破坏上游 early return
5. **多余的存在性检查**：先 stat 再操作的 TOCTOU 反模式 → 直接操作并处理错误
6. **内存问题**：无界结构、没清理的订阅、泄漏的事件监听
7. **过度宽范围操作**：整文件读 / 全量拉取，只用一部分

## 问题严重级别

| 级别 | 定义 | 是否阻塞 |
|------|------|----------|
| **Critical** | 会导致 bug、安全漏洞或数据丢失 | ✅ 必须修复 |
| **Important** | 会影响可维护性或导致未来 bug | ✅ 应当修复 |
| **Minor** | 风格偏好、优化机会 | ❌ 不标记（建议性） |

**判定规则**：Approve unless there are Critical or Important issues。

## 误报过滤（~35% 预期误报率）

对所有 Critical / Important 发现，必须执行验证流程：

1. **LOCATE** — 定位审查指出的代码位置
2. **TRACE** — 追踪相关数据流和调用链
3. **CONTEXT** — 检查代码注释中的设计意图
4. **VERIFY** — 确认问题是否真实存在
5. **DECIDE** — 过滤误报后计入最终结果

> 详见运行时 `.claude/.agent-workflow/specs/guides/ai-review-false-positive-guide.md`。

## 输出格式

```
**Status:** Approved | Issues Found

**Strengths:**
- [做得好的地方]

**Issues (if any):**
- [Critical/Important] [文件:行号]: [问题描述] — [建议修复]

**Recommendations (advisory, do not block approval):**
- [Minor 级别建议]
```

## 统一 Finding 结构（dual_reviewer / multi_angle 共用）

Stage 2 走 `dual_reviewer`（Codex + 子 Agent）或 `multi_angle`（Reuse / Quality / Efficiency 三子 Agent）时，各路结果须归一化为以下结构后再合并判定：

```json
{
  "id": "F-01",
  "source": "codex | subagent | reuse_agent | quality_agent | efficiency_agent | both | multi",
  "file": "path/to/file.ts",
  "line_start": 10,
  "line_end": 24,
  "severity": "critical | important | minor",
  "category": "logic | security | performance | architecture | test | style | reuse | efficiency",
  "description": "...",
  "suggestion": "...",
  "verification": {
    "status": "verified | partially_verified | rejected",
    "notes": "..."
  }
}
```

**合并规则**：
- 相同 file + line range（重叠 ≥50%）+ 相同 category → 合并；`dual_reviewer` 下记为 `source: "both"`，`multi_angle` 下记为 `source: "multi"`
- 任一来源有 verified Critical/Important → 最终判定为 Issues Found
- `partially_verified` 不能作为 Critical/Important 的依据
- Codex 候选必须经过 LOCATE→TRACE→CONTEXT→VERIFY→DECIDE 验证流程
- multi_angle 的角度子 Agent 输出不走 LOCATE→…→DECIDE，但 category 字段必须显式标注（reuse / efficiency / 其它）以便去重
