# {{spec_name}}

> {{one_line_description}}
>
> **Layer**: frontend | backend
> **Last Updated**: {{date}}

## 1. Scope / Trigger

- Trigger: {{why_this_needs_code_spec_depth}}
- Applies to: {{files_or_directories}}

## 2. Signatures

- {{signature_list_with_types}}

```{{lang}}
// 代表性签名
{{signature_example}}
```

## 3. Contracts

### Request / Input

| 字段 | 类型 | 约束 |
|------|------|------|
| {{field}} | {{type}} | {{constraints}} |

### Response / Output

| 字段 | 类型 | 约束 |
|------|------|------|
| {{field}} | {{type}} | {{constraints}} |

### Environment / Config

| Key | Required | 说明 |
|-----|----------|------|
| {{key}} | yes/no | {{description}} |

## 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| {{condition}} | {{result_or_error}} |

## 5. Good / Base / Bad Cases

- **Good**：{{description}}
- **Base**：{{description}}
- **Bad**：{{description}}

```{{lang}}
// Good
{{good_example}}
```

```{{lang}}
// Base
{{base_example}}
```

```{{lang}}
// Bad
{{bad_example}}
```

## 6. Tests Required

| 测试 | 断言点 |
|------|--------|
| {{test_name}} | {{assertion}} |

## 7. Wrong vs Correct

### Wrong

```{{lang}}
{{wrong_example}}
```

**Why it's wrong**：{{reason}}

### Correct

```{{lang}}
{{correct_example}}
```

---

## Machine-checkable Rules

> 机读规则由 `/knowledge-check` 在 review 阶段强制校验。每条规则写成独立代码块，语法如下：
>
> ```yaml
> # forbid：diff 命中该 pattern → blocking
> # require：新增或修改的文件必须包含该 pattern → blocking
> # warn：命中作为 warning，不阻塞
> id: {{rule_id}}
> severity: blocking | warning
> kind: forbid | require | warn
> pattern: "{{regex}}"
> applies_to: "**/*.ts"   # glob，可选，默认所有变更文件
> message: "{{human_readable_reason}}"
> ```
>
> 无 `## Machine-checkable Rules` 小节的文件仅作为 advisory 注入，不参与硬卡口。

```yaml
# 示例
id: forbid-any-type
severity: blocking
kind: forbid
pattern: ":\\s*any\\b"
applies_to: "**/*.{ts,tsx}"
message: "禁止使用 any 类型，请使用具体类型或 unknown"
```
