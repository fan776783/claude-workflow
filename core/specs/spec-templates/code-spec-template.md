# {{spec_name}}

> {{one_line_description}}
>
> **Package / Layer**: {{package}} / {{layer}}
> **Last Updated**: {{date}}

<!--
本模板（7 段 contract）**仅用于 API / DB / 字段级契约类规范**。

判断规则：
- 要写"请求/响应字段清单 + 错误码矩阵 + 测试断言点"？→ 用本模板（7 段）
- 要写"代码风格 / 目录约定 / 命名规则 / 常见错误"？→ 改用 convention-template.md（更轻量）

对齐 Trellis：Trellis 实战里大部分 topic 文件走 convention 风格，只有少数涉及严格字段契约时才接近本模板。
详见 /Users/ws/dev/Trellis/.trellis/spec/cli/backend/error-handling.md（convention 风格范例）。
-->

> **必填字段说明**
> 本 spec 的 7 段都必须有具体内容。占位符需被真实的文件路径 / 命令名 / API 名 / 字段名 / 测试名替换。
> 段落为空或只有抽象描述属于未完成状态，`/spec-review` 会在 7 段 lint 中列出。

## 1. Scope / Trigger

- **Trigger**（什么样的变更触发本 spec）: {{describe_change_scenario}}
- **Applies to**（具体文件 / 目录 glob）: `{{file_path_or_glob}}`

## 2. Signatures

**必填**：具体文件路径 + 命令名 / API 名 / 数据库表名，不要写成抽象描述。

- File: `{{path/to/file.ext}}`
- Name: `{{command_or_api_or_table_name}}`

```{{lang}}
{{signature_code}}
```

## 3. Contracts

**必填**：字段级清单（字段名 + 类型 + 必需性），不要写 "返回 JSON" 之类笼统描述。

### Request / Input

| 字段 | 类型 | 必需 | 约束 |
|------|------|------|------|
| `{{field_name}}` | `{{type}}` | yes/no | {{constraints}} |

### Response / Output

| 字段 | 类型 | 必需 | 约束 |
|------|------|------|------|
| `{{field_name}}` | `{{type}}` | yes/no | {{constraints}} |

### Environment / Config

| Key | 必需 | 说明 |
|-----|------|------|
| `{{ENV_VAR_NAME}}` | yes/no | {{description}} |

## 4. Validation & Error Matrix

| 输入条件 | 错误码 / 行为 | 错误消息 |
|---------|-------------|---------|
| `{{condition}}` | `{{error_code_or_action}}` | `{{message}}` |

## 5. Good / Base / Bad Cases

### Good（正确路径）

**场景**：{{scenario_description}}

```{{lang}}
{{good_example_code}}
```

### Base（边界情况）

**场景**：{{scenario_description}}

```{{lang}}
{{base_example_code}}
```

### Bad（错误输入）

**场景**：{{scenario_description}}

```{{lang}}
{{bad_example_code}}
```

## 6. Tests Required

**必填**：具体到测试文件 + 测试名 + 断言内容。

| 测试文件 | 测试名 | 断言点 |
|---------|-------|-------|
| `{{tests/path/to/test.ext}}` | `{{test_name}}` | {{assertion_description}} |

## 7. Wrong vs Correct

至少一对 bad → good 对比。

### Wrong

```{{lang}}
{{wrong_example}}
```

**Why it's wrong**：{{reason}}

### Correct

```{{lang}}
{{correct_example}}
```

**Why it's correct**：{{reason}}
