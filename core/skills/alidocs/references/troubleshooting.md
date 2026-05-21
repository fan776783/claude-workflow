# 报错排查 / 常见坑 / 破坏性工具上报

## 目录

- [按退出码分档](#by-exit)
- [按报错文案速查](#by-msg)
- [凭证相关](#creds)
- [字段 / 参数约束](#params)
- [Tool 漂移检测（diff-tools）](#drift)
- [遇到疑似破坏性工具未被 CLI 拦截](#report-destructive)

---

<a name="by-exit"></a>
## 按退出码分档

三个 wrapper skill（`bk` / `alidocs` / `figma-data`）共享同一套退出码（ADR-0001）：

| exit | 含义 | 第一步看哪 |
| --- | --- | --- |
| 0 | 成功；doctor / list-tools / schema 也都是 0 | stdout JSON |
| 1 | 通用错：网络 / DNS / JSON 解析 / 参数错 / `diff-tools` 检出 drift 未 `--promote` | stderr 文案 |
| 2 | 凭证缺失 / `auth --verify` 失败 / 401 / 403；归一化 `{kind:"auth"}` | 跑 `doctor`；看 `servers.<kind>.connectivity.error` |
| 3 | 危险工具无 `--yes` | stderr 的 blocked JSON；与用户确认再加 `--yes` |
| 4 | MCP `body.error` 或 `result.isError=true` | stderr 的 JSON；通常是 MCP 协议层错（不是业务错） |
| 5 | tool_not_found；归一化 `{kind:"tool_not_found"}` | 走 [diff-tools 段](#drift) |
| 6 | enum_invalid；归一化 `{kind:"enum_invalid"}` | schema cache 重 refresh + 同步 SKILL.md snapshot |

`5` / `6` 由 `_shared/mcp-baseline.mjs` 归一化，stderr 输出 `{kind, hint, originalMessage}` 结构化对象。

> **注意**：钉钉 MCP 把**业务错**（如 baseId 不存在）归类为 `result.isError=false` + `structuredContent.status="error"`，**不会触发 exit 4**。exit 0 但 JSON 里有 `"status":"error"` / `"success":false` 也要当作失败处理。

---

<a name="by-msg"></a>
## 按报错文案速查

### `missing <doc|aitable|sheet> server URL`

**原因**：env 和 `~/.config/dingtalk-mcp/servers.json` 都没对应 kind 的 URL。
**修**：引导用户发 URL，agent 执行 `... auth <kind> --stdin --verify <<< "<url>"`。**不要**编造 URL。三个 kind 相互独立，只缺哪个配哪个。

### `refusing to save <kind> URL: host <x> not in allowlist`

**原因**：URL host 不在默认 `mcp-gw.dingtalk.com`。
**修**：确认 URL 无误；内部代理 / 镜像 host 可通过 `DINGTALK_HOST_ALLOWLIST=internal-host` 扩展。

### `refusing to save <kind> URL: URL missing ?key=...`

**原因**：URL 没带 key query。
**修**：让用户补完整 URL；钉钉 MCP 的 URL 结构固定是 `https://mcp-gw.dingtalk.com/server/<hash>?key=<key>`。

### `verify failed: HTTP 401` / `HTTP 403`

**原因**：URL 里的 key 失效 / 被吊销 / 跨环境。
**修**：让用户到钉钉管理台重新生成 server URL；**不要**直接保存未 verify 过的 URL。

### `empty MCP response (ct=...)` / `HTTP 5xx`

**原因**：MCP 网关临时不可用；或 URL 完整但路径的 hash 写错了（MCP gateway 可能返 5xx 而非 404）。
**修**：重试一次；仍失败 → 让用户核对 URL 的 `/server/<hash>` 片段是否正确。

### `tool not found: <kind>.<name>`（exit 5）

**原因**：schema 缓存里没有这个工具名。
**修**：CLI 会自动 `--refresh` 一次兜底；仍找不到说明：
- 用户拼错 → 让用户核对，`list-tools <kind>` 看全量列表
- **上游 MCP 改名 / 下线** → stderr 会有 `{"kind":"tool_not_found",...}`；按 [diff-tools 段](#drift) 走漂移处理 workflow

### `enum value rejected` / 服务端枚举返回 invalid（exit 6）

**原因**：传给 tool 的 enum 值不在服务端当前合法集里。常见于字段类型 / 视图类型 / 权限角色等枚举。
**修**：
1. `node cli/dingtalk-mcp.mjs schema <kind>.<tool> --refresh` 重拉 schema cache
2. 如果 enum 集真的变了 → 同步更新 SKILL.md 末尾 `<!-- snapshot YYYY-MM-DD -->` 注释为今天日期
3. 如用户给的输入用了旧值 → 告知"服务端枚举已变"，让用户挑当前合法值

### `blocked` / exit 3

**原因**：调了危险工具没加 `--yes`。
**修**：按 skill 软门协议先向用户展示影响范围 → 用户确认 → 加 `--yes` 重试。

### exit 0 但 JSON 里 `"status":"error"` / `"success":false`

**原因**：服务端业务错，常见子类：
- `Data not found`：ID 错或已被删
- `invalidRequest.inputArgs.invalid`：参数格式问题（如 nodeId 不是 32 位）
- `permission denied`：用户对目标节点无权限

**修**：看 `errorMessage` / `errorMsg` / `error.message` 字段；参数问题先 `schema <tool>` 对照 required / properties。

---

<a name="creds"></a>
## 凭证相关

### URL 里的 key 泄露了怎么办

1. 让用户立刻到钉钉管理台吊销对应的 server URL
2. 清本地配置：
   ```bash
   rm ~/.config/dingtalk-mcp/servers.json
   rm -rf ~/.cache/dingtalk-mcp/
   ```
3. 让用户生成新 URL，通过 `--stdin` 重新导入（不要用 argv！）

### 切账号 / 临时覆盖

```bash
# 单次覆盖
DINGTALK_DOC_URL="https://mcp-gw.dingtalk.com/server/<other>?key=<other>" \
  node cli/dingtalk-mcp.mjs doc list_nodes --nodeId xxx
```

### 怀疑 URL 被记录到 history

- zsh: `history -c` 清当前 session；持久化的 `~/.zsh_history` 手工删对应行
- bash: `history -c && history -w`
- 最好下次用 `--stdin`

---

<a name="params"></a>
## 字段 / 参数约束

### 搞混了 `aitable` 和 `sheet`？

| 症状 | 典型 | 诊断 |
| --- | --- | --- |
| `aitable list_bases` 返回空 / 报 `Data not found` 用了 sheet 的 URL | 服务端不认 `baseId` | 检查 doctor 输出，确认 `aitable` kind 的 path hash 是否对 |
| 调 `sheet get_range` 却传了 `baseId` | 报 `rangeAddress 不合法` 或 `nodeId 格式不合法` | `sheet` 用 `nodeId` / `sheetId` / A1 表示法，不用 `baseId` |
| 调 `aitable query_records` 传了 A1 地址 | required 报错 | `aitable` 用 `baseId` + `tableId` + filter |

两者是**不同产品**，不可互通的参数和语义。拿不准 → 问用户："这是 Base 风格（AI 表格）还是 xlsx 风格（钉钉表格）？"

### `nodeId` / `dentryUuid` 格式

32 位字母数字。如果报 `nodeId 格式不合法`，检查：
- 是不是把文件 ID（`fileId=...`）当成 nodeId 传了（前者是 drive 层，不是 docs 层）
- 是不是带了多余的空格 / 换行
- 完整文档 URL 也接受，形如 `https://alidocs.dingtalk.com/i/nodes/{dentryUuid}`

### `markdown` 字面量换行问题

服务端明确警告：`markdown` 参数的换行必须是**真换行符**（U+000A），不能是两字符字面量 `\n`，否则所有内容会挤在同一行。

- 通过 `--json` 传时：用 shell heredoc 或先把 markdown 写到文件读进来
- 通过 `--markdown "text"` 传时：shell 已经帮你转好

### `filters.link` 必须统一

`filterUp` 字段的 `filters` 数组里，每个 filter 的 `link` 必须全部 AND 或全部 OR，不能混用。

### `create_table` 初始字段 ≤ 15

超过走 `create_fields` 追加。重名会自动续号。

---

<a name="drift"></a>
## Tool 漂移检测（diff-tools）

`alidocs` 通过双层 baseline 应对上游钉钉 MCP 漂移（ADR-0001）：checkin 权威 baseline 在 `core/skills/alidocs/baseline-schema.json`（随 repo 提交，覆盖 `doc` / `sheet` / `aitable` 三 kind），本地 schema cache 在 `~/.cache/dingtalk-mcp/`。

### 主动巡检

```bash
node cli/dingtalk-mcp.mjs diff-tools                  # 比对当前三 kind 工具表与 checkin baseline
node cli/dingtalk-mcp.mjs diff-tools --promote        # 已确认 drift 是预期的 → 写入新 baseline
node cli/dingtalk-mcp.mjs diff-tools --promote-initial   # 仅首次建立 baseline 用
```

输出按 kind 分组：`drift.doc.added` / `drift.doc.removed` / `drift.doc.changed`，`sheet` / `aitable` 同。`has_drift=true` 且未 `--promote` 时 CLI 退 1。

### drift 报警处理顺序

1. **先看 `removed`**：上游下线 tool → 全文搜旧 name → 替换为新等价 tool（或标记 deprecated）→ promote
2. **再看 `changed`**：required / 静态 enum 变了 → 同步更新 SKILL.md `<!-- snapshot YYYY-MM-DD -->` 注释 + references 字段约束表 → promote
3. **最后看 `added`**：上游新增 tool → 评估是否要在 SKILL.md 暴露 → promote

**先 sync SKILL.md / references 再 promote**，反过来会让 baseline 早于文档对齐，下次 spec-review 会标 stale。

### `spec-review` 第 7 类周巡

`spec-review` 扫 SKILL.md 中 `<!-- snapshot YYYY-MM-DD -->`，>90d 标 warning / >180d 升 advisory，提醒手动跑一次 `diff-tools` + `schema <kind>.<tool> --refresh` 拉最新动态枚举。

---

<a name="report-destructive"></a>
## 遇到疑似破坏性工具未被 CLI 拦截

CLI 的危险门有两层：**显式清单**（13 项）+ **前缀模式兜底**（`delete_` / `remove_` / `clear_` / `drop_` / `truncate_`）。如果你发现一个工具：

- 文档 / 名字看起来会破坏数据
- 或会**改变公开可见性**（share / public / publish 类）
- 或会**全量覆盖**内容（`update_*` + overwrite 语义）

但**不在清单、也不命中前缀**，这是一个 bug。处理 workflow：

1. **立刻暂停**该工具的调用（不管加不加 `--yes`）
2. 跟用户说明：skill 的硬门漏了一个危险工具，暂不执行，等 skill 更新
3. 报告给 skill 维护者（本仓库 `@justinfan/agent-workflow`）：
   - 工具名 + kind（doc / sheet）
   - `dingtalk-mcp schema <kind>.<tool>` 的 danger 字段输出（会显示 null）
   - 一句话为什么你觉得危险

维护者会把工具加进 `DANGEROUS_TOOLS` 或调整 `DANGEROUS_PREFIXES`。

> 例子：未来钉钉 MCP 可能新增 `publish_chart`（公开发布到外部），如果没加进清单，前缀模式 `delete_` 等也命中不了。这时就按上面 workflow 报。
