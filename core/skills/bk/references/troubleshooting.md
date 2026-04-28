# 报错排查 / 字段差异 / 服务端怪象

主体 skill 的"高频场景必懂的约束"只列最易踩的 5 条。本文件是完整版。

## 目录

- [报错速查表](#errors)
- [工作项类型间的字段 / 状态差异](#variants)
- [服务端当前已知问题](#server-issues)
- [网络与延迟](#network)
- [CLI 退出码](#exit-codes)

---

<a name="errors"></a>
## 报错速查表

按报错文案定位问题，照对应方案修。

### `missing bk-mcp token`

**原因：** CLI 在 env `MCPR_TOKEN` 和 `~/.config/bk-mcp/token` 都读不到 token。
**修：** 让用户到 <https://mcp.300624.cn/api-keys> 生成，然后 `node cli/bk.mjs auth <token>`。不要编造。

### `HTTP 401: {"error":"认证失败"}`

**原因：** token 格式对但被服务端拒（过期 / 吊销 / 环境错误）。
**修：** 让用户重新生成 token；如果明确是环境问题，检查 `BK_MCP_URL` 有没有被错误覆盖。

### `项目[xxx]不存在或在CTeam中未初始化`

**原因：** `project_id` 传错了，大多数是把 Issue 前缀 `p328` 当 `project_id` 传；或者 `.claude/config/project-config.json` 的 `bkProjectId` 历史上就写错了。
**修：**
1. 拿到正确的 `v10125` 形式的值：
   - `get_issue --issue_number <任意已知 issue>` → `basic_info.project_id`
   - `get_todolist` → `items[].url`，URL 里 `/vteam/v10125/` 片段
   - 直接问用户
2. 持久化到 config，以后自动回填：
   ```bash
   node cli/bk.mjs project set v10125
   ```
   这会只改 `project.bkProjectId`，保留 config 里其它字段。

### `missing bk-mcp token` / CLI 回报 config 里没 bkProjectId

**原因：** 首次使用或换机器，token / project 上下文还没配。
**修：**
```bash
# 1) 引导用户到 https://mcp.300624.cn/api-keys 生成 token 后：
node cli/bk.mjs auth <token>

# 2) 设置当前仓库对应的项目：
node cli/bk.mjs project set v10125

# 3) 自检
node cli/bk.mjs doctor
```

### `非法优先级`

**原因：** `create_issue` 的 `priority` 传了中文。
**修：** 改成英文代码 `URGENT | HIGH | CENTRAL | LOW`。

> 规律：**建用英文代码，改用中文名**。`update_issue` / `transition_issue` 反而是中文（"高"/"处理中"）。

### `未找到目标状态「X」`

**原因：** `target_state` 不在当前 Issue 的合法状态集里（工作项类型不同，状态集不同）。
**修：** 先跑：
```bash
node cli/bk.mjs transition_issue --issue_number <n> --list_states true
```
从 `available_states[].name` 里挑。

### `以下必填字段缺少值: 「X」(fieldId=...)、「Y」(fieldId=...)...`

**原因：** 建/改"任务"类型工作项时漏了必填自定义字段。
**修：** **一次性补齐所有报错字段**到 `instance_value` / `instanceValue`。经办人可以 `assign_id` 代替。字段枚举值从 `update_issue --dry_run true --list_fields true`（同类型已有 Issue 上）拿。

### `project_id 或 project_name 参数至少提供一个`

**原因：** `list_issues` 必须限定项目范围。
**修：** 补 `--project_id v10125` 或 `--project_name "团队管理"`。

### `文件 #N: 文件名不能为空` / 其它 upload 错

**原因：** `upload_files` 的 file 对象 schema 不对。必须是 `{ name, content_base64, size }`，不接受 `path`。
**修：** 参考 `create-and-breakdown.md` 的"一行拼 JSON 上传"。

### `查询项目失败: 项目维表未加载，无法执行关键字搜索`

**原因：** `search_projects` 服务端状态问题，见下 [服务端当前已知问题](#server-issues)。

### `additionalProperties` 相关

**原因：** 传了 schema 里没有的字段，或者把 `instanceValue` 写成 `instance_value`（或反过来）。
**修：**
- `create_issue` → `instance_value`（snake_case）
- `create_blueking_task` → 每个 task 内 `instanceValue`（camelCase）

### fetch timeout / `ECONNREFUSED` / 长时间无返回

**原因：** 端点 `http://192.168.82.121:3088/bk/mcp` 是**内网地址**，VPN / 办公网外不通。
**修：** 先 `curl -I $BK_MCP_URL` 确认可达；不可达时明确告诉用户"需要连到公司内网 / VPN 才能用 bk-mcp"，不要盲目重试。

---

<a name="variants"></a>
## 工作项类型间的字段 / 状态差异

蓝鲸不同工作项类型的字段集 / 状态集不互通，这是 bk-mcp 错误的主要来源之一。

### 已验证的状态集

| type_classify | 合法 `target_state` |
|---|---|
| `BUG`（缺陷） | 待处理 / 处理中 / 待验证 / 已验证 / 延后处理 / 不做处理 / 拒绝 / 重新打开 |
| `TASK`（任务） | 待处理 / 处理中 / 已暂停 / 已取消 |

需求类型未验证，原则上也先 `--list_states true` 再传。

### 字段集差异

- BUG 有 93+ 字段，包括"严重程度 / 缺陷分类 / 发现的版本 / 研发预估工时 / 测试预估工时"等
- TASK 字段集不同，必填 5 项（版本 / 经办人 / 预估工时(h) / 预计开始时间 / 预计结束时间）

**拿某类型的字段定义**：用同类型已存在的 Issue 跑：
```bash
node cli/bk.mjs update_issue --issue_number <same-type-issue> \
  --dry_run true --list_fields true
```
**不要**拿 BUG 的 list_fields 结果去填 TASK 的 instance_value，fieldId 根本不重合。

---

<a name="server-issues"></a>
## 服务端当前已知问题

### `search_projects` 经常 `项目维表未加载`

**现象：**
```bash
node cli/bk.mjs search_projects --keyword xxx
# => { content:[{type:"text", text:"查询项目失败: 项目维表未加载，无法执行关键字搜索"}], isError:true }
```

**验证过 CLI 和 MCP 行为一致**，确认是服务端状态，不是 CLI 问题。

**绕行方案：**
- 直接问用户 `project_id`
- 从 `get_todolist` 的 `items[].url` 抽 `/vteam/v10125/` 片段
- 用 `get_issue --issue_number <已知>` 读 `basic_info.project_id`

### 连接不复用

CLI 每次 `tools/call` 都会先 `initialize` 建 MCP 会话，单次延迟 ~200–500ms。批量调用（比如建 20 个子任务）要注意节奏，必要时手动 `sleep`。

---

<a name="network"></a>
## 网络与延迟

- 端点 `http://192.168.82.121:3088/bk/mcp` 是**内网地址**
- VPN / 办公网外**完全不通**，fetch 会挂到默认超时
- 跨网络执行前先 `curl -I "$BK_MCP_URL"` 快速验证；失败时明确告知用户而不是让命令默默卡住

---

<a name="exit-codes"></a>
## CLI 退出码

| code | 含义 | 示例 |
|---|---|---|
| 0 | 成功 | 工具正常返回 |
| 1 | 本地错 | 缺 token / 参数错 / 未知 tool / 网络不通 / JSON 解析失败 |
| 2 | 服务端业务错 | tool 返回 `isError: true`（必填字段缺失、状态非法、权限不够等） |

调用方先看 exit code 再解析 stdout，不要把 1 和 2 混同——1 通常要人工介入，2 经常可以自动修并重试（按报错补参数）。
