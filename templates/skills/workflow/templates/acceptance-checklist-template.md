---
version: 1
requirement_source: "{{requirement_source}}"
created_at: "{{created_at}}"
requirement_baseline: "{{requirement_baseline_path}}"
implementation_guide: "{{implementation_guide_path}}"
tech_design: "{{tech_design_path}}"
---

# 验收清单: {{task_name}}

> 本清单是 Requirement Baseline 的验收派生视图，用于验证功能交付质量，测试方法参考 [实现指南](./{{sanitized_name}}-implementation-guide.md)

## 📋 清单概览

- **总验收项**: {{total_count}}
- **P0 验收项**: {{p0_count}} - 必须通过
- **P1 验收项**: {{p1_count}} - 重要功能
- **P2 验收项**: {{p2_count}} - 优化功能

---

## 1. Requirement Coverage Summary

{{requirement_coverage_summary}}

### 1.1 Requirement Coverage Metrics

| 指标 | 数量 |
|------|------|
| 总 Requirement 数 | {{requirement_total_count}} |
| In Scope Requirement 数 | {{requirement_in_scope_count}} |
| Full Coverage | {{requirement_full_coverage_count}} |
| Partial Coverage | {{requirement_partial_coverage_count}} |
| No Coverage | {{requirement_none_coverage_count}} |

### 1.2 Requirement-to-Acceptance Mapping

{{requirement_to_acceptance_mapping}}

---

## 2. 质量门禁

### 自动化检查

- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 关键 E2E 测试通过
- [ ] 类型检查通过（0 errors）
- [ ] Linter 无 error

**验证方法**: 参考 [实现指南 - 质量门禁](./{{sanitized_name}}-implementation-guide.md#7-质量门禁)

### 性能指标

- [ ] Lighthouse 性能分 ≥ 90
- [ ] 首屏加载时间 < 2s
- [ ] API 响应时间 < 500ms
- [ ] 页面交互响应 < 100ms

### 安全检查

- [ ] 无 SQL 注入风险
- [ ] 无 XSS 风险
- [ ] 无 CSRF 风险
- [ ] 权限验证完整
- [ ] 敏感数据加密

---

## 3. 功能验收项

### 3.1 表单字段验证

{{form_validation_items}}

### 3.2 角色权限验证

{{permission_validation_items}}

### 3.3 交互行为验证

{{interaction_validation_items}}

### 3.4 业务规则验证

{{business_rule_validation_items}}

### 3.5 边界场景验证

{{edge_case_validation_items}}

### 3.6 UI 展示验证

{{ui_display_validation_items}}

### 3.7 功能流程验证

{{functional_flow_validation_items}}

---

## 4. Partially Covered Requirements

{{partially_covered_requirements}}

---

## 5. Uncovered Requirements

{{uncovered_requirements}}

---

## 6. 验收通过标准

### 必须满足（Must Pass）

以下验收项必须全部通过，否则不能交付：

- 所有 P0 验收项通过
- 所有质量门禁检查通过
- 所有 `in_scope` 且标记为 `full` 的 requirement 对应验收项通过
- 所有关键约束相关验收项通过
- 所有角色权限验证通过
- 所有业务规则验证通过
- 关键功能流程验证通过

### 建议满足（Should Pass）

以下验收项建议通过，可根据优先级调整：

- 所有 P1 验收项通过
- 所有交互行为验证通过
- 所有边界场景验证通过
- 所有 UI 展示规则验证通过
- 所有 `partial` requirement 的剩余缺口有明确记录

### 可选满足（Nice to Have）

以下验收项为优化项，可后续迭代：

- 所有 P2 验收项通过
- 性能优化项
- 用户体验优化项

---

## 7. 验收流程

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

1. **按模块验收**
   - 参考 [实现指南 - 模块实现指引](./{{sanitized_name}}-implementation-guide.md#6-模块实现指引)
   - 逐项验证功能验收项
   - 必须同步核对 requirement IDs 是否覆盖完成

2. **记录验收结果**
   - 在下方"验收记录"表格中记录
   - 标注通过/失败状态
   - 记录问题和备注

### 阶段 3: 交付确认

1. **确认必须满足项全部通过**
2. **确认建议满足项达到预期比例**
3. **整理遗留问题清单**
4. **提交验收报告**

---

## 8. 验收记录

### 8.1 质量门禁验收

| 检查项 | 验收人 | 验收时间 | 状态 | 备注 |
|--------|--------|----------|------|------|
| 单元测试覆盖率 | - | - | - | - |
| 单元测试通过 | - | - | - | - |
| 集成测试通过 | - | - | - | - |
| E2E 测试通过 | - | - | - | - |
| 类型检查 | - | - | - | - |
| Linter 检查 | - | - | - | - |
| 性能指标 | - | - | - | - |
| 安全检查 | - | - | - | - |

### 8.2 功能验收记录

| 验收项 ID | Related Requirement IDs | 优先级 | 验收人 | 验收时间 | 状态 | 备注 |
|-----------|-------------------------|--------|--------|----------|------|------|
| - | - | - | - | - | - | - |

---

## 9. 相关文档

- [Requirement Baseline](../analysis/{{sanitized_name}}-requirement-baseline.md) - 需求基线
- [实现指南](./{{sanitized_name}}-implementation-guide.md) - 测试先行实现路径
- [技术方案](../tech-design/{{sanitized_name}}.md) - 架构设计
- [任务清单]({{tasks_file_path}}) - 任务拆分
