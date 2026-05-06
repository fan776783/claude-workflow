---
name: dingtalk-mcp
description: 通过本地 CLI 调用三个钉钉 MCP 服务 —— 钉钉文档（doc）/ 钉钉 AI 表格（aitable, Airtable-like）/ 钉钉表格（sheet, Excel-like）。适用于已经有 mcp-gw.dingtalk.com MCP server URL（URL 里带 ?key=）、但不想让 MCP 常驻占用大量上下文的场景。触发词：「钉钉文档」「钉钉 AI 表格」「钉钉多维表」「钉钉表格」「钉钉在线表格」「钉钉电子表格」「A1 单元格」「dingtalk-mcp」「MCP URL」「mcp-gw」「按需调钉钉文档/表格」「减少常驻 MCP 上下文」。**注意**：如果用户明确提到 `dws` / `dws CLI` / 钉钉 workspace CLI，走那边而非本 skill。首次使用必须引导用户提供需要的 server URL（可只配其中一个或多个）。
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:纯 CLI 转发(auth / list-tools / 只读工具调用)可走"纯研究"跳过条件;一旦要写用户可见的文档正文 / Base 数据, 必须读 glossary 保证 canonical 术语。
</PRE-FLIGHT>

# dingtalk-mcp — 钉钉文档 + AI 表格 + 钉钉表格 CLI

封装三个钉钉 MCP（文档 ~21 / AI 表格 ~43 / 钉钉表格 ~30）为 Node 单文件 CLI，让 agent 按需调用而不是让 MCP schema 常驻上下文。

## 三种 kind

| kind | 中文 | 对标 | 核心概念 |
| --- | --- | --- | --- |
| `doc` | 钉钉文档 | Google Docs / Notion | nodeId / block / folder |
| `aitable` | 钉钉 AI 表格 | Airtable / 飞书多维表 | baseId / tableId / record / field / view |
| `sheet` | 钉钉表格 | Excel / Google Sheets | nodeId / sheetId / rangeAddress (A1) |

`aitable` 和 `sheet` **不是同一个产品**：
- AI 表格是结构化数据库（记录 + 字段类型），用 baseId / tableId / 字段配置
- 钉钉表格是电子表格（A1 单元格 + 公式 + 合并 + 筛选），用 rangeAddress

## 本文件覆盖什么

**主体 = 80% 高频场景**：配置 server URL / 搜文档 / 读写块 / 列 Base / 查改记录 / 读写 A1 区域 / 危险操作确认。

低频或进阶按需读：
- 文档工具分类速查 → `references/doc.md`
- AI 表格工具分组 → `references/aitable.md`
- 钉钉表格工具分组 → `references/sheet.md`
- AI 表格字段类型 `config` 规则（建字段时必读）→ `references/field-rules.md`
- 报错排查 / 破坏性工具未拦截上报指引 → `references/troubleshooting.md`

## 何时用本 skill，何时不用

| 场景 | 走哪里 |
| --- | --- |
| 用户给了 `https://mcp-gw.dingtalk.com/server/<hash>?key=<key>` 这种 URL | 本 skill |
| 用户说"太慢 / MCP 工具太多占上下文 / 减少常驻 MCP" | 本 skill |
| 用户提到 `dws` / `dws CLI` / 钉钉 workspace CLI / 自己用开放平台 Token | `dws` skill（如已安装）；本 skill 不接管 |
| 用户模糊说"操作钉钉文档"，既没 URL 也没提 dws | **先问**："你想用 MCP URL 直连，还是用 dws CLI？如果你有对应 MCP server URL，我可以走 dingtalk-mcp skill" |
| 用户要操作 钉钉群 / 日程 / 通讯录 / 待办 / 审批 / 日志 / 考勤 / 听记 / 邮箱 | 只有 dws 覆盖，本 skill 无能为力 |

### AI 表格 vs 钉钉表格 的消歧

用户说"表格"时先区分：

| 用户说 | 走哪 |
| --- | --- |
| "多维表" / "Base" / "记录 / 字段 / 视图" / "图表 / 仪表盘" / "数据库风格的表" | `aitable` |
| "xlsx" / "在线表格" / "电子表格" / "A1 / B2 单元格" / "合并单元格" / "公式" / "筛选 / 排序" / "行高列宽" | `sheet` |
| 只说"表格"，两者都可能 | **先问用户**："是钉钉 AI 表格（多维表数据库）还是钉钉在线表格（Excel 风格）？" |

