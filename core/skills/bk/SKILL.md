---
name: bk
description: 通过本地 CLI 调用 bk-mcp，操作蓝鲸（CTeam / vTeam）项目管理平台——查/建/改工作项、流转状态、拉个人待办、AI 拆任务、上传附件。触发词：「蓝鲸」「bk」「待办」「缺陷流转」「需求流转」「工作项」「Issue」「创建任务」「拆分任务」「给 Issue 评论」「看我今天有什么要做的」。首次使用必须引导用户到 https://mcp.300624.cn/api-keys 申请 token。
---

<CONTEXT>
写 issue 摘要/评论/agent brief 时 Read `core/specs/shared/glossary.md`。纯 CLI 转发（auth/project set/列待办）可跳过。
</CONTEXT>

# bk — 蓝鲸项目管理 CLI

封装 bk-mcp（MCP Streamable HTTP）为一个 Node 单文件 CLI。

## 本文件覆盖什么

**主体 = 开发者日常 80% 高频场景**：看待办 / 查 Issue / 改字段 / 流转状态 / 写评论。

低频或进阶用法按需读：
- 建工作项 / AI 拆任务 / 上传附件 → `references/create-and-breakdown.md`
- 报错排查 / 服务端怪象 / 字段集差异 → `references/troubleshooting.md`

## 运行入口

CLI 路径（相对本 skill）：`cli/bk.mjs`，Node ≥ 18，无需安装依赖。

调用形式：
```bash
node <skill-root>/bk/cli/bk.mjs <subcommand> [args...]
```
当前会话用全路径 `node /Users/ws/test/skills/bk/cli/bk.mjs …`。让用户自行 `alias bk=...`，skill 本身不依赖 alias。

## 初始化：由 agent 代替用户执行

> **核心原则**：本 CLI 不是全局命令，让用户在终端里自己敲 `node /绝对路径/bk.mjs auth …` 是坏体验。遇到配置缺失，**agent 必须接管**：用对话问用户拿到关键值（token / project_id / issue_number），再**自己通过 Bash 工具调 CLI 落盘**，不要把命令甩给用户手工执行。

### 触发条件

任何一条满足就进入对应引导workflow：

