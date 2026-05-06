# Plan: dingtalk-mcp skill (替代常驻 MCP)

> **v2** — 已合入 Codex review 保留意见（2026-04-30）。主要变化：skill 更名 `dingtalk-mcp`、凭证输入支持 `--stdin`、脱敏覆盖面扩大（二级 OSS URL / host allowlist）、危险操作清单扩展（分享、覆盖写、模式兜底）、schema 缓存加 24h TTL、smoke 不再硬断言工具数。

## Summary

在 `core/skills/` 下新增 `dingtalk-mcp` skill，封装钉钉文档 MCP（21 tools）+ 钉钉 AI 表格 MCP（43 tools）为单文件 Node CLI，解决两个 MCP 常驻时占用大量上下文的问题。模仿 bk skill 的三段式结构（SKILL.md + cli/ + references/），**继承并扩展**它的 agent-assisted 配置 UX、doctor/smoke 自检、危险操作确认协议。relative 到 bk 有两处关键差异：钉钉 MCP 无须 session（已实测直接 `tools/call` 成功），凭证是 URL 整体（比 token 泄露面大）。

## Metadata

- **Complexity**: Medium（~1100 行新增，80% 是 bk 结构同构改写 + 安全强化）
- **Confidence**: 8/10
- **Estimated Files**: 7 个新增，0 个修改
- **Key Risk**: URL+key 可能从 argv / shell history / 日志多路径泄露；危险操作清单覆盖不到未来新增的 share/overwrite 类工具

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | `core/skills/bk/cli/bk.mjs` | 1-498 | CLI 骨架（auth/doctor/list-tools/cmdCall）直接同构；重点：`openSession` 可去掉、`parseMcpResponse` 保留 SSE 分支 |
| P0 | `core/skills/bk/SKILL.md` | 1-331 | Skill 文风、agent-assisted 配置流程、危险操作确认表模板 |
| P0 | `core/skills/bk/cli/smoke-test.sh` | 1-197 | 冒烟脚本形态；**注意**：bk 硬断言 `tools (11)` 是隐患，新 skill 不重复 |
| P1 | `core/skills/bk/references/troubleshooting.md` | 1-60 | 报错速查表写法 |
| P1 | `core/specs/shared/pre-flight.md` | 76-87 | SKILL.md 顶部 `<PRE-FLIGHT>` 块 canonical 模板 |

## Patterns to Mirror

### MCP HTTP 调用（去 session 版）

// SOURCE: core/skills/bk/cli/bk.mjs:105-126（parseMcpResponse 保留）

```javascript
async function parseMcpResponse(res) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) throw new Error(redact(`HTTP ${res.status}: ${text.slice(0, 500)}`));
  if (ct.includes("application/json")) return JSON.parse(text);
  // SSE 分支保留（MCP 规范允许）
  ...
}
```

- 去掉 `openSession` / `sendNotification`（已实测钉钉 MCP 直接 `tools/call` 成功）
- headers 只留 `content-type` + `accept`，URL 自带 key，无 Authorization

### 工具透传 + 危险操作守护

// SOURCE: core/skills/bk/cli/bk.mjs:217-267（cmdCall）

保留：`parseToolArgs` / `coerce` / `structuredContent` 优先输出；
新增：两层拦截 —— **CLI 硬门**（`DANGEROUS_TOOLS` + 模式兜底，需 `--yes`）和 **skill 软门**（SKILL.md 要求 agent 展示影响范围给用户确认）。

### Agent 代用户配置 UX

// SOURCE: core/skills/bk/SKILL.md:27-111（"初始化：由 agent 代替用户执行"）

完全照搬。替换变量：`TOKEN` → `DOC_URL` / `SHEET_URL`；`auth` 命令**默认走 stdin** 避免 URL 进 argv。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `core/skills/dingtalk-mcp/SKILL.md` | CREATE | 主 skill 入口，~320 行 |
| `core/skills/dingtalk-mcp/cli/dingtalk-mcp.mjs` | CREATE | 单文件 CLI，~450 行 |
| `core/skills/dingtalk-mcp/cli/smoke-test.sh` | CREATE | 只读冒烟脚本（含 `redact` / 危险门断言） |
| `core/skills/dingtalk-mcp/references/doc.md` | CREATE | 21 个文档工具分类速查 |
| `core/skills/dingtalk-mcp/references/sheet.md` | CREATE | 43 个表格工具分类速查 |
| `core/skills/dingtalk-mcp/references/field-rules.md` | CREATE | AI 表格字段类型 config 规则（搬 dws） |
| `core/skills/dingtalk-mcp/references/troubleshooting.md` | CREATE | 错误码 + recovery + 遇到疑似破坏性工具未拦截的上报指引 |

