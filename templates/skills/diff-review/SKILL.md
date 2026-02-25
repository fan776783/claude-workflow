---
name: diff-review
description: "代码审查 - 基于 git diff 的结构化审查，支持 Quick 模式（Claude 单模型）和 Deep 模式（Codex + Gemini 多模型并行）。默认 Deep 模式，--quick 切换为快速审查。触发条件：用户调用 /diff-review，或请求代码审查、PR 审查、提交前检查。支持 --staged、--branch 等参数。"
---

# 代码审查

## 用法

`/diff-review [OPTIONS]`

| 参数 | 说明 |
|------|------|
| (无) | 审查 `git diff HEAD`，多模型并行 |
| `--staged` | 仅审查已暂存变更 |
| `--branch <base>` | 审查相对 base 分支的变更 |
| `--quick` | 单模型快速审查（仅 Claude） |

## 模式路由（强制执行）

检查 `$ARGUMENTS` 是否包含 `--quick`：

- **包含 `--quick`**: 读取 [references/quick-mode.md](references/quick-mode.md) 并严格执行其流程
- **不包含 `--quick`（默认 Deep 模式）**: **必须**读取 [references/deep-mode.md](references/deep-mode.md) 并严格执行其流程。Deep 模式**必须**通过 `codeagent-wrapper` 并行调用 Codex 和 Gemini，禁止跳过外部模型调用而由 Claude 单独完成审查

**⚠️ 关键约束**: Deep 模式下，如果没有执行 `codeagent-wrapper --backend codex` 和 `codeagent-wrapper --backend gemini` 的并行调用，则审查流程不合规。不得以任何理由省略外部模型调用步骤。

## 通用：获取 Diff

```bash
# 根据参数选择 diff 命令
git diff HEAD          # 默认
git diff --staged      # --staged
git diff <base>...HEAD # --branch <base>

git status --short
```

## 优先级定义

| 级别 | 含义 |
|------|------|
| P0 | 阻塞发布 |
| P1 | 应尽快处理 |
| P2 | 最终需修复 |
| P3 | 有则更好 |

## Verdict 规则

| 场景 | Verdict |
|------|---------|
| 无 P0/P1 | CORRECT |
| 任一 P0 | INCORRECT |
| Consensus P1+ | INCORRECT |
| 模型失败，无 P0 | CORRECT (degraded) |

## 审查标准

按以下标准识别问题：
1. 影响准确性、性能、安全性或可维护性
2. 问题具体且可操作
3. 是本次变更引入的（非预先存在）
4. 如认为破坏其他部分，必须找到具体受影响代码

**忽略**: 琐碎风格、纯格式、拼写、文档补充

## 审查反馈技术验证（Deep 模式）

收到 Codex/Gemini 的审查意见后，当前模型必须对 P0/P1 建议执行技术验证（最多验证 5 条，超出按原始优先级保留）：

**验证流程**：

1. **代码库验证**：检索代码库，验证建议所描述的问题是否真实存在
2. **YAGNI 检查**：建议要求添加新功能/抽象时，检查是否有实际使用场景（安全/正确性类发现豁免此检查）
3. **副作用评估**：评估实施建议是否会引入新问题

**处理规则**：

| 验证结果 | 处理 |
|----------|------|
| 问题真实存在 | 保留，纳入最终报告 |
| 问题不存在 | 降级或移除，标注"经验证，该问题在当前代码库中不存在"并附检索证据 |
| YAGNI 不通过（非安全类） | 降级为 P3，标注"当前无实际使用场景" |
| 有副作用风险 | 保留但补充风险说明 |

**禁止行为**：
- 不加验证地全盘接受外部模型的所有建议
- 对明显错误的建议表示"完全同意"
- 实施与当前代码库风格/架构不一致的建议
