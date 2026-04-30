# Codex 入门配置指南

> 面向初次使用者的 Codex CLI 安装与文件配置说明

**文档版本**：v1.0.0
**最后更新**：2026-04-30

---

## 目录

- [1. 文档说明](#1-文档说明)
- [2. 使用前准备](#2-使用前准备)
- [3. 安装 Node.js](#3-安装-nodejs)
- [4. 安装 Codex CLI](#4-安装-codex-cli)
- [5. 通过文件进行配置](#5-通过文件进行配置)
- [6. 完整配置示例](#6-完整配置示例)
- [7. 配置项说明](#7-配置项说明)
- [8. 启动与验证](#8-启动与验证)
- [9. 常见问题](#9-常见问题)
- [10. 推荐做法](#10-推荐做法)

---

## 1. 文档说明

这是一份面向新手的 Codex CLI 入门配置文档，参考《Claude Code 入门配置指南》的结构组织，并结合当前公司内网 Codex 接入方式整理而成。

本文档只保留一种推荐配置方式：**通过文件设置 `~/.codex/config.toml` 与 `~/.codex/auth.json`**。

也就是说，这里不会再展开：

- 环境变量临时设置
- 环境变量永久设置
- 通过 `codex login` 命令进行的交互登录方式

如果你的目标是尽快完成 Codex CLI 基础接入，按本文步骤操作即可。

> 和 Claude Code 的区别：Codex 使用 TOML 格式的配置文件，认证信息单独保存在 `auth.json` 中；模型与接入地址通过 `model_providers` 段配置，而不是通过环境变量。

---

## 2. 使用前准备

在开始之前，请先确认以下几点：

- 你的电脑已经安装 Node.js，且版本不低于 18
- 你可以正常使用 `npm`
- 你已经拿到接入 Codex 所需的服务地址和 API Key
- 你准备通过 `config.toml` + `auth.json` 文件统一管理配置

推荐使用 PowerShell 作为 Windows 下的命令行工具；macOS / Linux 下使用系统默认终端即可。

---

## 3. 安装 Node.js

如果你还没有安装 Node.js，建议优先安装 Node.js LTS 版本。

### 3.1 Windows 安装方式

最常见的方式是前往 Node.js 官网下载安装包，然后按默认选项完成安装。

安装完成后，打开 PowerShell，执行：

```powershell
node --version
npm --version
```

如果能看到版本号，说明 Node.js 和 npm 已安装成功。

### 3.2 版本要求

Codex CLI 建议使用 Node.js 18 及以上版本。为了减少兼容问题，更推荐使用较新的 LTS 版本。

---

## 4. 安装 Codex CLI

在终端中执行以下命令安装 Codex CLI：

```powershell
npm install -g @openai/codex
```

安装完成后，执行下面的命令检查是否安装成功：

```powershell
codex --version
```

如果终端输出了类似 `codex-cli 0.125.0` 的版本号，说明 Codex CLI 已安装完成。

---

## 5. 通过文件进行配置

本指南只使用文件配置方式。

Codex 的配置由两个文件共同组成，都放在用户目录下的 `.codex/` 文件夹中：

| 文件 | 作用 |
| --- | --- |
| `config.toml` | 模型、provider、sandbox、MCP、项目信任等主配置 |
| `auth.json` | API Key 等认证信息 |

### 5.1 Windows

```text
C:/Users/你的用户名/.codex/config.toml
C:/Users/你的用户名/.codex/auth.json
```

### 5.2 macOS / Linux

```text
~/.codex/config.toml
~/.codex/auth.json
```

如果这两个文件还不存在，可以手动创建。

如果 `.codex` 目录还不存在，也可以先手动创建目录，再创建这两个文件。

---

## 6. 完整配置示例

下面是一份可直接参考的配置示例。

这份配置的定位很明确：**使用本配置后，可以在 Codex CLI 中直接接入公司内网提供的模型网关，使用 `gpt-5.5` 系列模型，并启用 MCP Router 作为默认 MCP 服务入口。**

### 6.1 `~/.codex/config.toml`

```toml
disable_response_storage = true
model = "gpt-5.5"
model_provider = "eec"
model_reasoning_effort = "high"
preferred_auth_method = "apikey"
sandbox_mode = "workspace-write"

[model_providers.eec]
base_url = "https://new-api.300624.cn/v1"
name = "eec"
requires_openai_auth = true
wire_api = "responses"

[sandbox_workspace_write]
network_access = true

[features]
multi_agent = true

```

### 6.2 `~/.codex/auth.json`

```json
{
  "OPENAI_API_KEY": "sk-你的真实 API Key"
}
```

完成配置后，Codex CLI 会通过 `model_providers.eec` 中的 `base_url` 指向公司提供的网关地址，并使用 `auth.json` 中的 API Key 进行鉴权。

如果后续认证信息、服务地址或模型版本变化，只需要修改这两个文件，不需要反复设置环境变量。

---

## 7. 配置项说明

下面对这份配置中的关键字段做一个入门级说明。

### 7.1 主模型与推理强度

#### `model`

指定当前默认使用的模型：

```toml
model = "gpt-5.5"
```

这里对应的是 `model_providers.eec` 中暴露的模型 ID。实际接入公司网关时，以网关侧支持的模型名为准。

#### `model_provider`

指定默认 provider：

```toml
model_provider = "eec"
```

和下方 `[model_providers.eec]` 对应，表示走公司内网网关而不是 OpenAI 官方地址。

#### `model_reasoning_effort`

控制推理强度：

```toml
model_reasoning_effort = "high"
```

常见可选值有 `low` / `medium` / `high` / `xhigh`，数值越高越偏向更深入的推理，但响应也会更慢。

#### `model_context_window`

声明模型上下文窗口大小（单位 token）：

```toml
model_context_window = 1000000
```

这里按你当前网关提供的 1M 窗口档位配置。

### 7.2 认证方式

#### `preferred_auth_method`

```toml
preferred_auth_method = "apikey"
```

表示优先使用 API Key 方式鉴权（对应 `auth.json` 里的 `OPENAI_API_KEY`），而不是 `codex login` 交互登录。

#### `auth.json` 中的 `OPENAI_API_KEY`

```json
{
  "OPENAI_API_KEY": "sk-你的真实 API Key"
}
```

这是 Codex 请求公司网关时使用的访问凭证。实际使用中，你应当填写真实可用的 API Key。

### 7.3 自定义 Provider

```toml
[model_providers.eec]
base_url = "https://new-api.300624.cn/v1"
name = "eec"
requires_openai_auth = true
wire_api = "responses"
```

- `base_url`：公司内网模型网关地址，Codex 走这个端点而不是 OpenAI 官方地址。
- `requires_openai_auth = true`：表示该 provider 仍然使用 OpenAI 风格的鉴权头（`Authorization: Bearer ...`）。
- `wire_api = "responses"`：走 OpenAI Responses API 风格协议。

### 7.4 响应存储与隐私

#### `disable_response_storage`

```toml
disable_response_storage = true
```

关闭服务端侧的响应存储能力，适合公司内网接入这种对数据外发比较敏感的场景。

### 7.5 Sandbox 与网络

#### `sandbox_mode`

```toml
sandbox_mode = "workspace-write"
```

Codex 在当前工作区内对文件具有写权限，但对工作区之外的位置默认受限。

#### `[sandbox_workspace_write]`

```toml
[sandbox_workspace_write]
network_access = true
```

在 `workspace-write` 模式下放行网络访问，这样 `npm install`、`git`、MCP 调用等依赖网络的操作才能正常进行。

### 7.6 特性开关

#### `[features]`

```toml
[features]
multi_agent = true
```

开启多 agent 能力，使 Codex 可以在一次会话内编排多个 agent。按需保留，不需要时也可以删除该段。

### 7.7 MCP 服务

#### `[mcp_servers.mcp-router]`

```toml
[mcp_servers.mcp-router]
type = "stdio"
command = "npx"
args = ["-y", "@mcp_router/cli@latest", "connect"]

[mcp_servers.mcp-router.env]
MCPR_TOKEN = "mcpr_你的 MCPR Token"
```

把 MCP Router 作为默认 MCP 服务入口，Codex 启动后就能调用 MCP Router 上挂载的各类工具。

`MCPR_TOKEN` 需要替换为你自己的 token，可以在 MCP Router 控制台申请。

如果你暂时不需要 MCP，可以先不写这部分。

### 7.8 项目信任

```toml
[projects."/Users/你的用户名/dev"]
trust_level = "trusted"
```

提前把常用项目目录标记为 `trusted`，可以避免每次在新项目下启动时都弹 Trust 提示。路径支持多条，按需添加。

### 7.9 其他可选字段

Codex 还支持例如 marketplace、plugins、projects 多条目等高级配置，这里不作为入门必需项展开。初学者按 6.1 的最小集起步即可，后续再按需扩展。

---

## 8. 启动与验证

完成文件配置后，重新打开终端，再执行：

```powershell
codex
```

如果你希望在指定项目中使用 Codex，可以先进入项目目录：

```powershell
cd D:\your-project
codex
```

### 8.1 建议的验证顺序

建议按下面顺序检查：

1. `node --version`
2. `npm --version`
3. `codex --version`
4. 检查 `config.toml` 与 `auth.json` 路径是否正确
5. 检查 TOML / JSON 格式是否正确
6. 启动 `codex`

### 8.2 配置生效的关键点

如果你已经修改了配置文件，但终端里仍然表现异常，优先检查：

- 文件路径是否写对（是 `.codex/config.toml` 不是 `.codex.toml`）
- TOML 格式是否有多余空格、引号或漏写了 `=`
- `auth.json` 的 JSON 语法是否合法
- `base_url` 是否可访问（可以 `curl` 一下）
- `OPENAI_API_KEY` 是否有效
- 是否重启了终端

---

## 9. 常见问题

### 9.1 `codex --version` 可以执行，但 `codex` 启动后报鉴权或连接错误

这种情况通常优先检查这几项：

- `~/.codex/auth.json` 中的 `OPENAI_API_KEY` 是否填对
- `config.toml` 中的 `base_url` 是否指向你真实能访问的网关地址
- `preferred_auth_method` 是否设置为 `apikey`
- `model_provider` 是否和下方 `[model_providers.xxx]` 段的名字一致

### 9.2 Windows 下找不到 `config.toml`

你可以手动创建：

```text
C:/Users/你的用户名/.codex/config.toml
C:/Users/你的用户名/.codex/auth.json
```

如果 `.codex` 文件夹不存在，也请一起手动创建。

### 9.3 修改配置后没有生效怎么办

最常见的处理方式是：

- 保存 `config.toml` 和 `auth.json`
- 关闭当前 PowerShell 或终端窗口
- 重新打开终端
- 再次执行 `codex`

### 9.4 TOML / JSON 配置容易写错怎么办

建议使用编辑器打开配置文件，确保：

- TOML 中每个键值对都是 `key = value` 形式
- 字符串值都带有双引号
- `[section]` 标题单独占一行
- JSON 中所有 key 都带双引号
- 没有多余逗号、漏写括号

### 9.5 如何跳过交互登录，只走 API Key

Codex 首次启动时，默认可能会提示你走 `codex login` 交互登录流程。

如果你当前是通过公司网关接入的 API Key 方式，希望避免进入官方登录流程，只需要保证：

```toml
preferred_auth_method = "apikey"
```

并在 `auth.json` 中写入 `OPENAI_API_KEY` 即可。Codex 会优先走 API Key，不再弹登录。

### 9.6 如何避免每次启动都提示 Trust 当前目录

在 `config.toml` 末尾加入：

```toml
[projects."/你的项目绝对路径"]
trust_level = "trusted"
```

Windows 下路径使用正斜杠，例如：

```toml
[projects."C:/Users/你的用户名/dev/your-project"]
trust_level = "trusted"
```

多个项目按同样格式重复添加即可。

### 9.7 是否还需要再配环境变量

按本文档的方式，不需要。

因为这里已经明确采用 **通过文件设置** 的方式，配置统一放在 `config.toml` + `auth.json` 中即可，不再额外介绍环境变量配置。

---

## 10. 推荐做法

对于大多数新手，更推荐采用下面这种最简单的落地方式：

1. 安装 Node.js
2. 安装 Codex CLI
3. 创建 `~/.codex/config.toml`
4. 创建 `~/.codex/auth.json`
5. 将本文示例配置写入文件
6. 重启终端并执行 `codex`

这样做的优点是：

- 配置集中
- 易于维护
- 不容易忘记环境变量
- 后续迁移机器时也更方便

---