---

## 设计要点

### 1. 凭证与端点

**配置文件**：`~/.config/dingtalk-mcp/servers.json`（目录 0755 / 文件 0600，写入用 temp + rename 原子替换）

```json
{ "doc": "https://mcp-gw.dingtalk.com/server/<hash>?key=<key>",
  "sheet": "https://mcp-gw.dingtalk.com/server/<hash>?key=<key>" }
```

**输入方式**（防 argv 泄露）：

```bash
# 推荐：stdin，URL 不进 shell history
echo "https://mcp-gw.dingtalk.com/server/...?key=..." | node dingtalk-mcp.mjs auth doc --stdin --verify

# 兼容：直接参数（打 warning，提示用户清 history）
node dingtalk-mcp.mjs auth doc <url> --verify
```

**环境变量覆盖**：`DINGTALK_DOC_URL` / `DINGTALK_SHEET_URL`

**URL 准入校验**（写入前）：
- 必须 `https:`
- Host 必须在 allowlist：默认 `mcp-gw.dingtalk.com`，可通过 `DINGTALK_HOST_ALLOWLIST` 追加

**脱敏（`redact()` 统一处理）**：
- 覆盖所有 `die()` / `throw new Error` / `console.error` / doctor 输出 / smoke 失败预览
- 处理字段：`key=` / `signature=` / `Expires=` / `accessKeyId=` / `policy=`（OSS 预签名 URL 里的二级凭证）
- 处理方式：`<param>=<前 4 位>...<后 4 位>`（整体长度 < 12 时 → `***`）
- doctor 默认输出只显示：host、server hash 末 8 位、key 末 4 位，**不输出完整 URL**；`--unsafe-full` 显式放行才打完整（用于调试）

**不和 bk 合并**：两个 MCP 独立 server，命名空间并列（`~/.config/bk-mcp/` 与 `~/.config/dingtalk-mcp/`）。

### 2. CLI 命令面

```
node dingtalk-mcp.mjs help
node dingtalk-mcp.mjs auth doc --stdin [--verify]       # 推荐路径
node dingtalk-mcp.mjs auth doc <url> [--verify]         # 兼容路径（warn）
node dingtalk-mcp.mjs auth sheet --stdin [--verify]
node dingtalk-mcp.mjs doc <tool> [--k v | --json '{}' | --yes]
node dingtalk-mcp.mjs sheet <tool> [--k v | --json '{}' | --yes]
node dingtalk-mcp.mjs list-tools [doc|sheet|all] [--refresh]
node dingtalk-mcp.mjs schema doc.<tool> [--refresh]
node dingtalk-mcp.mjs schema sheet.<tool>
node dingtalk-mcp.mjs ping
node dingtalk-mcp.mjs doctor [--unsafe-full]
```

**显式 `doc` / `sheet` 路由**：避免未来工具名冲突 + skill 路由更自然。

**不内置 `--jq`**：和 bk 一致，用户自行 pipe `jq`。v1 plan 里 T3 验证命令用了 `--jq` 是笔误，已修正。

### 3. 危险操作拦截（两层）

**CLI 硬门（`DANGEROUS_TOOLS` + 模式兜底）**：

显式清单：

| MCP | 工具 | 类型 |
| --- | --- | --- |
| doc | `delete_document_block` | destroy |
| doc | `delete_document` | destroy |
| doc | `update_document` | overwrite（**注意：钉钉 MCP 的 update_document 等同全量覆盖，危险等级同 delete**）|
| sheet | `delete_base` | destroy |
| sheet | `delete_table` | destroy |
| sheet | `delete_field` | destroy（列数据同步清空）|
| sheet | `delete_view` | destroy |
| sheet | `delete_records` | destroy |
| sheet | `delete_chart` | destroy |
| sheet | `delete_dashboard` | destroy |
| sheet | `update_field` | schema-change（改类型可能丢数据）|
| sheet | `update_dashboard_share` | visibility（公开分享→间接数据泄露）|
| sheet | `update_chart_share` | visibility |

