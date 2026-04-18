# Deep Review Mode

Codex 协作审查。不是把 Codex 意见直接展示给用户，而是将 Codex 与当前模型的候选问题统一纳入 adjudication pipeline，完成验证、影响分析和最终裁决。

## 角色

**代码审查协调员**，编排双来源候选问题：

1. **Codex** — 后端逻辑、安全、性能、资源管理候选问题
2. **Claude (Self)** — 前端 UI/UX、可访问性、状态管理、交互行为候选问题
3. **Claude (Self)** — 统一裁决：归一化、验证、impact analysis、severity calibration、最终报告

## 执行原则

- Codex 输出的是**候选问题**，不是最终 findings
- 最终进入报告的问题必须经过当前模型统一验证与 impact analysis
- 只有通过验证的问题才能出现在最终报告中
- 报告结构必须遵循 `../specs/report-schema.md`
- 输出报告后默认停止；只有用户明确确认要修复并输入 `fix`，才进入 Review Loop

## 流程

### Layer A: 审查范围确认 + Diff Acquisition

1. 确定审查范围：
   - 默认：已暂存变更（`git diff --staged`）
   - `--branch <base>`：分支差异（`git diff <base>...HEAD`）
2. 获取 diff 与状态
3. 统计变更文件、+/- 行数

### Layer B: File Classification

将变更文件分为两类：

- **后端文件**：`*.js, *.ts, *.py, *.go, *.java, *.rs` 等（非组件）
- **前端文件**：`*.tsx, *.jsx, *.vue, *.svelte, *.css, *.scss` 等

如遇全栈文件或边界不清晰文件，允许同时纳入两个视角审查。

### Layer C-H: 共享审查管线

从候选问题发现到最终报告的全部流程（Candidate Discovery → Normalization → Verification → Impact Analysis → Severity Calibration → Report Synthesis）已统一抽出到 [`../specs/review-pipeline.md`](../specs/review-pipeline.md)。

**调用约定**：Layer A/B 完成后，把变更集（来源描述 + 文件清单 + 统计）交给共享管线。Codex prompt 里必须显式把审查范围限定到本次 diff，避免误审。

### Deep 模式额外要求

- 若桥接脚本实际执行后返回错误（即 Codex 调用失败），但当前模型未发现 P0，可输出 `CORRECT (degraded)`，并在 Summary 中明确说明失败原因。未尝试调用就声称"不可用"不属于此降级路径
- 若某个高优先级候选问题无法完成验证，不得直接进入最终 findings
- `partially_verified` 不能单独阻断 Verdict，也不能作为最终 P0/P1
- Source 归属不能替代 verification；`Source = Both` 只说明双方都发现了它，不说明它一定成立

## Review Loop 要求

Review Loop 的完整契约见 `../specs/review-pipeline.md`。Deep 模式在此基础上默认停在报告阶段，不自动转入修复；用户显式输入 `fix` 后才进入修复循环。
