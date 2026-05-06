# AI 表格字段类型 `config` 规则

> 建字段（`create_fields` / `create_table`）和改字段（`update_field`）时，每种字段类型的 `config` 结构不同。本文件抄自服务端 `create_fields` inputSchema 的 `type` 描述，**权威版用 `dingtalk-mcp schema aitable.create_fields` 现读**。

括号内为 `config` 键，`*` 表示必填，无括号表示无需 `config`。

## 基础类型

- `text` — 文本
- `number` — 数字 (`formatter`)
- `singleSelect` — 单选 (`options*`)
- `multipleSelect` — 多选 (`options*`)
- `date` — 日期 (`formatter`)
- `currency` — 货币 (`currencyType`, `formatter`)
- `checkbox` — 勾选
- `rating` — 评分 (`min`, `max`, `icon`)
- `progress` — 进度 (`formatter`, `customizeRange`, `min`, `max`)
- `richText` — 富文本
- `url` — 链接
- `telephone` — 电话
- `email` — 邮件
- `idCard` — 身份证
- `barcode` — 条码
- `geolocation` — 地理位置
- `address` — 行政区域
- `attachment` — 附件

## 关系类型

- `user` — 人员 (`multiple`)
- `department` — 部门 (`multiple`)
- `group` — 群组 (`multiple`)

## 关联 / 引用（都是只读，不能通过 `create_records` / `update_records` 写值）

- `formula` — 公式
- `filterUp` — 查找引用 (`targetSheet*`, `filters*`, `valuesField*`, `aggregator*`)
  - 创建新表时 `filters` 只能用 `value`（字段对常量）
  - 在已有表加字段时可用 `currentSheetFieldId`（字段对字段）
  - `filters.link` 必须统一（全 AND 或全 OR）
- `lookup` — 关联引用 (`associateField*`, `valuesField*`, `aggregator*`)
- `unidirectionalLink` — 单向关联 (`linkedTableId*`, `multiple`)
- `bidirectionalLink` — 双向关联 (`linkedTableId*`, `multiple`)

## 特殊

- `primaryDoc` — 文档（**仅限第一列**，对应 `get_base_primary_doc_id` 拿到的 doc）

## 系统字段（创建时无须指定，自动生成）

- `creator` — 创建人
- `lastModifier` — 最后编辑人
- `createdTime` — 创建时间
- `lastModifiedTime` — 最后编辑时间

## AI 字段

AI 字段不是独立 type，**仍用上述基础类型落库**，只在 `aiConfig` 声明 AI 配置。`type` 与 `aiConfig.outputType` 必须配套：

| `aiConfig.outputType` | 对应 `type` |
| --- | --- |
| `text` | `text` |
| `select` | `singleSelect` |
| `multiSelect` | `multipleSelect` |
| `number` | `number` |
| `currency` | `currency` |
| `image` / `video` | `attachment` |

---

## 常见 `config` 示例

### singleSelect / multipleSelect（必填 options）

```json
{
  "fieldName": "优先级",
  "type": "singleSelect",
  "config": {
    "options": [
      { "name": "高", "color": "red" },
      { "name": "中", "color": "yellow" },
      { "name": "低", "color": "green" }
    ]
  }
}
```

### date（formatter 指定显示格式）

```json
{
  "fieldName": "截止时间",
  "type": "date",
  "config": { "formatter": "YYYY-MM-DD HH:mm" }
}
```

### currency

```json
{
  "fieldName": "预算",
  "type": "currency",
  "config": { "currencyType": "CNY", "formatter": "0.00" }
}
```

### user（multiple 控制单选 / 多选）

```json
{ "fieldName": "负责人", "type": "user", "config": { "multiple": false } }
```

### lookup（关联引用）

关联字段必须先存在（先有 `unidirectionalLink` / `bidirectionalLink` 字段再加 `lookup`）：

```json
{
  "fieldName": "所属项目名",
  "type": "lookup",
  "config": {
    "associateField": "<link-field-id>",
    "valuesField": "<target-table-field-id>",
    "aggregator": "first"
  }
}
```

### formula

```json
{
  "fieldName": "总额",
  "type": "formula",
  "config": { "expression": "{单价} * {数量}" }
}
```

---

## 避坑

1. **改类型会丢数据**：`update_field` 把 `text` 改成 `number` → 非数字字符串全部清空。危险等级 `schema-change`，CLI 硬门拦截
2. **options 不能删除在用的项**：`singleSelect.options` 删一个选项，使用该选项的记录会被置空
3. **只读字段**：`lookup` / `filterUp` / `formula` / `creator` / `lastModifier` / `createdTime` / `lastModifiedTime` 不能通过 `create_records` / `update_records` 写值
4. **primaryDoc 唯一**：一张 Table 只能有一个 `primaryDoc` 字段，且必须是第一列
