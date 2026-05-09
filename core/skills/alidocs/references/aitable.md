# 钉钉 AI 表格 MCP — 43 个工具速查

> **参数细节以 `dingtalk-mcp schema aitable.<tool>` 为准**。本文件是用途分组 + 关键入参提醒。字段类型 `config` 规则另见 [`./field-rules.md`](./field-rules.md)。

服务端：`https://mcp-gw.dingtalk.com/server/c9a80c26.../?key=...`

## 术语

- **baseId**：AI 表格的 ID（类似 Airtable 的 Base）
- **tableId**：数据表 ID（一个 Base 可含多个 Table）
- **fieldId**：字段 ID
- **recordId**：行记录 ID
- **viewId**：视图 ID（grid / gallery / kanban 等）

**面向用户输出时**：优先显示 baseName / tableName / 可点击链接，隐藏 ID；除非排障或用户明确索要，不要直接呈现这些 ID（这是 MCP 服务端自己返回的 URL rules 提示）。

---

## Base（7）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `list_bases` | - | 列最近 Base（最多 5 条） | - |
| `search_bases` | `keyword` | 按名称搜 Base | - |
| `get_base` | `baseId` | Base 元数据 + 数据表列表 | - |
| `create_base` | `baseName` | 新建 Base | - |
| `update_base` | `baseId` | 改 Base 名 / icon | - |
| `copy_base` | `baseId`, `targetFolderId` | 复制整张 Base 到目标目录 | - |
| `delete_base` | `baseId` | **删整张 Base（含所有数据表 / 记录）** | **destroy** |
| `get_base_primary_doc_id` | `baseId`, `tableId` | 取主键（primaryDoc）字段的文档 ID | - |

## Table（3）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_tables` | `baseId` | 列 Base 下所有数据表 | - |
| `create_table` | `baseId`, `tableName`, `fields` | 建表；单次最多 15 字段（需更多用 `create_fields` 追加）；重名会自动续号 | - |
| `update_table` | `baseId`, `tableId` | 改表名 | - |
| `delete_table` | `baseId`, `tableId` | 删表（含所有字段/视图/记录） | **destroy** |

## Field（4） — 详细 `config` 规则见 [field-rules.md](./field-rules.md)

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_fields` | `baseId`, `tableId` | 列字段定义（含 config） | - |
| `create_fields` | `baseId`, `tableId`, `fields` | 批量加字段 | - |
| `update_field` | `baseId`, `tableId`, `fieldId` | 改字段名 / 类型 / options；**改类型可能丢数据** | **schema-change** |
| `delete_field` | `baseId`, `tableId`, `fieldId` | 删字段（该列所有值同步清空） | **destroy** |

## Record（4）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `query_records` | `baseId`, `tableId` | 查记录；支持 `viewId` / `filter` / `sort` / 分页 | - |
| `create_records` | `baseId`, `tableId`, `records` | 批量新建记录 | - |
| `update_records` | `baseId`, `tableId`, `records` | 批量更新记录 | - |
| `delete_records` | `baseId`, `tableId`, `recordIds` | 批量删记录 | **destroy** |

**批量规模提醒**：skill 层看到 `update_records` / `delete_records` 涉及 > 10 条记录时，必须在确认阶段额外强调"要操作 N 条"。

## View（4）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_views` | `baseId`, `tableId` | 列视图（含 filter / sort / 可见字段） | - |
| `create_view` | `baseId`, `tableId`, `viewName`, `viewType` | 新建视图（grid/gallery/kanban/...） | - |
| `update_view` | `baseId`, `tableId`, `viewId` | 改视图配置 | - |
| `delete_view` | `baseId`, `tableId`, `viewId` | 删视图 | **destroy** |

## Chart（5）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_chart` | `baseId`, `chartId` | 图表配置 + 元数据 | - |
| `get_dashboard_widgets_example` | - | 返回图表配置的 JSON 参考模板 | - |
| `create_chart` | `baseId`, `tableId`, `chartConfig` | 建图表 | - |
| `update_chart` | `baseId`, `chartId` | 改图表配置 | - |
| `delete_chart` | `baseId`, `chartId` | 删图表 | **destroy** |

## Chart Share（2）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_chart_share` | `baseId`, `chartId` | 查当前公开分享状态 | - |
| `update_chart_share` | `baseId`, `chartId`, `shareConfig` | **开启 / 关闭 / 更新公开分享链接** | **visibility** |

## Dashboard（5）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_dashboard` | `baseId`, `dashboardId` | 仪表盘布局 + 组件 | - |
| `get_dashboard_config_example` | - | 返回仪表盘配置的 JSON 参考模板 | - |
| `create_dashboard` | `baseId`, `dashboardConfig` | 新建仪表盘 | - |
| `update_dashboard` | `baseId`, `dashboardId` | 改仪表盘布局 / 组件 | - |
| `delete_dashboard` | `baseId`, `dashboardId` | 删仪表盘 | **destroy** |

## Dashboard Share（2）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_dashboard_share` | `baseId`, `dashboardId` | 查公开分享状态 | - |
| `update_dashboard_share` | `baseId`, `dashboardId`, `shareConfig` | **开启 / 关闭 / 更新公开分享链接** | **visibility** |

## Import & Export（3）

| 工具 | required | 说明 |
| --- | --- | --- |
| `prepare_import_upload` | `baseId`, `tableId`, `fileName` | 拿导入文件（Excel/CSV）的上传凭证（URL + token） |
| `import_data` | `baseId`, `tableId`, `uploadToken` | 用凭证把已上传文件转为记录，可同时建字段 |
| `export_data` | `baseId`, `tableId` | 导出数据为下载文件；可指定 `viewId` 限定范围 |

**两阶段上传**：prepare → 用返回的 URL/token 流式 PUT → import_data。CLI 不负责二进制上传，交给 `curl` / Node fetch。

## Attachment（1）

| 工具 | required | 说明 |
| --- | --- | --- |
| `prepare_attachment_upload` | `baseId`, `tableId` | 拿附件字段的上传凭证（给 attachment 类型字段用） |

## Template（1）

| 工具 | required | 说明 |
| --- | --- | --- |
| `search_templates` | `keyword` | 搜钉钉官方 Base 模板库 |

---

## 调用约束

1. **ID 来自上一步**：`baseId` / `tableId` / `fieldId` / `recordId` / `viewId` / `chartId` / `dashboardId` 必须从 `list_bases` / `get_base` / `get_tables` / `get_fields` / `query_records` / ... 的返回里提取，**不许编造**
2. **单次批量上限**：`create_records` / `update_records` / `delete_records` 建议 ≤ 30 条；`create_table` 初始字段 ≤ 15 个；超过先拆分
3. **字段 `config` 结构**：建字段或改字段类型时 `config` 结构差异很大，看 [field-rules.md](./field-rules.md)
4. **AI 字段**：新类型，走 `aiConfig`；`outputType` 映射到底层 `type`（text/singleSelect/multipleSelect/number/currency/attachment）

## 危险操作清单（再声明）

CLI 硬门（exit 3 unless `--yes`）：

**destroy**：`delete_base` / `delete_table` / `delete_field` / `delete_view` / `delete_records` / `delete_chart` / `delete_dashboard`
**schema-change**：`update_field`（改类型可能丢数据）
**visibility**：`update_chart_share` / `update_dashboard_share`（公开分享 = 间接数据泄露）

skill 层额外关注（不硬拦但必须确认）：
- `update_records` / `delete_records` 批量 > 10 条时强调规模
- `import_data` 大量导入前确认目标 table
