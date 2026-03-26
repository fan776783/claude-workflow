# Acceptance & Implementation Brief 系统 (v4.0)

> Phase 0.6: 将 Requirement Baseline 转换为按模块组织的统一开发文档

## 概述

Brief 生成系统在 Requirement Baseline（Phase 0.55）之后自动执行，将结构化需求转换为按模块组织的统一文档，同时包含验收标准和实现路径。

> Brief 取代了原有的 Acceptance Checklist（Phase 0.6）和 Implementation Guide（Phase 0.7），消除两份文档间的冗余，提供一站式开发参考。

## 设计目标

1. **一站式参考**：开发者看完一个模块就知道"做什么、怎么验、怎么测、怎么做"
2. **细节不丢失**：通过 requirement ID 引用 Baseline，约束不重复展开但可追溯
3. **测试先行**：提供完整的 TDD 流程和代码模板
4. **技术栈适配**：根据项目配置生成对应测试框架的代码模板
5. **无冗余**：Coverage Summary、Quality Gates 等共享数据只写一份

## Brief 结构

Brief 按模块组织，每个模块包含完整的验收与实现信息：

### Module Brief 结构

```markdown
### [Module Name]（[Priority]）

**Related Requirement IDs**: R-001, R-003, R-007
**Constraints**: （从 Baseline 引用的硬约束列表）

#### Acceptance Criteria（怎么验）
- [ ] AC-M1.1: 描述验收条件
- [ ] AC-M1.2: 描述验收条件

#### Test Strategy（怎么测）
- Unit: 测试文件路径 + 测试用例描述
- Integration: 测试文件路径 + 测试用例描述
- E2E: 关键流程描述

#### Implementation Hints（怎么做）
- 复用建议
- 注意事项
```

### 全局部分

1. **Requirement Coverage Summary** — 唯一一份覆盖摘要
2. **Requirement-to-Brief Mapping** — requirement → module 映射
3. **TDD Workflow** — Red-Green-Refactor 循环说明
4. **Test Strategy** — L1 单元(70%) / L2 集成(20%) / L3 E2E(10%)
5. **Test Fixtures** — 测试数据工厂
6. **Quality Gates** — 自动化检查 + 性能指标 + 安全检查
7. **Coverage Gaps** — Partially/Uncovered Requirements
8. **Acceptance Pass Criteria** — Must/Should/Nice to Have
9. **Implementation Order** — P0 → P1 → P2

## 任务关联映射

### 映射策略

根据任务的以下属性自动匹配 Brief 模块：
- `requirement_ids`：任务关联的 requirement IDs → 匹配对应模块
- `file`：文件路径 → 匹配涉及该文件的模块
- `scenario`：业务场景 → 匹配同场景模块

### 映射输出

在 `tasks.md` 中，每个任务包含 `- **验收项**: AC-M1.1, AC-M2.3, ...` 字段，列出关联的验收项 ID。

## 验收通过标准

### 必须满足（Must Pass）

- 所有 P0 功能的验收标准通过
- 所有质量门禁检查通过
- 所有 `in_scope` 且 `full` coverage 的 requirement 对应验收项通过
- 所有关键约束相关验收项通过
- 关键功能流程验证通过

### 建议满足（Should Pass）

- 所有 P1 功能的验收标准通过
- 所有 `partial` requirement 的剩余缺口有明确记录

## 技术栈适配

### 技术栈检测

从 `project-config.json` 读取技术栈信息：

```typescript
interface TechStack {
  backend: string;           // Django, FastAPI, Express, etc.
  frontend: string;          // React, Vue, Angular, etc.
  testBackend: string;       // pytest, jest, vitest, etc.
  testFrontend: string;      // vitest, jest, testing-library, etc.
}
```

### 测试框架映射

| 后端框架 | 默认测试框架 | 测试文件扩展名 |
|----------|--------------|----------------|
| Django | pytest | `.py` |
| FastAPI | pytest | `.py` |
| Express | jest | `.test.js` |
| NestJS | jest | `.spec.ts` |