**模式兜底**（未来服务端新增工具时自动覆盖）：工具名匹配以下前缀一律进入硬门：
- `delete_` / `remove_` / `clear_` / `drop_` / `truncate_`

无 `--yes` 时：exit 3，打印 `{tool, type, hint: "--yes to confirm"}`，不发请求。

**Skill 软门**（SKILL.md 中的 agent 协议）：
调危险工具前，agent 必须先给用户看：目标 ID + 一句话影响范围 + "回复 '确认' 继续"。用户确认后 agent 再加 `--yes`。覆盖 CLI 清单 + 模式兜底可能漏掉的所有高影响操作（批量 `update_records` / `import_data` 等由 skill 层提醒，CLI 不硬拦）。

### 4. Schema 缓存

- 位置：`~/.cache/dingtalk-mcp/tools-{doc,sheet}.json`
- 内容结构：
  ```json
  { "fetchedAt": "2026-04-30T...", "serverFingerprint": "<host>+<hash-last-8>",
    "toolCount": 21, "tools": [...] }
  ```
- **默认 TTL 24h**：`list-tools` / `schema` 读缓存时若过期自动刷新
- 触发自动刷新：JSON 解析失败 / server fingerprint 变化 / tool miss（`schema doc.xxx` 找不到 xxx）
- 手动：`list-tools --refresh` / `schema <tool> --refresh`

### 5. 输出与退出码

**语义**（"继承 bk 风格，扩展为 5 档"，非完全对齐）：

| 退出码 | 场景 |
| --- | --- |
| 0 | 成功；**doctor 永远 exit 0**（即使 token 缺失/不通），便于 smoke 集成 |
| 1 | 通用错误：网络 / JSON 解析 / 本地参数错 |
| 2 | 凭证缺失；`auth --verify` 失败；401/403 |
| 3 | 危险操作未加 `--yes` |
| 4 | MCP JSON-RPC `body.error` 或 tool `result.isError=true` |

**输出策略**：`structuredContent` 优先；没有则 join `content[].text`；所有 info/warn 走 stderr 并经 `redact()`。

---

## Tasks

### T0: Spike 验证（前置）

- **Action**: 确认钉钉两个 MCP 都能裸 `tools/call` 无 session；记录 tool count 和一个 happy-path 响应
- **File**: 对话上下文已完成（curl 验证 doc=21 / sheet=43，`tools/call` 直返 200）
- **Verify**: 本会话已验证，进入 T1

### T1: 搭架子 + 凭证层 + 脱敏

- **Action**:
  1. 创建 `core/skills/dingtalk-mcp/{cli,references}`
  2. 实现 `redact(str)` 统一脱敏函数（覆盖 `key=` / `signature=` / `Expires=` / `accessKeyId=` / `policy=`）
  3. `readServerUrl(kind)` / `saveServerUrl(kind, url)`（原子写入 + 准入校验）
  4. `cmdAuth` 支持 `--stdin`（优先）+ 参数（兼容 + warn）
  5. `cmdDoctor`（默认脱敏 + `--unsafe-full` 开关）
- **File**: `core/skills/dingtalk-mcp/cli/dingtalk-mcp.mjs`
- **Mirror**: bk.mjs:45-72 / 286-325 / 385-419
- **Verify**:
  ```bash
  # 推荐路径
  echo "https://mcp-gw.dingtalk.com/server/af362c33.../?key=093e..." \
    | node cli/dingtalk-mcp.mjs auth doc --stdin --verify
  stat -f "%A" ~/.config/dingtalk-mcp/servers.json  # 600
  node cli/dingtalk-mcp.mjs doctor | grep -v "key=[a-zA-Z0-9]\{16\}"  # 应不含完整 key
  # Host 越权拒绝
  echo "https://evil.example.com/foo?key=x" | node cli/dingtalk-mcp.mjs auth doc --stdin
  # 应 exit 2 + "host not in allowlist"
  ```

### T2: RPC + 工具调用（去 session）

