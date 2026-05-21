# Shared Protocol References

跨 skill 的共享协议索引。每个 skill 在 `<CONTEXT>` 块中内联声明自己需要读什么，不再通过本文件做前置门控。

## Workflow CLI

路径 convention 和写入 contract 见 [`./workflow-cli.md`](./workflow-cli.md)。

## 共享协议引用表

skill 内部用到下列跨 skill 的协议时,写引用而非复写:

| 协议文件 | 何时引用 | 引用范例 |
|---|---|---|
| `glossary.md` | 产出 normative 文档前 | `core/specs/shared/glossary.md` |
| `architecture-language.md` | 讨论 module / interface / depth / seam / adapter / refactor 时 | `core/specs/shared/architecture-language.md § Terms` |
| `manual-intervention-reasons.md` | 产出 manual_intervention 分支(fix-bug/bug-batch) | `core/specs/shared/manual-intervention-reasons.md` |
| `codex-routing.md` | review路径判定 | `core/specs/shared/codex-routing.md § Decision Table` |
| `status-readiness.md` | 缺陷 / issue 状态流转(fix-bug/bug-batch) | `core/specs/shared/status-readiness.md` |
| `impact-analysis-template.md` | 影响面分析 | `core/specs/shared/impact-analysis-template.md § 6 个维度` |
| `hard-stop-templates.md` | 两类 Hard Stop 卡点语义(fix-bug/bug-batch) | `core/specs/shared/hard-stop-templates.md` |

原则:**协议本体只写一份,skill 里只说"查 XX § YY"**。

## 相关文件

- [`./workflow-cli.md`](./workflow-cli.md) — Workflow CLI 路径 convention + 写入 contract
- [`../workflow-runtime/preflight.md`](../workflow-runtime/preflight.md) — 运行时启动检查(Git / project-config / 未收尾 workflow)
- [`./glossary.md`](./glossary.md) — canonical glossary(框架层)
- [`./business-glossary.md`](./business-glossary.md) — 业务层术语协议
- [`./adr-protocol.md`](./adr-protocol.md) — ADR 三重门槛协议
