# Stage 2 代码质量review清单

> 供 Stage 2 子 Agent Prompt 引用。主workflow在 `SKILL.md` Step 3。

## review维度

| 类别 | 检查内容 |
|------|----------|
| **架构设计** | 关注点分离、可扩展性 |
| **代码质量** | DRY 原则、错误处理、类型安全 |
| **测试质量** | 测试逻辑而非 mock、边界覆盖 |
| **安全性** | 输入验证、权限检查、数据泄露 |
| **代码复用** | 参考运行时 `.claude/.agent-workflow/specs/guides/code-reuse-checklist.md`；具体反模式见 [`anti-patterns-three-angle.md`](../../diff-review/specs/anti-patterns-three-angle.md) § Reuse 角度 |
| **效率** | 重复计算 / 并发漏配 / 热路径阻塞 / 内存泄漏等；具体反模式见 [`anti-patterns-three-angle.md`](../../diff-review/specs/anti-patterns-three-angle.md) § Efficiency 角度 |
| **跨层完整性** | 跨 3+ 层时参考运行时 `.claude/.agent-workflow/specs/guides/cross-layer-checklist.md` |
| **组件复杂度** | 单组件 JSX 是否超过 200 行？是否需要拆分？ |
| **功能堆砌** | 主入口文件是否包含 3+ 个独立功能面板？是否缺少路由？ |

## 三角度反模式清单（Reuse / Quality / Efficiency）

详见 [`../../diff-review/specs/anti-patterns-three-angle.md`](../../diff-review/specs/anti-patterns-three-angle.md)。

- `single_reviewer` / `dual_reviewer` 模式：把三段作为整体锚点
- `multi_angle` 模式：三段分别作为 Reuse / Quality / Efficiency 三个子 Agent 的专属 prompt 片段
- `quad_review` 模式：三段分别作为 quad 中 Reuse / Quality / Efficiency 三个子 Agent 的专属 prompt 片段（Codex 另走 `correctness` category，不使用本文档）

## 问题严重级别

| 级别 | 定义 | 是否阻塞 |
|------|------|----------|
| **Critical** | 会导致 bug、安全漏洞或数据丢失 | ✅ 必须修复 |
| **Important** | 会影响可维护性或导致未来 bug | ✅ 应当修复 |
| **Minor** | 风格偏好、优化机会 | ❌ 不标记（建议性） |

**判定规则**：Approve unless there are Critical or Important issues。

## 误报过滤（~35% 预期误报率）

对所有 Critical / Important 发现，必须执行验证workflow：

1. **LOCATE** — 定位review指出的代码位置
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

## 统一 Finding 结构（dual_reviewer / multi_angle / quad_review 共用）

Stage 2 走 `dual_reviewer`（Codex + 子 Agent）、`multi_angle`（Reuse / Quality / Efficiency 三子 Agent）或 `quad_review`（Codex + 三子 Agent 四路）时，各路结果须归一化为以下结构后再合并判定：

```json
{
  "id": "F-01",
  "source": "codex | subagent | reuse | quality | efficiency | both | multi",
  "file": "path/to/file.ts",
  "line_start": 10,
  "line_end": 24,
  "severity": "critical | important | minor",
  "category": "correctness | logic | security | performance | architecture | test | style | reuse | quality | efficiency",
  "description": "...",
  "suggestion": "...",
  "verification": {
    "status": "verified | partially_verified | rejected",
    "notes": "..."
  }
}
```

**合并规则**：
- `dual_reviewer`：相同 file + line range（重叠 ≥50%）+ 相同 category → 合并为 `source: "both"`
- `multi_angle`：相同条件 → 合并为 `source: "multi"`
- `quad_review`：**category 独占**——Codex 专属 `correctness`（含 security subtype），三子 Agent 分别独占 `reuse` / `quality` / `efficiency`；不同 category 同位置 finding 全部保留；同 category 重叠兜底 dedup（理论上不发生，因独占纪律）
- 任一来源有 verified Critical/Important → 最终判定为 Issues Found
- `partially_verified` 不能作为 Critical/Important 的依据
- Codex 候选必须经过 LOCATE→TRACE→CONTEXT→VERIFY→DECIDE 验证workflow
- 子 Agent（multi_angle / quad_review）输出不走 LOCATE→…→DECIDE，但 category 字段必须显式标注以便去重
- quad_review 中超域发现（例如 Reuse agent 发现 correctness 问题）写入各路的 `out_of_scope_observations`，不进主 finding 列表；主任务可在合并阶段评估是否采纳