- **Action**: `rpc(kind, body)` + `parseMcpResponse`（保留 SSE 分支）+ `cmdCall(kind, tool, rest)` + `parseToolArgs` / `coerce`
- **File**: `core/skills/dingtalk-mcp/cli/dingtalk-mcp.mjs`
- **Mirror**: bk.mjs:105-145 / 180-212 / 217-267（cmdCall 删除 openSession 部分）
- **Verify**:
  ```bash
  node cli/dingtalk-mcp.mjs doc search_documents --keyword test | head
  node cli/dingtalk-mcp.mjs sheet list_bases | head
  node cli/dingtalk-mcp.mjs doc list_document_blocks \
    --json '{"nodeId":"pYLaez...","startIndex":0,"endIndex":5}'
  ```

### T3: 危险操作拦截 + Schema 缓存 + TTL

- **Action**:
  1. `DANGEROUS_TOOLS` 显式清单（13 项，见设计要点 §3）
  2. `isDangerousByPattern(name)` 模式兜底（`delete_` / `remove_` / `clear_` / `drop_` / `truncate_`）
  3. `cmdCall` 进入前：两者任一命中且无 `--yes` → exit 3
  4. `cmdListTools(kind, refresh)` + `cmdSchema(path, refresh)` + cache TTL 24h + fingerprint 校验
- **File**: `core/skills/dingtalk-mcp/cli/dingtalk-mcp.mjs`
- **Mirror**: CLI 拦截无直接对应（从 dws SKILL.md § "危险操作确认" 抽设计）；cache 是新增
- **Verify**:
  ```bash
  # 硬门拒绝（清单内）
  node cli/dingtalk-mcp.mjs sheet delete_base --baseId fake; echo "exit=$?"   # 3
  # 硬门拒绝（模式兜底，伪工具名）
  node cli/dingtalk-mcp.mjs sheet truncate_records --tableId fake; echo "exit=$?"  # 3
  # 放行（--yes）→ 因 ID 伪造服务端返回 isError=true → exit 4（证明拦截放行了）
  node cli/dingtalk-mcp.mjs sheet delete_base --baseId fake --yes; echo "exit=$?"  # 4
  # 缓存
  node cli/dingtalk-mcp.mjs list-tools doc > /dev/null
  cat ~/.cache/dingtalk-mcp/tools-doc.json | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["toolCount"], d["serverFingerprint"])'
  # 无参 schema 命中缓存
  node cli/dingtalk-mcp.mjs schema doc.create_document | python3 -c 'import json,sys;print(json.load(sys.stdin)["required"])'
  ```

### T4: 冒烟脚本（含安全断言）

- **Action**: `smoke-test.sh`，形态同 bk，增加：
  - 脱敏断言：`doctor` 输出不含 URL 里完整 key（正则反查）
  - 危险门断言：伪 ID 调 `delete_base` 不带 `--yes` 必须 exit 3
  - **不硬断言工具数**：改为 "doc 工具数 ≥ 20 且 sheet 工具数 ≥ 40"，服务端新增工具不会让 smoke 假失败
- **File**: `core/skills/dingtalk-mcp/cli/smoke-test.sh`
- **Mirror**: bk/cli/smoke-test.sh（注意不要抄第 89/111 行的硬断言）
- **Verify**: `bash core/skills/dingtalk-mcp/cli/smoke-test.sh` 全绿 exit 0

### T5: SKILL.md 主入口

- **Action**: frontmatter（`name: dingtalk-mcp`；`description` 触发词收窄到 "钉钉 MCP / MCP URL / mcp-gw / 常驻 MCP 占上下文 / dingtalk-mcp CLI"，**显式排除** "dws / dws CLI"）+ 意图路由决策树 + 与 dws 的路由边界（明确 MCP URL → 本 skill；明确 dws → dws；两可 → 问用户）+ agent-assisted 配置 UX（场景 A: URL 缺失，引导 stdin 粘贴；场景 B: 首次全量自检）+ 危险操作确认表（CLI 硬门 13 项 + skill 软门清单）+ 调用语法 + Recipe（建文档 / 块级编辑 / 批量导入记录）+ 错误处理 + references 索引
- **File**: `core/skills/dingtalk-mcp/SKILL.md`
- **Mirror**: bk/SKILL.md 全结构
- **Verify**:
  - `grep -c "^## " SKILL.md` ≈ 10-12
  - frontmatter `name: dingtalk-mcp`（不是 `dingtalk`）
  - description 不含 "钉钉文档"/"AI 表格" 这类通用词单独出现，必须和 "MCP" / "URL" 同句出现