| 前端框架 | 默认测试框架 | 测试文件扩展名 |
|----------|--------------|----------------|
| React | vitest | `.test.tsx` |
| Vue | vitest | `.spec.ts` |
| Angular | jasmine | `.spec.ts` |

### 代码模板适配

根据测试框架生成对应的代码模板（pytest / vitest / jest 等）。

## 模板变量契约

Brief 模板通过 `replaceVars(template, vars)` 渲染，变量必须在渲染前全部准备完成。

### 核心变量

- 标识与路径：`task_name`、`sanitized_name`、`requirement_source`、`created_at`、`requirement_baseline_path`、`tech_design_path`
- 技术栈：`project_type`、`backend_framework`、`frontend_framework`、`backend_test_framework`、`frontend_test_framework`、`file_extension`
- 覆盖率：`requirement_coverage_summary`、`requirement_total_count`、`requirement_in_scope_count`、`requirement_full_coverage_count`、`requirement_partial_coverage_count`、`requirement_none_coverage_count`
- 映射：`requirement_to_brief_mapping`、`partially_covered_requirements`、`uncovered_requirements`
- 模块：`module_briefs`、`module_count`、`p0_count`、`p1_count`、`p2_count`
- 测试：`test_command`、`factory_code`、`factory_usage_example`
- 质量：`automated_checks`、`performance_metrics`、`security_checks`
- 命令：`install_command`、`setup_test_env_command`、`test_all_command`、`test_unit_command`、`test_integration_command`、`test_e2e_command`、`test_watch_command`、`quality_gate_command`、`coverage_command`、`performance_check_command`
- 顺序：`p0_implementation_order`、`p1_implementation_order`、`p2_implementation_order`

### 生成约束

- 所有变量必须先转换成 Markdown 字符串，再写入模板
- 命令类变量必须来自项目配置推导，不能写死
- 若模板新增变量，必须同时更新 `phase-0.6-brief.md` 中的渲染映射

## 防绕过机制

### 合理化借口表

| 借口 | 为什么不能接受 | 正确做法 |
|------|----------------|----------|
| "手动测试过了" | 手动测试不可重复，无法作为证据 | 运行自动化测试或录制操作步骤 |
| "这个场景不会发生" | 边界场景往往在生产环境才暴露 | 按 Brief 逐项验证，不做假设 |
| "和之前的实现一样" | 上下文不同，行为可能不同 | 在当前上下文中重新验证 |
| "时间不够，先跳过" | 跳过验证的技术债比重写更贵 | 至少完成 Must Pass 项 |
| "测试框架有问题" | 工具问题不是跳过验证的理由 | 修复工具或使用替代验证方式 |
| "改动太小不需要测试" | 小改动也可能引入回归 | 运行相关测试确认无副作用 |

### 红旗清单

- 任务标记为 completed 但没有运行任何验证命令
- 验收项被标记为通过但没有对应的测试输出
- 使用"应该"、"大概"、"看起来"等模糊措辞描述验证结果
- 只验证了正常路径，跳过了所有边界场景
- 引用其他任务的验证结果作为当前任务的证据
- 验证命令的输出没有被读取就声称通过

## 文件位置

- **规格文件**：`templates/skills/workflow/specs/start/phase-0.6-brief.md`
- **模板文件**：`templates/skills/workflow/templates/brief-template.md`
- **生成位置**：`.claude/acceptance/{sanitizedName}-brief.md`
- **关联文件**：
  - Baseline：`.claude/analysis/{sanitizedName}-requirement-baseline.md`
  - 技术设计：`.claude/tech-design/{sanitizedName}.md`
  - Spec：`.claude/specs/{sanitizedName}.md`
  - Plan：`.claude/plans/{sanitizedName}.md`
  - 任务清单：`~/.claude/workflows/{projectId}/tasks-{sanitizedName}.md`

## 相关文档

- [phase-0.6-brief.md](../specs/start/phase-0.6-brief.md) - Phase 0.6 实现细节
- [start-overview.md](./start-overview.md) - workflow start 流程概览
- [execute-overview.md](./execute-overview.md) - 任务执行时如何使用验收项
- [shared-utils.md](./shared-utils.md) - 共享工具函数
