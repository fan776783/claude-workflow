# Workflow Brief / 验收映射 - 快速参考

## 一句话总结

**当前 workflow 不再单独生成“验收清单”，而是把验收标准、测试模板与实现提示统一收敛到 `brief.md`，确保实现过程中不遗漏 requirement coverage 与验证要求。**

## 核心功能

```
PRD 文档 → Requirement Baseline → Brief 模块聚类 → Acceptance Criteria / Test Strategy / Implementation Hints → 任务关联 → 验收测试
```

## 快速开始

```bash
# 1. 启动工作流（自动生成 Brief）
/workflow start docs/prd.md

# 2. 查看生成的文件
ls .claude/acceptance/          # Brief 文档
cat ~/.claude/workflows/*/tasks-*.md  # 任务清单（含验收项）

# 3. 执行任务时查看验收项
grep "T3:" tasks-*.md -A 10 | grep "验收项"
grep "AC-M1.1" .claude/acceptance/*-brief.md -A 15

# 4. 验收测试
# 按照 Brief 中的 requirement-to-brief mapping 与模块验收项逐项验收
```

## Brief 的核心组成

| 部分 | 作用 | 示例 |
|------|------|------|
| Requirement Coverage Summary | 汇总 requirement 覆盖率与 gaps | full / partial / none |
| Requirement-to-Brief Mapping | 说明每条 requirement 落到哪个模块和哪些 acceptance IDs | R-001 → User Module |
| Module Briefs | 按模块组织验收标准、测试策略和实现提示 | User Module / Auth Module |
| Acceptance Criteria | 模块级验收项，使用 `AC-M...` ID | AC-M1.1 登录成功 |
| Test Strategy | 说明 unit / integration / e2e 如何验证 | Vitest / Playwright |
| Implementation Hints | 提醒复用点、限制条件、注意事项 | 复用已有 service / guard |
| Coverage Gaps | 标记 partially covered / uncovered requirements | R-009 partial |
| Acceptance Pass Criteria | Must / Should / Nice to Have 验收通过标准 | P0 必须通过 |

## 模块验收项示例

### Module Brief 示例

```markdown
### Auth Module（P0）

**Related Requirement IDs**: R-001, R-003
**Constraints**: 登录后必须回跳来源页面；错误提示沿用既有文案

#### Acceptance Criteria
- [ ] AC-M1.1: 用户输入正确账号密码后成功登录
- [ ] AC-M1.2: 登录失败时显示既有错误提示文案

#### Test Strategy
- Unit: `auth.service.test.ts` 覆盖 token 处理
- Integration: `login-form.test.tsx` 覆盖表单提交流程
- E2E: 登录后回跳来源页面

#### Implementation Hints
- 复用现有 `AuthService`
- 不要新增第二套 session 存储逻辑
```

### Requirement-to-Brief Mapping 示例

```markdown
| Requirement ID | Summary | Coverage | Module | Acceptance IDs |
|----------------|---------|----------|--------|----------------|
| R-001 | 用户可登录 | full | Auth Module | AC-M1.1, AC-M1.2 |
| R-003 | 登录失败提示 | full | Auth Module | AC-M1.2 |
```

## 任务关联示例

```markdown
## T3: 接入登录表单与认证服务
- **阶段**: ui-form
- **文件**: `src/components/LoginForm.tsx`
- **requirement_ids**: R-001, R-003
- **验收项**: AC-M1.1, AC-M1.2
- **actions**: `edit_file`
- **状态**: pending
```

## 实现检查清单

### 需求与约束对齐

- [ ] 先核对模块的 `Related Requirement IDs`
- [ ] 先核对模块的 `Constraints`
- [ ] 每个 `in_scope` requirement 至少映射到一个模块验收项
- [ ] partially covered / uncovered requirement 已显式记录

### 测试与实现对齐

- [ ] 每个 `Acceptance Criteria` 都有对应验证方式
- [ ] Test Strategy 与当前技术栈一致
- [ ] Implementation Hints 中的复用建议已核对
- [ ] 关键 requirement 的验证证据可回溯

## 验收通过标准

### 必须满足（Must Pass）

- ✅ 所有 P0 模块的 Acceptance Criteria 通过
- ✅ 所有 `in_scope` 且 `full` coverage 的 requirement 对应验收项通过
- ✅ 所有关键约束相关验收项通过
- ✅ 关键功能流程验证通过

### 建议满足（Should Pass）

- ✅ 所有 Integration / E2E 验证通过
- ✅ Coverage Gaps 已被解释或清理
- ✅ Nice to Have 项有明确状态说明

## 常用命令

```bash
# 生成 Brief
/workflow start docs/prd.md

# 查看任务关联的验收项
grep "T3:" tasks-*.md -A 10 | grep "验收项"

# 查看具体验收项内容
grep "AC-M1.1" .claude/acceptance/*-brief.md -A 15

# 搜索模块验收项
grep "#### Acceptance Criteria" .claude/acceptance/*-brief.md -A 40

# 搜索 requirement-to-brief mapping
grep "Requirement-to-Brief Mapping" .claude/acceptance/*-brief.md -A 40
```

## 文件位置

```
项目目录/
└── .claude/
    ├── tech-design/{name}.md      ← 技术方案
    └── acceptance/{name}-brief.md ← Brief

~/.claude/workflows/{projectId}/
└── tasks-{name}.md                ← 任务清单（含验收项）
```

## 最佳实践

1. **实现前先看验收项** - 确保理解所有验证要求
2. **边实现边验证** - 及时发现问题
3. **使用测试数据** - 覆盖所有场景
4. **记录验收结果** - 包括验收人、时间、状态
5. **发现问题及时反馈** - 更新Brief

## 相关文档

- **流程总览**：`templates/skills/workflow-planning/references/start-overview.md`
- **当前入口**：`templates/commands/workflow.md`
- **规划技能**：`templates/skills/workflow-planning/SKILL.md`

## 示例输出

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Phase 0.6: 生成Brief
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Brief生成完成

📦 模块数量: 4 | P0: 2 | P1: 1 | P2: 1
📈 Requirement 覆盖: full 12 | partial 2 | none 1

📄 Brief已保存: .claude/acceptance/activity-management-brief.md

💡 任务执行时将自动关联相关验收项
```

## 常见问题

**Q: Brief太长，如何快速定位？**
A: 使用 grep 或编辑器搜索 `AC-M...`、模块名，或 `Requirement-to-Brief Mapping` 章节。

**Q: 任务没有关联验收项怎么办？**
A: 先检查该任务是否缺少 `requirement_ids`，或是否属于基础设施类任务；基础设施任务通常通过通用验证标准而非模块验收项验收。

**Q: Brief 与实际需求不符怎么办？**
A: 与产品确认实际需求 → 更新需求文档或 Requirement Baseline → 重新生成 Brief。

**Q: 如何更新Brief？**
A: 小的调整可手动编辑，但涉及 requirement coverage、acceptance IDs 或模块拆分的变化，建议更新 PRD 后重新生成。

## 技术支持

- GitHub Issues: https://github.com/anthropics/claude-code/issues
- 项目文档: `docs/` 目录
