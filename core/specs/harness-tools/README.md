# Harness Tool Mapping Reference

> 每个支持的 AI 编码工具（harness）一个映射文件，列出该平台的 dispatch tool、subagent 支持、hook 机制等。
> `core/skills/workflow-execute/references/subagent-driven.md` 的平台 fallback 矩阵是快速查阅；本目录是详细参考。

## 文件清单

| Harness | 映射文件 | 分发方式 |
|---------|----------|----------|
| Claude Code | `claude-code-tools.md` | 原生 Plugin |
| CodeBuddy | `codebuddy-tools.md` | installer-mount |
| Cursor | `cursor-tools.md` | installer-mount |
| Codex | `codex-tools.md` | installer-mount |
| Antigravity (`agy`) | `antigravity-tools.md` | 原生 Plugin |
| OpenCode | `opencode-tools.md` | installer-mount |
| Droid | `droid-tools.md` | installer-mount |
| GitHub Copilot | `github-copilot-tools.md` | installer-mount |
| Qoder | `qoder-tools.md` | installer-mount |

## 添加新 Harness

新增 harness 时，参考 [`docs/porting-to-a-new-harness.md`](../../../docs/porting-to-a-new-harness.md) 的三种集成形态，创建对应的映射文件，并更新本索引 + `lib/agents.js` + `core/specs/platform-parity.md`。