- 任何 tool 返回 `missing bk-mcp token` → 跳到 [场景 A](#场景-a-token-缺失)
- 需要 `project_id` 的 tool 报 `项目[...]不存在或在CTeam中未初始化`，或 `doctor` 报 `project_id.value: null` → 跳到 [场景 B](#场景-b-project_id-缺失)
- 首次使用本 skill / 用户问"我有没有配好" → 跑 `doctor` + `smoke-test.sh`，按报告对号入座

### 场景 A：token 缺失

agent 打出的话（模板）：

> 需要先配置 bk-mcp 的 token。
>
> 1. 打开 <https://mcp.300624.cn/api-keys>，登录后生成一个 API key（形如 `ak_xxxx.yyyy…`）。
> 2. 把生成的 token 粘贴到对话里发给我，我来帮你保存和验证——**不需要你打命令**。
>
> 提示：token 会写入 `~/.config/bk-mcp/token`（权限 0600，仅当前用户可读）。

用户粘贴 token 后，agent 连续执行：

```bash
# 1. 带 --verify 存盘：token 错则不落盘，exit 2
node /绝对路径/bk/cli/bk.mjs auth "$TOKEN" --verify

# 2. 再跑 doctor 做一次整体自检
node /绝对路径/bk/cli/bk.mjs doctor
```

- `auth --verify` 成功回显形如 `{ "ok": true, "preview": "ak_2ecd9…29fd", "verified": true }`，agent 回用户"已保存，指纹 `ak_2ecd9…29fd`，可以继续了"。
- `--verify` 失败（exit 2）→ 不落盘，提示用户 token 可能粘错/已失效，让用户到 api-keys 页检查后重发。

### 场景 B：project_id 缺失

agent 打出的话（模板）：

> 当前仓库还没绑定蓝鲸项目 ID，需要配置一下。有两种提供方式，二选一：
>
> - 如果你知道项目 ID，直接发给我（形如 `v10125`，**不是** `p328` 那种工作项前缀）。
> - 如果不知道，发任何一条你在这个项目里遇到过的 issue_number 给我（形如 `p328_8729`），我来反查。

两种输入的处理路径：

**用户直接给 v 开头的 ID：**
```bash
# 格式校验：/^v\d+$/
# 写入（会保留 config 其它字段，只改 project.bkProjectId）
node /绝对路径/bk/cli/bk.mjs project set v10125
```

**用户给 issue_number：**
```bash
# 先用 get_issue 反查项目 ID
PID=$(node /绝对路径/bk/cli/bk.mjs get_issue --issue_number p328_8729 \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["basic_info"]["project_id"])')
# 再落盘
node /绝对路径/bk/cli/bk.mjs project set "$PID"
```

> **不要**用 `search_projects` 做项目发现——服务端维表当前不可用，见 `references/troubleshooting.md`。

落盘后 agent 回用户："已写入 `.claude/config/project-config.json`，项目 ID = `v10125`。"

### 场景 C：首次使用全workflow自检

如果上面两个场景都要配，一次性做完再 smoke：

```bash
node /绝对路径/bk/cli/bk.mjs auth "$TOKEN" --verify
node /绝对路径/bk/cli/bk.mjs project set "$PID"
bash /绝对路径/bk/cli/smoke-test.sh   # 全读只，15 个检查点
```

smoke 全绿就可以交付给用户。

---

## 配置解析：token / 端点 / 项目 ID（参考）

CLI 读三类上下文，优先级统一走"命令行 → 环境变量 → 文件"。随时用 `doctor` 查当前实际生效值。**agent 不要直接让用户操作下面这些**——上面的"初始化"workflow已经封装好了。

### 凭据层

**Token** — 从 <https://mcp.300624.cn/api-keys> 生成。

| 顺序 | 来源 | 作用域 |
|---|---|---|
| 1 | `env MCPR_TOKEN` | 临时 / CI / 切账号 |
| 2 | `~/.config/bk-mcp/token`（0600） | 默认长期 |

**端点** — 默认 `http://192.168.82.121:3088/bk/mcp`（**内网地址**，VPN/办公网外不通），`env BK_MCP_URL` 覆盖。

### 上下文层：project_id（v10125 格式）

有 4 个 tool 必须带项目 ID：`list_issues` / `create_issue` / `create_blueking_task` / `task_breakdown`。CLI 按以下顺序解析：

| 顺序 | 来源 | 说明 |
|---|---|---|
| 1 | `--project_id <值>`（或 `list_issues` 的 `--project_name`） | 临时覆盖，跨项目 ad-hoc |
| 2 | `env BK_PROJECT_ID` | 当前 shell 生效 |
| 3 | `${cwd}/.claude/config/project-config.json` 的 `project.bkProjectId` | 仓库级默认 |

CLI 自动注入时会在 stderr 打 `info: project_id=v10125 (from ...)`。**值的格式必须是 `/^v\d+$/`（如 `v10125`）**；传错（如 `p328` Issue 前缀）bk-mcp 会返 400，CLI 也会印 warning 但不阻断。

### 快速自检

```bash
node /绝对路径/bk/cli/bk.mjs doctor    # token 来源 / 端点 / project_id / 连通性 一次看齐
bash /绝对路径/bk/cli/smoke-test.sh    # 15 个只读检查点，不写入 bk-mcp
```

`smoke-test.sh` 可选环境变量：
- `BK_SMOKE_PROJECT_ID=v10125`：显式给 `list_issues` 用的项目 ID
- `BK_SMOKE_ISSUE=p328_8729`：指定 `get_issue` / dry-run 测试目标；不设则自动用 `get_todolist` 第一条

退出码：`0` 全通 / `1` 至少一条失败。

## 通用调用语法

```bash
# 风格 A：--json，整坨 JSON（数组/嵌套参数首选）
node cli/bk.mjs <tool> --json '{"project_id":"v10125","states":["待处理"]}'

# 风格 B：--key value / --key=value，适合简单参数
node cli/bk.mjs <tool> --project_id v10125 --page_size 5
```

CLI 自动识别数字/布尔/JSON 字面量。参数名一律 **snake_case**（跟服务端 inputSchema 一致，不是驼峰）。

## 开发者日常：6 个高频命令

### 1) 看待办：今天要做什么

```bash
node cli/bk.mjs get_todolist --page 1 --size 10
```
返回 summary 文本 + `items[]`，每个 item 有 `number / title / state / priority / url / type_classify`。

### 2) 按项目/经办人/状态拉 Issue 列表

```bash
# 最简：cwd 已有 .claude/config/project-config.json → 不用传 project_id
node cli/bk.mjs list_issues --page 1 --page_size 20

# 显式传项目
node cli/bk.mjs list_issues --project_id v10125 --page 1 --page_size 20

# 复合筛选：states 是数组，用 --json 最省事
node cli/bk.mjs list_issues --json '{
  "states": ["待处理", "处理中"],
  "type_classify": "BUG",
  "operator_user": "fanjj",
  "priority": "HIGH",
  "page": 1,
  "page_size": 20
}'
```

必传：`project_id` **或** `project_name`（二选一，CLI 会按 config/env 自动回填）。可用筛选：`states[]` / `priority` / `operator_user` / `create_user` / `type_classify` / `create_time_from` / `create_time_to`。

> **⚠️ `project_id` 必须是 `v10125` 形式**（vTeam 内部 ID），**不是** `p328`（Issue 前缀）。见开头"配置解析 → 上下文层"。

### 3) 查单条 Issue 详情

```bash
# 基本信息
node cli/bk.mjs get_issue --issue_number p328_8729

# 全量字段（含自定义字段、版本、经办人等，93+ 项）
node cli/bk.mjs get_issue --issue_number p328_8729 --include_all_fields true
```

返回的 `basic_info` 里同时有两种 ID：
- `number`: `p328_8729` — 用户可见编号，大多数 API 入参用这个
- `id`: `11b07d3439914393bc587f3209ef204b` — 内部 UUID，`create_issue --parent_id` / `task_breakdown --issue_id` 用这个

### 4) 流转状态（先预览再流转）

```bash
# 先看当前状态和可达状态
node cli/bk.mjs transition_issue --issue_number p328_8729 --list_states true

# 从返回的 available_states[].name 里挑一个
node cli/bk.mjs transition_issue \
  --issue_number p328_8729 \
  --target_state 处理中 \
  --comment "已定位到 components/TeamRank/useRank.ts，开始修"
```

> **⚠️ 合法状态集按工作项类型分裂**。BUG 是 `待处理/处理中/待验证/延后处理/不做处理/拒绝/已验证/重新打开`；Task 只有 `待处理/处理中/已暂停/已取消`。凭记忆传容易 `未找到目标状态「X」`，先跑 `--list_states true`。

### 5) 写评论 / 留 PR 链接 / @人

```bash
node cli/bk.mjs add_issue_comment \
  --issue_number p328_8729 \
  --comment "修复 PR: https://git.internal/xxx/pull/123，已覆盖单测"

# 要 @ 人，加 at_users 数组
node cli/bk.mjs add_issue_comment --json '{
  "issue_number": "p328_8729",
  "comment": "已合入，麻烦验证",
  "at_users": ["lixia", "qatester"]
}'
```

> **⚠️ 无删除 API**，评论写入后只能在平台 UI 手工删。执行前如果不确定，先问用户。

### 6) 改字段：dry-run → list_fields → 真改

```bash
# 先预览当前 Issue 有哪些可编辑字段、可选项
node cli/bk.mjs update_issue --issue_number p328_8729 \
  --dry_run true --list_fields true

# 改优先级（中文名即可）
node cli/bk.mjs update_issue --issue_number p328_8729 --priority 高

# 改标题
node cli/bk.mjs update_issue --issue_number p328_8729 --title "【团队管理】新标题"
```

**追加描述（desc 是覆盖不是追加，要先读再拼）：**
```bash
ORIG=$(node cli/bk.mjs get_issue --issue_number p328_8729 \
        | python3 -c "import json,sys;print(json.load(sys.stdin)['basic_info'].get('desc') or '')")
node cli/bk.mjs update_issue --issue_number p328_8729 \
  --desc "${ORIG}

---
补充：已复现于 v1.00.30，根因是 useEffect 依赖漏写"
```

> **⚠️ 所有 TEXT/TEXTAREA 字段都是 replace 语义**，包括 `title` / `desc`。追加都要先 `get_issue` 读原值。

## 高频场景必懂的约束

集中 5 条最易踩的，深入看 `references/troubleshooting.md`：

1. **`project_id` 格式** = `v10125`（vTeam ID），**不是** `p328`（Issue 前缀）。
2. **枚举大小写歧视**：
   - **建**（`create_issue`）`priority` 用英文 `URGENT | HIGH | CENTRAL | LOW`，中文报 `非法优先级`
   - **改**（`update_issue` / `transition_issue`）`priority`、`target_state` 用中文（"高"/"处理中"）
3. **`update` = 覆盖**，追加要先 `get_issue` 读原值再拼。
4. **不可逆动作清单**（没有对应删除 API，需用户平台端手工处理）：
   - `add_issue_comment`
   - `create_issue` / `create_blueking_task`（只能流转到"已取消"）
   - `upload_files`
   写入前如果只是为了"试一下"，停下来问用户。
5. **CLI 退出码**：
   - `0` 成功
   - `1` 本地错（缺 token / 参数错 / 网络不通）
   - `2` 服务端 tool 业务错（`isError:true`）
   调用方先看 exit code 再解析 stdout。

## 端到端示例：修一个 Bug 的完整生命周期

```bash
# A. 从待办挑一条
node cli/bk.mjs get_todolist --page 1 --size 10     # 选中 p328_8729

# B. 看详情 → 流转到处理中
node cli/bk.mjs get_issue --issue_number p328_8729
node cli/bk.mjs transition_issue --issue_number p328_8729 \
  --target_state 处理中 --comment "开始修"

# C. 修完，写结论 + 流转待验证
node cli/bk.mjs add_issue_comment --issue_number p328_8729 \
  --comment "PR: https://git.internal/xx/pull/123 已合入"
node cli/bk.mjs transition_issue --issue_number p328_8729 \
  --target_state 待验证 --comment "请 QA 验证"
```

需要上传截图、建子任务、AI 拆分 → `references/create-and-breakdown.md`。

## 输出convention（给调用方读）

- 成功：`content.text` 或 `structuredContent` 直出 stdout，已是字符串/JSON
- Tool 错（`isError:true`）：JSON 写 stderr，**exit 2**
- 网络/鉴权/参数错：简短文案写 stderr，**exit 1**

调用方只读 stdout，不要再包 `content:[{type:"text",text:...}]`。

## 工具清单（仅备查）

11 个 tool。用 `node cli/bk.mjs list-tools` 现读 inputSchema。

| 高频（本文已覆盖） | 低频（references/create-and-breakdown.md） |
|---|---|
| `get_todolist` | `create_issue` |
| `list_issues` | `create_blueking_task` |
| `get_issue` | `task_breakdown` |
| `transition_issue` | `upload_files` |
| `add_issue_comment` | `search_projects`（服务端问题，见 troubleshooting） |
| `update_issue` | |
