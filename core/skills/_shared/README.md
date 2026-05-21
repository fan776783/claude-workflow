# `_shared/` — 跨 skill 共享模块（非 skill）

下划线前缀目录不是 skill（无 `SKILL.md`），不会被 AI 工具识别为 skill。专门用于多个 skill CLI 共享的 Node 模块。

## 当前模块

| 文件 | 用途 | 消费者 |
|------|------|--------|
| `mcp-baseline.mjs` | MCP RPC + schema cache + fingerprint + 危险工具兜底 + 错误归一化 | `bk` / `alidocs` / `figma-data` CLI |
| `mcp-baseline.test.mjs` | 上述模块的 fixture 测试（用 `node --test` 跑） | — |

## 引用方式

各 skill CLI 用相对路径 import：

```js
// 在 core/skills/bk/cli/bk.mjs 中
import { McpToolsCache, callTool, normalizeMcpError } from "../../_shared/mcp-baseline.mjs";
```

mount 到用户 AI 工具后，`_shared/` 仍与各 skill 平级，相对路径不变。

## 测试

```bash
node --test core/skills/_shared/mcp-baseline.test.mjs
```

需要 Node ≥ 18（内建 `node:test`）。无外部依赖。