## 运行入口

CLI 路径（相对本 skill）：`cli/dingtalk-mcp.mjs`，Node ≥ 18，无需安装依赖。

调用形式：
```bash
node <skill-root>/dingtalk-mcp/cli/dingtalk-mcp.mjs <subcommand> [args...]
```

当前会话用全路径；用户可自行 `alias dtmcp=...`，skill 本身不依赖 alias。

## 初始化：由 agent 代替用户执行

> **核心原则**：遇到配置缺失，agent 必须接管 —— 用对话问用户拿到 URL，再**自己通过 Bash 工具调 CLI 落盘**，不要让用户在终端手敲命令。URL 里 `?key=...` 是账号级凭证，等同密码。
>
> **凭证泄露面（重要）**：`echo "<URL>" | dingtalk-mcp.mjs auth --stdin` 虽避免 URL 进入 dingtalk-mcp 的 argv，但**仍会把 URL 拼进 shell 命令字符串**，从而落在 agent tool 日志、终端 scrollback、shell history 里。真正安全的做法是：agent 把 URL 通过工具调用的 stdin 参数（而非 bash 命令行字符串拼接）喂给 CLI；或人类用户用 `read -rsp` 等隐藏输入方式。下面"场景 A"的示例用 `echo` 只是便于说明，实际 agent 执行时应优先用工具层 stdin 投递。

### 触发条件

任何一条满足就进入对应workflow：