### T6: References 三件套

- **Action**:
  - `references/doc.md`: 21 个文档工具按 "创建 / 读取 / 编辑 / 组织 / 附件" 5 类组织；顶部声明 "参数以 `dingtalk-mcp schema doc.<tool>` 为准"
  - `references/sheet.md`: 43 个表格工具按 "Base / Table / Field / Record / View / Chart / Dashboard / Import-Export / Attachment" 分组；同样的顶部声明
  - `references/field-rules.md`: AI 表格字段类型 config 规则（搬 dws）
- **File**: 三个 references 文件
- **Mirror**: bk/references/*.md（文风）+ dws references/products/aitable.md（内容骨架）
- **Verify**: 工具数量等于 MCP 返回数量（doc=21 / sheet=43）

### T7: Troubleshooting + 最终 Codex Review

- **Action**:
  1. `references/troubleshooting.md`（URL 错误 / host 越权 / 401/403 / isError 返回 / 常见参数误用 / **"遇到疑似破坏性工具未被 CLI 拦截"的上报指引**）
  2. 所有代码落盘后，最后一次调 codex read-only review：重点看 redact 覆盖是否完整、危险门是否正确、smoke 是否能复现假阴性
- **File**: `references/troubleshooting.md` + 一次 codex 独立 review
- **Mirror**: bk/references/troubleshooting.md
- **Verify**: codex 给出 "go" 或只有可忽略的 lint 级意见

---

## Testing Strategy

- **单元粒度**：bk skill 无单测，这里也不设。但 smoke-test 增加两条断言：脱敏正则 + 危险门 exit 3
- **集成**：T4 smoke-test.sh 覆盖两个 MCP 只读路径 + 安全断言
- **Codex review**：两轮 —— plan 阶段（已完成，本文件已合入）+ 代码落盘后（T7）
- **人工验证**：新会话里假装 "帮我在钉钉文档里建一个文档"，看 skill 是否正确触发 + 引导 `auth --stdin`

---

## Risks

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |
| URL+key 从 argv/history/日志泄露 | High → Medium | `auth --stdin` 为推荐路径；`redact()` 覆盖 5 类敏感参数；doctor 默认脱敏 + `--unsafe-full` 显式放行 |
| 危险工具清单漏掉新增破坏性工具 | Medium | 模式兜底（`delete_`/`remove_`/`clear_`/`drop_`/`truncate_`）；troubleshooting 留上报通道 |
| schema 漂移导致参数构造错误 | Medium | 24h TTL + fingerprint 校验自动刷新；SKILL.md 明示 "参数以 schema 输出为准" |
| 与 dws skill 触发冲突 | Medium | skill 改名 `dingtalk-mcp`；description 显式排除 dws；SKILL 顶部路由决策 |
| 用户 commit 了 `~/.config/dingtalk-mcp/` | Low | 该目录在 HOME 下，非仓库路径，天然不会被 commit；SKILL 仍加警告 |
| 钉钉 MCP 未来要求 initialize | Low | 本会话 curl 已实测无 session 工作；如未来改要 session，加回 openSession 即可（~30 行） |

---

## Codex Review 结果（v1 → v2 变更摘要）

| 审查点 | Codex 判定 | 已合入修改 |
| ---- | ---- | ---- |
| 凭证脱敏面 | 建议修改 | §1 扩展 redact 覆盖、auth --stdin、host allowlist、doctor 默认脱敏 |
| 危险操作清单 | 建议修改 | §3 扩展到 13 项 + 模式兜底；拆 CLI 硬门 / skill 软门 |
| 退出码语义 | 有保留 | §5 改写为 "继承 bk 风格扩展 5 档"；doctor 永远 exit 0 |
| Schema 缓存失效 | 建议修改 | §4 加 24h TTL + fingerprint 自动失效；smoke 不硬断言工具数 |
| 与 dws 冲突 | 建议修改 | skill 更名 dingtalk-mcp；description 收窄；SKILL 显式路由边界 |
| 额外坑 | - | 删除 plan 中 `--jq` 笔误；修正示例 URL 空格；T0 spike 已在本会话完成 |

整体判断：保留 → **go**（所有保留项已合入）。
