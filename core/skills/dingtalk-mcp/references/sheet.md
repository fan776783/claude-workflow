# 钉钉表格 MCP — 30 个工具速查

> **参数细节以 `dingtalk-mcp schema sheet.<tool>` 为准**。本文件是用途分组 + 关键入参提醒。

服务端：`https://mcp-gw.dingtalk.com/server/f48c05ca.../?key=...`

**这是 Excel-like 钉钉表格**（工作簿 / 工作表 / A1 单元格）。和钉钉 AI 表格（Airtable-like Base/Table）不同，参考决策：

| 用户说 | 走哪 |
| --- | --- |
| "在钉钉表格里…" / "在那张 xlsx 里…" / "A1:D10" / "合并单元格" / "筛选" / "冻结行" | **本 skill** `sheet <tool>` |
| "在 AI 表格里…" / "Base" / "多维表" / "记录 / 字段 / 视图 / 图表 / 仪表盘" | `aitable <tool>`（见 `aitable.md`） |

## 术语

- **nodeId / dentryUuid**：电子表格文档节点标识（32 位字母数字，或完整文档 URL）
- **sheetId**：工作表 ID（一个电子表格含多个工作表 / sheet tab）
- **rangeAddress**：A1 表示法，如 `A1` / `A1:D10` / `B:B`（整列）
- **dimension**：`ROWS` 或 `COLUMNS`
- **filterViewId**：筛选视图 ID（区别于工作表本身的 filter）

---

## 工作簿 / 工作表（5）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `create_workspace_sheet` | `name` | 建新的钉钉电子表格（整个 workbook） | - |
| `get_all_sheets` | `nodeId` | 列 workbook 下所有工作表 | - |
| `get_sheet` | `nodeId`, `sheetId` | 单个工作表详情 | - |
| `create_sheet` | `nodeId`, `name` | 在现有 workbook 里新建工作表 | - |
| `merge_cells` | `nodeId`, `sheetId`, `rangeAddress` | 合并单元格 | - |

## 区域读写（3）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_range` | `nodeId` | 读指定范围数据（值 / 公式 / 格式） | - |
| `update_range` | `nodeId`, `sheetId`, `rangeAddress` | **覆盖写**指定区域（NOT append） | **overwrite** |
| `append_rows` | `nodeId`, `sheetId`, `values` | 在工作表末尾追加若干行 | - |

## 查找 / 替换（2）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `find_cells` | `nodeId`, `sheetId`, `text` | 查匹配文本的单元格地址列表 | - |
| `replace_all` | `nodeId`, `sheetId`, `find`, `replacement` | **全局**查找替换；支持 `matchCase` / `matchEntireCell` / `useRegExp` / `range` 限定范围；返回被替换的单元格数 | **overwrite** |

## 筛选（sheet 级，单一）（6）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_filter` | `nodeId`, `sheetId` | 查工作表筛选信息 | - |
| `create_filter` | `nodeId`, `sheetId`, `range` | 在指定范围创建筛选 | - |
| `update_filter` | `nodeId`, `sheetId` | 改筛选范围 | - |
| `set_filter_criteria` | `nodeId`, `sheetId`, `column`, `filterCriteria` | 设置某列筛选条件 | - |
| `clear_filter_criteria` | `nodeId`, `sheetId`, `column` | 清某列筛选条件（不删筛选本身） | - |
| `sort_filter` | `nodeId`, `sheetId`, `field` | 按筛选范围排序 | - |
| `delete_filter` | `nodeId`, `sheetId` | 删工作表筛选 | **destroy** |

## 筛选视图（多个，独立命名）（6）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `get_filter_views` | `nodeId`, `sheetId` | 列筛选视图 | - |
| `create_filter_view` | `nodeId`, `sheetId` | 建筛选视图 | - |
| `update_filter_view` | `nodeId`, `sheetId`, `filterViewId` | 改筛选视图（名 / 范围） | - |
| `set_filter_view_criteria` | `nodeId`, `sheetId`, `filterViewId`, `column` | 设视图某列条件 | - |
| `clear_filter_view_criteria` | `nodeId`, `sheetId`, `filterViewId`, `column` | 清视图某列条件 | - |
| `delete_filter_view` | `nodeId`, `sheetId`, `filterViewId` | 删筛选视图 | **destroy** |

## 行列操作（5）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `add_dimension` | `nodeId`, `sheetId`, `dimension`, `length` | 末尾追加空行 / 空列 | - |
| `insert_dimension` | `nodeId`, `sheetId`, `dimension`, `position`, `length` | 指定位置插入空行 / 空列 | - |
| `update_dimension` | `nodeId`, `sheetId`, `dimension`, ... | 批量改行列属性（隐藏 `hidden` / 尺寸 `pixelSize`） | **schema-change** |
| `move_dimension` | `nodeId`, `sheetId`, `dimension`, `startIndex`, `endIndex`, `destinationIndex` | 移动行列；**destinationIndex 不能落在 `[startIndex, endIndex]`** | **overwrite** |
| `delete_dimension` | `nodeId`, `sheetId`, `dimension`, ... | 删指定位置起的若干连续行 / 列 | **destroy** |

## 合并 / 图片（2）

| 工具 | required | 说明 | 危险 |
| --- | --- | --- | --- |
| `unmerge_range` | `nodeId`, `sheetId`, `rangeAddress` | 取消合并；可能破坏下游引用 | **structure-change** |
| `write_image` | `nodeId`, `sheetId`, `rangeAddress`, `resourceId`, `resourceUrl` | 在单元格写入图片；覆盖原内容 | **overwrite** |

---

## 调用约束

1. **nodeId 解析**：同文档 MCP，支持链接 URL 或纯 32 位 dentryUuid
2. **sheetId 必须先拿**：`get_all_sheets --nodeId <x>` 后从返回里取；不要编造
3. **rangeAddress 用 A1 表示法**：`A1` / `A1:D10` / `B:B`（整列）/ `1:1`（整行）；合法性由服务端校验
4. **追加 vs 覆盖**：
   - 想追加新行 → `append_rows`（安全，不拦）
   - 想覆盖某区域 → `update_range`（**硬门**，必须 `--yes`）
5. **dimension 操作注意 0-based 索引**：`move_dimension` 的 `destinationIndex` 不能落在源范围内
6. **批量**：一次操作建议 ≤ 1000 单元格 / 100 行；过大拆分
7. **权限**：无编辑权限的工作表，写入类工具会 permission denied

## 危险操作清单（再声明）

CLI 硬门（exit 3 unless `--yes`）：

**destroy**：`delete_dimension` / `delete_filter` / `delete_filter_view`（前三者也被前缀 `delete_` 自动捕获）
**overwrite**：`update_range` / `replace_all` / `move_dimension` / `write_image`
**structure-change**：`unmerge_range`
**schema-change**：`update_dimension`

skill 层额外关注（不硬拦但必须确认）：
- `create_filter` 覆盖已存在的 filter（sheet 级 filter 只有一个）
- 大范围 `append_rows` / `find_cells` 之前先用 `get_sheet` 估一下行数
