# Codex Spec Augmentation Checklist（workflow-review Stage 2 可选）

> 供 workflow-review Stage 2 在 `spec.metadata.risk_signals[]` 命中 `security` / `backend_heavy` / `data` 时使用。Codex 作为**spec-级第二意见**，**不重审单 task 代码质量**（execute Step 5.2 reviewer 已覆盖）。代码质量三角度（Reuse / Quality / Efficiency）见 execute `prompts/reviewer.md` Phase 2 + `diff-review/specs/anti-patterns-three-angle.md`。

## 触发条件

仅在 `spec.metadata.risk_signals[]` 显式包含以下任一时启用 codex_enhanced：

| risk_signal | 触发原因 | Codex 关注 |
|-------------|----------|-----------|
| `security` | 涉及认证 / 授权 / 加密 / 敏感数据 | spec §1 安全成功标准是否兑现；跨 task 安全contract是否一致（token shape / scope 命名 / 加密算法） |
| `backend_heavy` | DB schema / API contract / 服务边界 | API contract前后一致；DB schema 与 spec §5.6 一致；服务边界未越权 |
| `data` | 数据迁移 / 持久化 schema delta / 关键查询 | 数据流符合 spec §5.6；迁移可回滚；关键查询性能特性符合 spec |

未命中 → workflow-review 不启动 Codex，仅做 Step 3.1 终态卫生。

## Codex prompt 聚焦

```
你是 spec-级第二意见审查员。
本次 workflow 已完成所有 task，per-task reviewer 已覆盖单 task AC + 代码质量（critical/important）。
你的任务**不是**重审单 task 代码质量，**是**回答以下三个问题：

1. spec §1 列出的成功标准是否每条都有可验证证据？逐条核对，给文件:行号或测试输出。
2. 跨 task 共享的contract（JSON schema / function signature / 配置 key / API 路径）是否前后一致？
   列出contract清单 → 在所有引用点 grep → 标出不一致。
3. workflow是否引入了 spec 未声明的contract变化（新 API / 新 schema 字段 / 新外部依赖）？
   列出，标"声明" or "未声明"。

risk_signals: <从 spec.metadata.risk_signals 注入>

输出 strict JSON，schema：
{
  "spec_section_1_coverage": [{ "criterion": "...", "evidence": "file:line | test:name", "verified": true | false }],
  "cross_task_contracts": [{ "contract": "...", "consistent": true | false, "references": ["file:line"], "deviation": "<如不一致>" }],
  "undeclared_contracts": [{ "what": "...", "where": "file:line", "severity": "critical | important" }],
  "overall_assessment": "approved" | "issues_found"
}
```

## Finding 归一化（合并本会话 Stage 1 + Codex）

```json
{
  "id": "F-01",
  "source": "session | codex | both",
  "category": "spec_coverage | cross_task_contract | undeclared_contract",
  "file": "path/to/file.ts",
  "line_start": 10,
  "line_end": 24,
  "severity": "critical | important",
  "description": "...",
  "suggestion": "...",
  "verification": {
    "status": "verified | partially_verified | rejected",
    "notes": "..."
  }
}
```

**合并规则**：
- 相同 contract / criterion → 合并为 `source: "both"`
- 任一来源 verified Critical/Important → 最终 `issues_found`
- `partially_verified` 不能作为 Critical/Important 的依据
- Codex 候选必须经过 LOCATE→TRACE→CONTEXT→VERIFY→DECIDE 验证（约 35% 预期误报率）

## 降级路径

- Codex 5 min 超时 / 失败 → label 标 `codex_enhanced (codex_degraded)`，仅本会话 Stage 1 结论作为 Stage 2 spec-级判定
- Codex 返回非 JSON / schema 不合规 → 重试 1 次；仍失败 → 同上降级

## 与 execute Step 5.2 reviewer 的边界

| 维度 | 谁负责 |
|------|--------|
| 单 task AC 覆盖 / 超额 / 关键约束 | execute Step 5.2 reviewer Phase 1 |
| 单 task 代码质量 critical/important/minor | execute Step 5.2 reviewer Phase 2 |
| spec §1 成功标准兑现汇总 | workflow-review Stage 1（+ 可选 Codex 增援） |
| 跨 task contract一致性 | workflow-review Stage 1（+ 可选 Codex 增援） |
| workflow未声明contract变化 | workflow-review Stage 2 Codex 增援（命中时） |
| 终态卫生（state / git / e2e smoke / report_path） | workflow-review Stage 2 |

**禁止**：Codex 在本 checklist 内重审单 task 代码质量（HG-5）。
