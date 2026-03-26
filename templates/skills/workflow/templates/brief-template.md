---
version: 2
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
requirement_baseline: "{{requirement_baseline_path}}"
tech_design: "{{tech_design_path}}"
project_type: "{{project_type}}"
tech_stack:
  backend: "{{backend_framework}}"
  frontend: "{{frontend_framework}}"
  test_backend: "{{backend_test_framework}}"
  test_frontend: "{{frontend_test_framework}}"
status: draft
role: brief
---

# Acceptance & Implementation Brief: {{task_name}}

> 本文档基于 Requirement Baseline 自动生成，按模块组织验收标准与实现路径

## 📋 Brief 概览

- **模块数量**: {{module_count}}
- **P0 功能**: {{p0_count}} - 必须完成
- **P1 功能**: {{p1_count}} - 重要功能
- **P2 功能**: {{p2_count}} - 优化功能
- **测试策略**: 单元测试 70% + 集成测试 20% + E2E 测试 10%

---

## 1. Requirement Coverage Summary

{{requirement_coverage_summary}}

### 1.1 Coverage Metrics

| 指标 | 数量 |
|------|------|
| 总 Requirement 数 | {{requirement_total_count}} |
| In Scope Requirement 数 | {{requirement_in_scope_count}} |
| Full Coverage | {{requirement_full_coverage_count}} |
| Partial Coverage | {{requirement_partial_coverage_count}} |
| No Coverage | {{requirement_none_coverage_count}} |

### 1.2 Requirement-to-Brief Mapping

{{requirement_to_brief_mapping}}

---

## 2. TDD Workflow

### Red-Green-Refactor 循环

对于每个功能模块，遵循以下循环：

#### 🔴 Red（写失败的测试）

1. **创建测试文件**
   - 根据模块 brief 确定测试文件路径
   - 使用测试代码模板快速搭建测试结构
   - 先核对模块的 `Related Requirement IDs`

2. **编写测试用例**
   - 从模块验收标准提取验证项
   - 使用测试数据工厂生成测试数据
   - 编写断言语句（预期失败）
   - 确保每个测试能回指 requirement IDs

3. **运行测试，确认失败**
   ```bash
   {{test_command}}
   ```

#### 🟢 Green（实现最小可用代码）

1. **实现功能代码**
   - 只写让测试通过的最小代码
   - 优先守住 `constraints`

2. **让测试通过**
   ```bash
   {{test_command}}
   ```

3. **验证功能**
   - 手动验证关键路径
   - 确保符合验收标准与关键约束

#### 🔵 Refactor（重构优化）

1. **提取公共逻辑**
2. **优化性能**
3. **保持测试通过**
   ```bash
   {{test_command}}
   ```

---

## 3. 测试分层策略

### L1: 单元测试（70%）

**测试范围**: 业务逻辑、数据验证、权限检查、数据转换、工具函数

**测试框架**:
- 后端: {{backend_test_framework}}
- 前端: {{frontend_test_framework}}

### L2: 集成测试（20%）

**测试范围**: API 端点、数据库操作、服务层、跨模块交互

### L3: E2E 测试（10%）

**测试范围**: 关键用户流程、端到端场景验证

---

## 4. Module Briefs

{{module_briefs}}

### 模块 Brief 格式

每个模块包含：

- **Module Name**
- **Related Requirement IDs** — 从 Baseline 引用
- **Constraints** — 从 Baseline 引用的硬约束
- **Acceptance Criteria** — 怎么验（验收用例）
- **Test Templates** — 怎么测（测试代码模板）
- **Implementation Hints** — 怎么做（实现建议）
- **Priority** — P0/P1/P2

---

## 5. 测试数据工厂

### 5.1 工厂位置

- 后端: `tests/fixtures/factories.{{file_extension}}`
- 前端: `src/test/fixtures.{{file_extension}}` 或 `tests/fixtures.{{file_extension}}`

### 5.2 工厂代码

{{factory_code}}

### 5.3 使用示例

```
{{factory_usage_example}}
```

---

## 6. 质量门禁

### 自动化检查

{{automated_checks}}

### 性能指标

{{performance_metrics}}

### 安全检查

{{security_checks}}

---

## 7. Partially Covered Requirements

{{partially_covered_requirements}}

---

## 8. Uncovered Requirements

{{uncovered_requirements}}

---

## 9. 验收通过标准

### 必须满足（Must Pass）

- 所有 P0 功能的验收标准通过
- 所有质量门禁检查通过
- 所有 `in_scope` 且 `full` coverage 的 requirement 对应验收项通过
- 所有关键约束相关验收项通过
- 关键功能流程验证通过

### 建议满足（Should Pass）

- 所有 P1 功能的验收标准通过
- 所有 `partial` requirement 的剩余缺口有明确记录

### 可选满足（Nice to Have）

- 所有 P2 功能的验收标准通过
- 性能优化项
- 用户体验优化项

---

## 10. 快速开始

### 环境准备

```bash
# 安装依赖
{{install_command}}

# 配置测试环境
{{setup_test_env_command}}
```

### 运行测试

```bash
# 运行所有测试
{{test_all_command}}

# 运行单元测试
{{test_unit_command}}

# 运行集成测试
{{test_integration_command}}

# 运行 E2E 测试
{{test_e2e_command}}

# 监听模式（开发时使用）
{{test_watch_command}}
```

---

## 11. 实现顺序建议

### 阶段 1: P0 功能（必须完成）

{{p0_implementation_order}}

### 阶段 2: P1 功能（重要功能）

{{p1_implementation_order}}

### 阶段 3: P2 功能（优化功能）

{{p2_implementation_order}}

---

## 12. 验收流程

### 阶段 1: 自动化验证

1. **运行质量门禁**
   ```bash
   {{quality_gate_command}}
   ```

2. **检查测试覆盖率**
   ```bash
   {{coverage_command}}
   ```

3. **验证性能指标**
   ```bash
   {{performance_check_command}}
   ```

### 阶段 2: 功能验收

1. **按模块验收** — 逐模块核对验收标准
2. **核对 requirement IDs 覆盖**
3. **记录验收结果**

### 阶段 3: 交付确认

1. 确认 Must Pass 项全部通过
2. 确认 Should Pass 项达到预期比例
3. 整理遗留问题清单

---

## 13. 相关文档

- [Requirement Baseline](../analysis/{{sanitized_name}}-requirement-baseline.md) - 需求基线
- [技术方案](../tech-design/{{sanitized_name}}.md) - 架构设计
- [设计规范](../specs/{{sanitized_name}}.md) - Spec
