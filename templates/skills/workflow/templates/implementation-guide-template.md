---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
requirement_baseline: "{{requirement_baseline_path}}"
acceptance_checklist: "{{acceptance_checklist_path}}"
project_type: "{{project_type}}"
tech_stack:
  backend: "{{backend_framework}}"
  frontend: "{{frontend_framework}}"
  test_backend: "{{backend_test_framework}}"
  test_frontend: "{{frontend_test_framework}}"
---

# 实现指南: {{task_name}}

> 本指南基于 Requirement Baseline 与验收清单自动生成，提供测试先行的实现路径

## 📋 指南概览

- **测试策略**: 单元测试 70% + 集成测试 20% + E2E 测试 10%
- **模块数量**: {{module_count}}
- **P0 功能**: {{p0_count}}
- **P1 功能**: {{p1_count}}
- **P2 功能**: {{p2_count}}

---

## 1. Requirement Coverage Summary

{{requirement_coverage_summary}}

### 1.1 Requirement → Module Mapping

{{requirement_to_module_mapping}}

---

## 2. TDD 工作流

### Red-Green-Refactor 循环

对于每个功能模块，遵循以下循环：

#### 🔴 Red（写失败的测试）

1. **创建测试文件**
   - 根据模块实现指引确定测试文件路径
   - 使用测试代码模板快速搭建测试结构
   - 先核对模块的 `Related Requirement IDs`

2. **编写测试用例**
   - 从验收清单提取验证项
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
   - 优先守住 `criticalConstraints`

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

**测试范围**:
- 业务逻辑：数据验证、权限检查、数据转换
- 数据模型：Schema 验证、模型方法
- 工具函数：格式化、计算、转换

**测试框架**:
- 后端: {{backend_test_framework}}
- 前端: {{frontend_test_framework}}

### L2: 集成测试（20%）

**测试范围**:
- API 端点：请求/响应验证
- 数据库操作：CRUD、事务、级联
- 服务层：跨模块交互

### L3: E2E 测试（10%）

**测试范围**:
- 关键用户流程
- 端到端场景验证

---

## 4. 测试代码模板

### 4.1 单元测试模板

{{unit_test_templates}}

### 4.2 集成测试模板

{{integration_test_templates}}

### 4.3 E2E 测试模板

{{e2e_test_templates}}

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

## 6. 模块实现指引

{{module_guides}}

### 模块指引格式要求

每个模块必须至少包含：

- **Module Name**
- **Related Requirement IDs**
- **Related Acceptance IDs**
- **Critical Constraints by Module**
- **Implementation Hints**
- **Test Steps**

---

## 7. 质量门禁

### 自动化检查

{{automated_checks}}

### 性能指标

{{performance_metrics}}

### 安全检查

{{security_checks}}

---

## 8. 快速开始

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

## 9. 实现顺序建议

### 阶段 1: P0 功能（必须完成）

{{p0_implementation_order}}

### 阶段 2: P1 功能（重要功能）

{{p1_implementation_order}}

### 阶段 3: P2 功能（优化功能）

{{p2_implementation_order}}

---

## 10. 相关文档

- [Requirement Baseline](../analysis/{{sanitized_name}}-requirement-baseline.md) - 需求基线
- [验收清单](./{{sanitized_name}}-checklist.md) - 用户验收视图
- [技术方案](../tech-design/{{sanitized_name}}.md) - 架构设计
