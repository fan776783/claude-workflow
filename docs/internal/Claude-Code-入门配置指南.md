# Claude Code 入门配置指南

> 面向初次使用者的 Claude Code 安装与文件配置说明

**文档版本**：v1.0.0  
**最后更新**：2026-03-25

---

## 目录

- [1. 文档说明](#1-文档说明)
- [2. 使用前准备](#2-使用前准备)
- [3. 安装 Node.js](#3-安装-nodejs)
- [4. 安装 Claude Code](#4-安装-claude-code)
- [5. 通过文件进行配置](#5-通过文件进行配置)
- [6. 完整配置示例](#6-完整配置示例)
- [7. 配置项说明](#7-配置项说明)
- [8. 启动与验证](#8-启动与验证)
- [9. 常见问题](#9-常见问题)

---

## 1. 文档说明

这是一份面向新手的 Claude Code 入门配置文档，参考了 [Claude Code Windows 使用指南](https://docs.88code.org/ClaudeCode/Windows.html) 的基本安装思路，并结合你当前的实际接入方式整理而成。

本文档只保留一种推荐配置方式：**通过文件设置 `~/.claude/settings.json`**。

也就是说，这里不会再展开：

- 环境变量临时设置
- 环境变量永久设置
- 其他自动配置方式

如果你的目标是尽快完成 Claude Code 基础接入，按本文步骤操作即可。

---

## 2. 使用前准备

在开始之前，请先确认以下几点：

- 你的电脑已经安装 Node.js，且版本不低于 18
- 你可以正常使用 `npm`
- 你已经拿到接入 Claude Code 所需的服务地址和认证信息
- 你准备通过 `settings.json` 文件统一管理配置

推荐使用 PowerShell 作为 Windows 下的命令行工具，这一点也与参考教程的建议一致。[参考链接](https://docs.88code.org/ClaudeCode/Windows.html)

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

Claude Code 建议使用 Node.js 18 及以上版本。为了减少兼容问题，更推荐使用较新的 LTS 版本。

---

## 4. 安装 Claude Code

在终端中执行以下命令安装 Claude Code：

```powershell
npm install -g @anthropic-ai/claude-code
```

安装完成后，执行下面的命令检查是否安装成功：

```powershell
claude --version
```

如果终端输出了版本号，说明 Claude Code 已安装完成。

---

## 5. 通过文件进行配置

本指南只使用文件配置方式。

Claude Code 的配置文件路径通常为：

### 5.1 Windows

```text
C:/Users/你的用户名/.claude/settings.json
```

### 5.2 macOS / Linux

```text
~/.claude/settings.json
```

如果 `settings.json` 文件还不存在，可以手动创建。

如果 `.claude` 目录还不存在，也可以先手动创建目录，再创建 `settings.json`。

---

## 6. 完整配置示例

下面是一份可直接参考的 `settings.json` 示例。

这份配置的定位很明确：**使用本配置后，可以在 Claude Code 中直接接入公司 Codex 提供的 `gpt-5.4` 系列模型进行使用。**

也可以理解为，Claude Code 仍然是你的本地使用入口，但实际模型能力来自公司内部提供的 Codex 模型服务网关。

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-codex",
    "ANTHROPIC_BASE_URL": "http://10.10.19.68:8317",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-5.4(low)[1m]",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-5.4(xhigh)[1m]",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-5.4(medium)[1m]",
    "ANTHROPIC_MODEL": "gpt-5.4(medium)[1m]",
    "ANTHROPIC_REASONING_MODEL": "gpt-5.4(high)[1m]",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_INSTALLATION_CHECKS": "1"
  },
  "permissions": {
    "allow": [],
    "deny": []
  }
}
```

你只需要把上面的内容写入 `settings.json` 文件即可。

完成配置后，Claude Code 会通过 `ANTHROPIC_BASE_URL` 指向公司提供的 Codex 服务地址，并按配置中指定的模型名称使用 `gpt-5.4` 不同能力档位。

如果后续认证信息、服务地址或模型档位变化，只需要修改这一个文件，不需要反复设置环境变量。

---

## 7. 配置项说明

下面对这份配置中的关键字段做一个入门级说明。

### 7.1 认证与接入地址

#### `ANTHROPIC_AUTH_TOKEN`

用于身份认证。

```json
"ANTHROPIC_AUTH_TOKEN": "sk-codex"
```

这个值相当于 Claude Code 请求服务时使用的访问凭证。实际使用中，你应当填写真实可用的认证 Token。

#### `ANTHROPIC_BASE_URL`

用于指定 Claude Code 请求的服务地址。

```json
"ANTHROPIC_BASE_URL": "http://10.10.19.68:8317"
```

这意味着 Claude Code 不直接走默认官方接入地址，而是走你当前网络环境中的指定服务端点。

### 7.2 默认模型配置

#### `ANTHROPIC_DEFAULT_HAIKU_MODEL`

用于指定默认轻量模型：

```json
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-5.4(low)[1m]"
```

#### `ANTHROPIC_DEFAULT_SONNET_MODEL`

用于指定默认中等能力模型：

```json
"ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-5.4(medium)[1m]"
```

#### `ANTHROPIC_DEFAULT_OPUS_MODEL`

用于指定默认高能力模型：

```json
"ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-5.4(xhigh)[1m]"
```

这三个配置可以理解为不同档位的默认模型映射。

### 7.3 当前主模型与推理模型

#### `ANTHROPIC_MODEL`

指定当前主模型：

```json
"ANTHROPIC_MODEL": "gpt-5.4(medium)[1m]"
```

通常可以理解为 Claude Code 日常主要使用的模型。

#### `ANTHROPIC_REASONING_MODEL`

指定推理能力更强的模型：

```json
"ANTHROPIC_REASONING_MODEL": "gpt-5.4(high)[1m]"
```

这个配置通常用于需要更强分析与推理能力的场景。

### 7.4 其他运行控制项

#### `CLAUDE_CODE_ATTRIBUTION_HEADER`

```json
"CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
```

这个配置通常用于控制 attribution header 行为。这里按照你的现有接入方案保留为 `0`。

#### `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`

```json
"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
```

这个配置表示关闭非必要流量，通常有助于减少额外网络请求。

#### `DISABLE_INSTALLATION_CHECKS`

```json
"DISABLE_INSTALLATION_CHECKS": "1"
```

这个配置表示禁用部分安装检查逻辑，适合你当前这种已知接入环境明确、希望减少干扰检查的使用方式。

### 7.5 `permissions` 字段

文档示例中保留了：

```json
"permissions": {
  "allow": [],
  "deny": []
}
```

这是为了让 `settings.json` 结构更完整，也方便你后续继续扩展权限控制策略。

如果当前没有额外权限规则需求，保持空数组即可。

---

## 8. 启动与验证

完成文件配置后，重新打开终端，再执行：

```powershell
claude
```

如果你希望在指定项目中使用 Claude Code，可以先进入项目目录：

```powershell
cd D:\your-project
claude
```

### 8.1 建议的验证顺序

建议按下面顺序检查：

1. `node --version`
2. `npm --version`
3. `claude --version`
4. 检查 `settings.json` 文件路径是否正确
5. 检查 JSON 格式是否正确
6. 启动 `claude`

### 8.2 配置生效的关键点

如果你已经修改了 `settings.json`，但终端里仍然表现异常，优先检查：

- 文件路径是否写对
- JSON 是否有逗号缺失或括号不匹配
- `ANTHROPIC_BASE_URL` 是否可访问
- `ANTHROPIC_AUTH_TOKEN` 是否有效
- 是否重启了终端

---

## 9. 常见问题

### 9.1 `claude --version` 可以执行，但 `claude` 启动后不可用

这种情况通常优先检查配置文件中的这几项：

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`
- JSON 格式是否正确

### 9.2 Windows 下找不到 `settings.json`

你可以手动创建：

```text
C:/Users/你的用户名/.claude/settings.json
```

如果 `.claude` 文件夹不存在，也请一起手动创建。

### 9.3 修改配置后没有生效怎么办

最常见的处理方式是：

- 保存 `settings.json`
- 关闭当前 PowerShell 或终端窗口
- 重新打开终端
- 再次执行 `claude`

### 9.4 JSON 配置容易写错怎么办

建议使用编辑器打开 `settings.json`，确保：

- 所有 key 都有双引号
- 每一项之间的逗号没有遗漏
- 最后一项后面不要多写逗号
- 大括号层级正确闭合

### 9.5 如何跳过首次登录提示

Claude Code 首次启动时，默认可能会要求你登录 Claude 官方账号。

常见现象通常有两种：

- 如果你挂了 VPN，可能会弹出官方登录流程
- 如果你没挂 VPN，可能会直接报错：`Failed to connect to api.anthropic.com`

如果你当前是通过自定义 `settings.json` 接入自己的服务地址，而不希望进入官方初始登录流程，可以通过在用户目录下创建一个额外配置文件来跳过。

请注意，这里创建的是：

```text
~/.claude.json
```

它是一个**文件**，不是 `.claude` 文件夹。

### Windows 路径示例

```text
C:/Users/你的用户名/.claude.json
```

### macOS / Linux 路径示例

```text
~/.claude.json
```

在这个文件中写入以下内容：

```json
{
  "hasCompletedOnboarding": true
}
```

这个配置会告诉 Claude Code：当前环境已经完成初始 onboarding，可以跳过首次登录提示。

如果你已经配置好了 `~/.claude/settings.json`，但启动时仍然卡在官方登录流程或连接官方地址报错，这个方式通常很有帮助。

### 9.6 是否还需要再配环境变量

按本文档的方式，不需要。

因为这里已经明确采用 **通过文件设置** 的方式，配置统一放在 `settings.json` 中即可，不再额外介绍环境变量配置。

---

## 10. 推荐做法

对于大多数新手，更推荐采用下面这种最简单的落地方式：

1. 安装 Node.js
2. 安装 Claude Code
3. 创建 `~/.claude/settings.json`
4. 将本文示例配置写入文件
5. 重启终端并执行 `claude`

这样做的优点是：

- 配置集中
- 易于维护
- 不容易忘记环境变量
- 后续迁移机器时也更方便

---
