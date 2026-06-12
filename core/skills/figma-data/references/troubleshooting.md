# 故障排查

## CLI 退出码

三个 wrapper skill（`bk` / `alidocs` / `figma-data`）共享同一套退出码（ADR-0001）：

| code | 含义 | 第一步看哪 |
| --- | --- | --- |
| 0 | 成功 | stdout JSON |
| 1 | 本地错：参数 / 网络 / JSON 解析 / `diff-tools` 检出 drift 未 `--promote` | stderr 文案 |
| 2 | auth 错：401 / 403 / OAuth 失败；归一化 `{kind:"auth"}` | 跑 `figma doctor` 或重做 OAuth |
| 3 | 危险工具未 `--yes` | stderr 的 blocked JSON；与用户确认再加 `--yes` |
| 4 | 服务端业务错：tool 返回 `body.error` | stderr JSON；按 hint 修参数后重试 |
| 5 | tool_not_found；归一化 `{kind:"tool_not_found"}` | 走 [Tool 漂移检测](#drift) |
| 6 | enum_invalid；归一化 `{kind:"enum_invalid"}` | 用 schema 重 refresh + 同步 SKILL.md snapshot |

`5` / `6` 由 `_shared/mcp-baseline.mjs` 归一化，stderr 输出 `{kind, hint, originalMessage}` 结构化对象。

---

<a name="drift"></a>
## Tool 漂移检测（diff-tools）

`figma-data` 通过双层 baseline 应对上游 Figma Dev MCP 漂移（ADR-0001）：checkin 权威 baseline 在 `core/skills/figma-data/baseline-schema.json`（随 repo 提交），本地 cache 由 CLI 透明维护。

### 主动巡检

```bash
node cli/figma.mjs diff-tools                 # 比对当前 MCP 工具表与 checkin baseline
node cli/figma.mjs diff-tools --promote       # 已确认 drift 是预期的 → 写入新 baseline
node cli/figma.mjs diff-tools --promote-initial   # 仅首次建立 baseline 用
```

输出：`has_drift` / `drift.added` / `drift.removed` / `drift.changed`。`has_drift=true` 且未 `--promote` 时 CLI 退 1（CI-friendly）。

### drift 报警处理顺序

1. **先看 `removed`**：上游下线 tool（如曾经叫 `get_code` 现在叫 `get_design_context`）→ 全文搜旧 name → 替换为新等价 tool → promote
2. **再看 `changed`**：required / 静态 enum 变了 → 同步更新 SKILL.md `<!-- snapshot YYYY-MM-DD -->` + Design Package 字段映射 → 必要时 bump `schemaVersion` → promote
3. **最后看 `added`**：上游新增 tool → 评估是否暴露给 figma-ui → promote

**`schemaVersion` 升版规则**：Design Package 的 `schemaVersion` 是 figma-data 与 figma-ui 之间的 contract，当前权威值见 `cli/figma.mjs` 的 `DESIGN_PACKAGE_SCHEMA_VERSION`（单一事实源，本文不写死字面量）。新增字段（向后兼容）保持当前版本不变；字段语义变化 / 移除必填字段时在当前版本上 bump（minor 如 1.1→1.2，breaking 如 →2.0），同步更新 figma-ui Phase A Gate 0 的 assert。先例：1.0→1.1 移除 DesignAnchors、新增 taskType/DesignInventory（ADR-0005）。

### `spec-review` 第 7 类周巡

`spec-review` 扫 SKILL.md 中 `<!-- snapshot YYYY-MM-DD -->`，>90d 标 warning / >180d 升 advisory。Figma MCP 迭代相对较快，建议每次 Figma Desktop 大版本升级后跑一次 `diff-tools`。

---

## MCP 连接

### Issue: MCP server not found / 连接拒绝

**原因**: Figma MCP 未配置,或 Desktop 未启动,或端口被占

**解决**:

**Desktop 模式**:
1. 确认 Figma Desktop 已打开并登录
2. Figma Desktop → Preferences → 启用 "Dev Mode MCP Server"
3. 确认端口 3845 可访问：`curl -s http://127.0.0.1:3845/mcp | head -c 100`
4. 添加 MCP 配置：
   ```bash
   claude mcp add figma-mcp --transport sse --url http://127.0.0.1:3845/mcp
   ```
5. 重启 Claude Code

**Remote 模式**:
1. 添加 MCP 配置：
   ```bash
   claude mcp add figma-mcp --transport http --url https://mcp.figma.com/mcp
   ```
2. 首次调用会触发 OAuth 授权,在浏览器中完成
3. 确认网络可达 `mcp.figma.com`

### Issue: OAuth 授权失败（Remote 模式）

**原因**: 浏览器未弹出,或授权超时

**解决**:
1. 检查终端是否打印了 OAuth URL,手动在浏览器打开
2. 确认 Figma 账号有有效订阅
3. 重试：删除 MCP 配置后重新添加
   ```bash
   claude mcp remove figma-mcp
   claude mcp add figma-mcp --transport http --url https://mcp.figma.com/mcp
   ```

### Issue: Desktop MCP 要求 Dev/Full seat

**原因**: 免费或 Starter plan 不支持 Desktop MCP

**解决**: 切换到 Remote 模式,任意 Figma plan 均可使用 `https://mcp.figma.com/mcp`。

---

## Image Source 配置

### Issue: Path for asset writes as tool argument is required

**原因**: Image Source 设为 Download 但调用 `get_design_context` 时未传 `dirForAssetWrites`

**解决**:
1. 先获取 `assetsDir`（从 `.claude/config/ui-config.json` 或使用默认值 `public/images`）
2. 构造临时目录：`${assetsDir}/.figma-ui/tmp/${taskId}`
3. 调用时传入绝对路径：
   ```
   get_design_context(nodeId="42:15", dirForAssetWrites="/abs/path/project/public/images/.figma-ui/tmp/task-1")
   ```

### Issue: dirForAssetWrites 传了但没有文件生成

**原因**: Image Source 设为 Local Server,此时 `dirForAssetWrites` 无效

**解决**:
- 确认 Figma Desktop → Preferences → Dev Mode MCP → Image source 设为 **Download**
- 或者不传 `dirForAssetWrites`,改为消费返回的 localhost URL

### Issue: 资源文件异步延迟（Download 模式）

**原因**: `get_design_context` 返回后资源可能还在异步写入

**解决**:
1. 返回后等待 2-3 秒再 `ls` 目录
2. 或 poll 目录直到文件数稳定
3. 在 Phase A.3 中,前后两次 `ls` 做差集时考虑此延迟

---

## 参数错误

### Issue: fileKey missing / invalid

**原因**: 使用 Remote MCP 时未传 `fileKey`，或 URL 解析错误

**解决**:
1. 从 URL `https://figma.com/design/:fileKey/:fileName?node-id=1-2` 提取 `/design/` 后的路径段
2. Branch URL 特殊处理：`/design/:fileKey/branch/:branchKey/:fileName` → 用 **branchKey** 作为 fileKey
3. Remote MCP 必须传 `fileKey`；Desktop MCP 可省略（自动用当前打开文件）

### Issue: nodeId 格式错误

**原因**: URL 中 `node-id=1-2` 传给 MCP 时需要转为 `1:2`

**解决**: 将 `-` 替换为 `:`。正则：`/^(?:-?\d+[:-]-?\d+)$/`

### Issue: exit 5 + stderr `{"kind":"tool_not_found",...}`

**原因**: 上游 Figma Dev MCP 改名 / 下线了某个 tool。

**解决**: 走 [Tool 漂移检测](#drift)。**不要** 在 fallback 路径里硬编码旧 tool name 重试——会刷一波无效请求。

### Issue: exit 6 + stderr `{"kind":"enum_invalid",...}`

**原因**: 传给 tool 的 enum 值不在 Figma MCP 当前合法集（如 `format` / `imageType` 等）。

**解决**:
1. `node cli/figma.mjs schema <tool> --refresh` 重拉 schema cache
2. 如发现 enum 集真的变了 → 同步更新 SKILL.md `<!-- snapshot YYYY-MM-DD -->`
3. 通知 figma-ui Phase A 调用方采用当前合法 enum

---

## 数据问题

### Issue: designContext 返回为空或被截断

**原因**: 节点过于复杂或嵌套层级过多

**解决**: 分块获取：
1. 调用 `get_metadata(nodeId)` 获取节点结构概览
2. 从返回的 XML 中识别关键子节点的 nodeId
3. 对每个子节点分别调用 `get_design_context`，合并结果

### Issue: get_design_context 返回的代码不含资源引用

**原因**: 节点本身不含图片/SVG 等资源（纯布局/文本节点）

**解决**: 这是正常行为。纯布局节点不会生成资源文件,直接用代码实现即可。

---

## 资源问题

### Issue: 图片资源无法加载（Local Server 模式）

**原因**: Figma Desktop 已关闭或 MCP 服务停止

**解决**:
1. 确认 Figma Desktop 运行中
2. localhost URL 是 session-scoped,重启 Figma 后需要重新获取
3. 需持久化时用 `curl -o` 下载到本地

### Issue: Hash 文件名散落在代码中

**原因**: 跳过了 Asset Triage 直接编码

**解决**:
1. 回到 Phase A 完成 AssetPlan
2. 将已引用的 hash 文件批量 rename 为语义名
3. 全局替换代码中的文件引用

### Issue: 复合图形被拆成多个子 SVG

**原因**: `get_design_context` 导出了子图层而非父节点

**解决**:
1. 识别特征：多个 SVG 在同一位置叠加（背景 + 图标 + 装饰）
2. 标记当前资源为 `refetch-parent`
3. 获取父 Frame nodeId,重新 `get_design_context` 导出整张图片
4. 更新 AssetPlan

---

## Visual Review

### Issue: review 后仍有 P0 问题

**原因**: 存在未修复的视觉问题

**解决**:
1. 检查问题清单中的 P0/P1 问题
2. 按修复建议逐条修复
3. 最多循环 3 次
4. 超过则请求用户指导

### Issue: 实现与设计不匹配

**原因**: 视觉细节偏差

**解决**: 对照 Phase A 截图逐项检查：
- [ ] 间距：padding、margin、gap
- [ ] 颜色：背景、文字、边框
- [ ] 字体：大小、粗细、行高
- [ ] 布局：对齐、尺寸、层级
- [ ] 边框：圆角、宽度、样式
- [ ] 阴影：有无、参数

### Issue: 设计令牌与实现不一致

**原因**: 项目设计令牌值与 Figma 设计值不同

**解决**:
1. 优先使用项目令牌保持一致性
2. 微调间距/尺寸保持视觉还原度
3. 在代码注释中记录偏差原因
