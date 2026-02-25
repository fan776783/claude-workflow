---
version: 1
requirement_source: "{source}"
created_at: "{timestamp}"
acceptance_checklist: ".claude/acceptance/{name}-checklist.md"
project_type: "{type}"
tech_stack:
  backend: "{backend_framework}"
  frontend: "{frontend_framework}"
  test_backend: "{backend_test_framework}"
  test_frontend: "{frontend_test_framework}"
---

# 实现指南: {TaskName}

> 本指南基于需求结构化提取自动生成，提供测试先行的实现路径

## 📋 指南概览

- **测试策略**: 单元测试 70% + 集成测试 20% + E2E 测试 10%
- **模块数量**: {module_count}
- **P0 功能**: {p0_count}
- **P1 功能**: {p1_count}
- **P2 功能**: {p2_count}

---

## 1. TDD 工作流

### Red-Green-Refactor 循环

对于每个功能模块，遵循以下循环：

#### 🔴 Red（写失败的测试）

1. **创建测试文件**
   - 根据模块实现指引确定测试文件路径
   - 使用测试代码模板快速搭建测试结构

2. **编写测试用例**
   - 从验收清单提取验证项
   - 使用测试数据工厂生成测试数据
   - 编写断言语句（预期失败）

3. **运行测试，确认失败**
   ```bash
   {test_command}
   ```
   - 确保测试因为"功能未实现"而失败
   - 不是因为测试代码错误而失败

#### 🟢 Green（实现最小可用代码）

1. **实现功能代码**
   - 只写让测试通过的最小代码
   - 不追求完美，不过度设计

2. **让测试通过**
   ```bash
   {test_command}
   ```
   - 所有测试变绿

3. **验证功能**
   - 手动验证关键路径
   - 确保符合验收标准

#### 🔵 Refactor（重构优化）

1. **提取公共逻辑**
   - 识别重复代码
   - 提取为函数或类

2. **优化性能**
   - 优化算法复杂度
   - 减少不必要的计算

3. **保持测试通过**
   ```bash
   {test_command}
   ```
   - 重构过程中持续运行测试
   - 确保功能不被破坏

---

## 2. 测试分层策略

### L1: 单元测试（70%）

**测试范围**:
- 业务逻辑：数据验证、权限检查、数据转换
- 数据模型：Schema 验证、模型方法
- 工具函数：格式化、计算、转换

**测试框架**:
- 后端: {backend_test_framework}
- 前端: {frontend_test_framework}

**测试原则**:
- 快速执行（< 100ms/测试）
- 无外部依赖（数据库、API、文件系统）
- 使用 Mock/Stub 隔离依赖

### L2: 集成测试（20%）

**测试范围**:
- API 端点：请求/响应验证
- 数据库操作：CRUD、事务、级联
- 服务层：跨模块交互

**测试原则**:
- 使用测试数据库
- 每个测试独立（setup/teardown）
- 验证真实交互

### L3: E2E 测试（10%）

**测试范围**:
- 关键用户流程
- 端到端场景验证

**测试原则**:
- 只测试关键路径
- 使用真实环境
- 可以较慢（< 10s/测试）

---

## 3. 测试代码模板

### 3.1 单元测试模板

{unit_test_templates}

### 3.2 集成测试模板

{integration_test_templates}

### 3.3 E2E 测试模板

{e2e_test_templates}

---

## 4. 测试数据工厂

### 4.1 工厂位置

**推荐路径**:
- 后端: `tests/fixtures/factories.{ext}`
- 前端: `src/test/fixtures.{ext}` 或 `tests/fixtures.{ext}`

### 4.2 工厂代码

{factory_code}

### 4.3 使用示例

```
{factory_usage_example}
```

---

## 5. 模块实现指引

{module_guides}

---

## 6. 质量门禁

### 自动化检查

{automated_checks}

### 性能指标

{performance_metrics}

### 安全检查

{security_checks}

---

## 7. 快速开始

### 环境准备

```bash
# 安装依赖
{install_command}

# 配置测试环境
{setup_test_env_command}
```

### 运行测试

```bash
# 运行所有测试
{test_all_command}

# 运行单元测试
{test_unit_command}

# 运行集成测试
{test_integration_command}

# 运行 E2E 测试
{test_e2e_command}

# 监听模式（开发时使用）
{test_watch_command}
```

### 查看覆盖率

```bash
# 生成覆盖率报告
{coverage_command}

# 查看覆盖率报告
{coverage_view_command}
```

### 执行质量门禁

```bash
# 运行所有质量检查
{quality_gate_command}
```

---

## 8. 实现顺序建议

### 阶段 1: P0 功能（必须完成）

按以下顺序实现 P0 功能：

{p0_implementation_order}

### 阶段 2: P1 功能（重要功能）

{p1_implementation_order}

### 阶段 3: P2 功能（优化功能）

{p2_implementation_order}

---

## 9. 常见问题

### Q1: 测试数据工厂如何使用？

A: 在测试中导入工厂方法，直接调用生成测试数据：

```
{factory_usage_faq}
```

### Q2: 如何 Mock 外部依赖？

A: 根据测试框架使用对应的 Mock 工具：

```
{mock_usage_faq}
```

### Q3: 集成测试如何隔离数据？

A: 使用测试数据库和事务回滚：

```
{integration_test_isolation_faq}
```

### Q4: 如何调试失败的测试？

A: 使用测试框架的调试功能：

```
{test_debug_faq}
```

---

## 10. 相关文档

- [验收清单](./{name}-checklist.md) - 功能验收标准
- [技术方案](../tech-design/{name}.md) - 架构设计
- [任务清单](~/.claude/workflows/{projectId}/tasks-{name}.md) - 任务拆分
- [项目配置](../../project-config.json) - 项目技术栈配置
