# Requirement Baseline

- Source: inline
- Total Requirements: 5

## Requirement Items

| ID | Type | Scope | Must Preserve | Summary |
|----|------|-------|---------------|---------|
| R-001 | functional | in_scope | no | - 用户可使用用户名密码登录 |
| R-002 | edge_case | in_scope | no | - 登录失败时显示明确错误提示 |
| R-003 | logic | in_scope | no | - 支持记住登录状态 |
| R-004 | functional | in_scope | no | - 不影响现有注册流程 |
| R-005 | edge_case | in_scope | yes | - 无权限和空状态需要有边界处理 |

## Critical Constraints

- R-005: - 无权限和空状态需要有边界处理