- 任何 tool 调用返回 `missing <doc|aitable|sheet> server URL` → 跳到 [场景 A](#场景-a-url-缺失)
- 首次使用本 skill / 用户问"我有没有配好" → 跑 `doctor` + `smoke-test.sh`，按报告对号入座

### 场景 A：URL 缺失

**三个 kind 互相独立**：用户只想用其中一个，就只配一个；用到哪个才缺就补哪个，不要强行一次性收齐 3 个。

agent 打出的话（模板，按用户当前任务需要的 kind 裁剪）：

> 需要先配置钉钉 <kind> MCP 的 server URL（形如 `https://mcp-gw.dingtalk.com/server/<hash>?key=<key>`）。获取地址：https://aihub.dingtalk.com/#/mcp ，找到对应的 <kind> server 复制 URL 发给我，我来通过 `--stdin` 保存 + 连通性验证 —— **不需要你在终端敲命令**。URL 里的 `?key=` 是账号级凭证。

拿到 URL 后，agent 执行：

```bash
# 替换 <kind> 为 doc / aitable / sheet 之一
node /绝对路径/cli/dingtalk-mcp.mjs auth <kind> --stdin --verify <<< "<URL>"
```

- 安全提醒：`<<<` 避免 URL 进入 dingtalk-mcp 的 argv，但命令字符串本身仍出现在 agent tool 日志 / 终端 scrollback。如果 agent 平台支持"通过工具 stdin 传输内容不经过 bash 命令字符串"，优先用那条路径。
- 人类用户的安全 fallback：`read -rsp 'URL: ' U && printf '%s\n' "$U" | node /绝对路径/cli/dingtalk-mcp.mjs auth <kind> --stdin --verify; unset U`
- 成功回显：`{"ok":true,"kind":"doc","host":"mcp-gw.dingtalk.com","key_preview":"xxxx...yyyy","verified":true}`，agent 回用户："<kind> MCP 已保存，key 指纹 `xxxx...yyyy`，返回 N 个工具。"
- 失败（exit 2）→ 不落盘，让用户核对 URL。

**接下来如果用户需要的 kind 还没配就继续收**；都齐了后：

```bash
node /绝对路径/cli/dingtalk-mcp.mjs doctor       # 查三个 kind 状态
bash /绝对路径/cli/smoke-test.sh                # 只读检查点，含安全断言
```

smoke 全绿就可以交付。

### 场景 B：首次全量自检（三个 kind 都要）

```bash
node /绝对路径/cli/dingtalk-mcp.mjs auth doc     --stdin --verify <<< "<DOC_URL>"
node /绝对路径/cli/dingtalk-mcp.mjs auth aitable --stdin --verify <<< "<AITABLE_URL>"
node /绝对路径/cli/dingtalk-mcp.mjs auth sheet   --stdin --verify <<< "<SHEET_URL>"
bash /绝对路径/cli/smoke-test.sh
```

---

## 配置解析：URL / 端点 / 缓存（参考）

CLI 读两类上下文，优先级"环境变量 → 文件"。随时用 `doctor` 查实际生效值（默认脱敏，`--unsafe-full` 才显示完整 URL）。

### 凭据层

| Kind | 顺序 | 来源 |
| --- | --- | --- |
| doc | 1 | `env DINGTALK_DOC_URL` |
| doc | 2 | `~/.config/dingtalk-mcp/servers.json` → `.doc`（chmod 600） |
| aitable | 1 | `env DINGTALK_AITABLE_URL` |
| aitable | 2 | `~/.config/dingtalk-mcp/servers.json` → `.aitable` |
| sheet | 1 | `env DINGTALK_SHEET_URL` |
| sheet | 2 | `~/.config/dingtalk-mcp/servers.json` → `.sheet` |

**Host 准入**：保存前校验 URL host ∈ `mcp-gw.dingtalk.com`（默认）；如需扩展，`env DINGTALK_HOST_ALLOWLIST=host-a,host-b`。

**Schema 缓存**：`~/.cache/dingtalk-mcp/tools-{doc,aitable,sheet}.json`，TTL 24h，server fingerprint（host + path hash 末 8 位）变化时自动失效；手动刷新 `list-tools --refresh` / `schema <tool> --refresh`。

### 快速自检

```bash
node cli/dingtalk-mcp.mjs doctor     # URL 状态 / key 指纹 / 连通性
bash cli/smoke-test.sh               # 19 个只读检查点
```

## 通用调用语法

```bash
# 风格 A：--json，整坨 JSON（嵌套块结构 / 字段 config 首选）
node cli/dingtalk-mcp.mjs doc insert_document_block --json '{
  "nodeId": "pYLaez...",
  "block": {"blockType": "paragraph", "paragraph": {"text": "hello"}}
}'

# 风格 B：--key value / --key=value，简单参数
node cli/dingtalk-mcp.mjs aitable query_records --baseId X --tableId Y --limit 10
node cli/dingtalk-mcp.mjs sheet   get_range     --nodeId N --sheetId S --rangeAddress "A1:D10"

# 危险操作必须加 --yes（见下一节）
node cli/dingtalk-mcp.mjs aitable delete_base --baseId X --reason "cleanup" --yes
node cli/dingtalk-mcp.mjs sheet   replace_all --nodeId N --sheetId S --find x --replacement y --yes
```

CLI 自动识别数字/布尔/JSON 字面量。参数名一律 **camelCase**（跟 MCP inputSchema 一致）。

## 命令发现（参数以 schema 为准）

参考文档（`references/{doc,aitable,sheet}.md`）是**便于理解用途**，不是权威契约。真参数以下面命令的输出为准：

```bash
# 机读：JSON Schema + required + danger 标记
node cli/dingtalk-mcp.mjs schema doc.create_document
node cli/dingtalk-mcp.mjs schema aitable.create_fields
node cli/dingtalk-mcp.mjs schema sheet.update_range
node cli/dingtalk-mcp.mjs schema doc.create_document --refresh   # 绕过 24h 缓存

# 全清单
node cli/dingtalk-mcp.mjs list-tools                    # 三个 server 一起出
node cli/dingtalk-mcp.mjs list-tools doc                # 只看文档
node cli/dingtalk-mcp.mjs list-tools aitable --refresh
node cli/dingtalk-mcp.mjs list-tools sheet
```

参考文档和 schema 冲突时：**以 schema 为准**，文档视为过期，顺便 `/spec-update` 推一下。

## 危险操作确认（两层拦截）

### CLI 硬门（无 `--yes` 一律 exit 3）

| kind | 工具 | 类型 | 说明 |
| --- | --- | --- | --- |
| doc | `delete_document_block` | destroy | 删文档块，不可逆 |
| doc | `delete_document` | destroy | 删节点（文档/文件夹），不可逆 |
| doc | `update_document` | overwrite | **全量覆盖**文档正文，等同删 + 建 |
| aitable | `delete_base` | destroy | 删整张 AI 表格（含所有数据表） |
| aitable | `delete_table` | destroy | 删数据表 |
| aitable | `delete_field` | destroy | 删字段（该列所有值同步清空） |
| aitable | `delete_view` | destroy | 删视图 |
| aitable | `delete_records` | destroy | 删记录（支持批量） |
| aitable | `delete_chart` / `delete_dashboard` | destroy | 删图表/仪表盘 |
| aitable | `update_field` | schema-change | 改字段类型可能丢数据 |
| aitable | `update_dashboard_share` / `update_chart_share` | visibility | 公开分享→间接数据泄露 |
| sheet | `delete_dimension` | destroy | 删行 / 列（数据同步消失） |
| sheet | `delete_filter` / `delete_filter_view` | destroy | 删筛选 / 筛选视图 |
| sheet | `update_range` | overwrite | 覆盖区域内单元格（NOT append） |
| sheet | `replace_all` | overwrite | 全局查找替换，影响面可能巨大 |
| sheet | `move_dimension` | overwrite | 移动行列，可能破坏公式引用 |
| sheet | `write_image` | overwrite | 单元格写图，覆盖原内容 |
| sheet | `update_dimension` | schema-change | 批量改行列可见性 / 尺寸 |
| sheet | `unmerge_range` | structure-change | 取消合并，破坏下游引用 |

**模式兜底**：工具名以 `delete_` / `remove_` / `clear_` / `drop_` / `truncate_` 开头，即使未来新增也自动入硬门。

### Skill 软门（agent 协议）

调危险工具前，agent 必须按以下步骤走：

```
Step 1 → 用 schema 或 list-tools 查目标 ID 的一句话描述（baseName / tableName / sheetName / nodeName / rangeAddress）
Step 2 → 向用户展示：{工具} + {目标 ID + 名称} + {影响范围（XX 条记录 / 整张表 / A1:Z999 / ...）}
Step 3 → 等用户明确回复"确认" / "ok" / "go"
Step 4 → 加 --yes 执行
```

**未列入清单但需要人工确认的高影响操作**（不硬拦但 skill 层一定要问）：
- `aitable:delete_records` / `update_records` 批量规模 > 10 条时强调"要操作 N 条"
- `aitable:import_data` 成批导入前确认目标 table 可容纳
- `sheet:append_rows` 行数很多（比如用户给了 csv 几千行）时提示规模
- `sheet:create_filter` 会覆盖已存在的 sheet-level filter（sheet 级筛选只有一个）

## 常见 Recipe

### R1：在指定文件夹建文档并写入 markdown

```bash
# 1. 拿目标文件夹 nodeId（如果用户给了知识库链接，extract dentryUuid）
node cli/dingtalk-mcp.mjs doc list_nodes --nodeId "<folder-dentry-uuid>"

# 2. 建文档（markdown 里的换行必须是真换行符，不是字面量 \n）
node cli/dingtalk-mcp.mjs doc create_document --json '{
  "name": "周会纪要 2026-04-30",
  "folderId": "<folder-dentry-uuid>",
  "markdown": "# 周会纪要\n\n## 待办\n- [ ] 修复 X\n"
}'
```

### R2：读取文档块 → 插入新块 → 校对

```bash
# 读一级块
node cli/dingtalk-mcp.mjs doc list_document_blocks --nodeId "<doc-dentry-uuid>"

# 在最后插入一个段落块
node cli/dingtalk-mcp.mjs doc insert_document_block --json '{
  "nodeId": "<doc-dentry-uuid>",
  "block": {"blockType":"paragraph","paragraph":{"text":"补充 note"}},
  "position": "tail"
}'
```

### R3：从 CSV 批量导入 AI 表格（aitable）

```bash
# 1. 找 base / table
node cli/dingtalk-mcp.mjs aitable search_bases --keyword "需求池"
node cli/dingtalk-mcp.mjs aitable get_tables --baseId "<baseId>"

# 2. 获取导入上传凭证
node cli/dingtalk-mcp.mjs aitable prepare_import_upload --json '{
  "baseId":"<baseId>","tableId":"<tableId>","fileName":"data.csv"
}'

# 3. 用户用返回的 URL + token 流式上传（CLI 不负责二进制上传，交给 curl）
# 4. 上传完成后触发导入
node cli/dingtalk-mcp.mjs aitable import_data --json '{
  "baseId":"<baseId>","tableId":"<tableId>","uploadToken":"<token-from-step-2>"
}'
```

### R4：AI 表格建字段需要先查字段类型规则

`config` 结构每种字段类型不同（如 `singleSelect.options` / `currency.currencyType` / `formula.expression`），调用前读 `references/field-rules.md`，或：

```bash
node cli/dingtalk-mcp.mjs schema aitable.create_fields \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["properties"]["fields"]["items"]["properties"]["type"]["description"])'
```

### R5：读钉钉表格区域 → 追加行 → 覆盖某个单元格

```bash
# 1. 拿工作簿 nodeId 后查所有工作表
node cli/dingtalk-mcp.mjs sheet get_all_sheets --nodeId "<workbook-node-id>"

# 2. 读 A1:D10
node cli/dingtalk-mcp.mjs sheet get_range --json '{
  "nodeId":"<workbook-node-id>","sheetId":"<sheet-id>","rangeAddress":"A1:D10"
}'

# 3. 末尾追加两行（安全，append_rows 不拦）
node cli/dingtalk-mcp.mjs sheet append_rows --json '{
  "nodeId":"<workbook-node-id>","sheetId":"<sheet-id>",
  "values":[["新需求 1","张三","2026-05-01"],["新需求 2","李四","2026-05-10"]]
}'

# 4. 覆盖单元格（危险，必须先跟用户确认再加 --yes）
node cli/dingtalk-mcp.mjs sheet update_range --json '{
  "nodeId":"<workbook-node-id>","sheetId":"<sheet-id>","rangeAddress":"B2",
  "values":[["已完成"]]
}' --yes
```

### R6：钉钉表格按条件筛选（filter view，不污染原表）

```bash
# 建一个命名筛选视图（不影响工作表本身的 filter）
node cli/dingtalk-mcp.mjs sheet create_filter_view --json '{
  "nodeId":"<node>","sheetId":"<sid>","name":"仅看未完成"
}'

# 用返回的 filterViewId 设某列条件（用 >= / = / contains 等 criteria）
node cli/dingtalk-mcp.mjs sheet set_filter_view_criteria --json '{
  "nodeId":"<node>","sheetId":"<sid>","filterViewId":"<fvid>",
  "column":0,"filterCriteria":{"condition":"NOT_EQUAL","values":["完成"]}
}'
```

## 输出convention（给调用方读）

- 成功：`structuredContent` 或 `content[].text` 直出 stdout，已是 JSON / 字符串
- `body.error` 或 `result.isError=true`：JSON 写 stderr（脱敏后），**exit 4**
- 危险工具无 `--yes`：blocked JSON 写 stderr，**exit 3**
- 凭证缺失 / verify 失败 / 401 / 403：简短文案写 stderr，**exit 2**
- 其它（网络 / JSON 解析 / 参数错）：**exit 1**
- `doctor` 总是 **exit 0**（无论配置状态），调用方读 JSON 判断

调用方只读 stdout，不要再包 `content:[{type:"text",text:...}]`。

## 错误处理

1. 遇到报错，先看 exit code 分档
2. `doctor` 快速定位是 URL / host / 连通性哪一段
3. 仍然不明 → `references/troubleshooting.md`
4. 疑似破坏性工具未被硬门拦截 → troubleshooting.md 里有上报指引，按流程提 issue

## 工具清单（仅备查，实时数量以 `list-tools` 为准）

- 文档 MCP（doc）：~24，按 "创建 / 读取 / 编辑 / 组织 / 附件" 分类 → `references/doc.md`
- AI 表格 MCP（aitable）：~43，按 "Base / Table / Field / Record / View / Chart / Dashboard / Import-Export / Attachment" 分组 → `references/aitable.md`
- 钉钉表格 MCP（sheet）：~30，按 "工作簿 / 工作表 / 区域 / 查找替换 / 筛选 / 筛选视图 / 行列 / 合并图片" 分组 → `references/sheet.md`
- 实时 schema：`list-tools --refresh` / `schema <kind>.<tool>`

## 详细参考

- [references/doc.md](./references/doc.md) — 钉钉文档工具速查
- [references/aitable.md](./references/aitable.md) — 钉钉 AI 表格工具速查
- [references/sheet.md](./references/sheet.md) — 钉钉表格（Excel-like）工具速查
- [references/field-rules.md](./references/field-rules.md) — AI 表格字段类型 config 规则（建字段/改字段必读）
- [references/troubleshooting.md](./references/troubleshooting.md) — 错误码 + 常见坑 + 破坏性工具上报流程
