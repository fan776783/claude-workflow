# Skill 提示词优化指南

> 基于 `workflow-plan` skill 优化实践总结（2026-04）。为后续其他 skills 的优化提供方向指引。

## 核心问题

AI 在执行 skill 时频繁偏离流程。根因分析：

| 问题 | 表现 | 根因 |
|------|------|------|
| 注意力稀释 | AI 跳步、遗漏关卡 | 提示词过长，行动指令占比低（仅 ~20%） |
| 认知过载 | AI 不执行伪代码逻辑 | TypeScript interface/伪代码无法被 AI "运行"，沦为噪声 |
| 上下文前置 | 加载无关信息 | "先读"章节一次性注入全部参考文档 |
| 职责越界 | AI 手动构造 JSON | 应由 CLI 处理的操作暴露了内部结构给 AI |

## 优化原则

### 原则 1：声明式替代过程式

**反模式**：用 TypeScript interface 和伪代码定义行为
```typescript
// ❌ AI 不是代码解释器
interface DiscussionArtifact {
  clarifications: Array<{
    dimension: 'scope' | 'behavior' | 'edge-case';
    question: string;
    answer: string;
  }>;
}
async function runDiscussion(gaps: Gap[]): Promise<DiscussionArtifact> {
  for (const gap of gaps) { ... }
}
```

**正模式**：用自然语言约束声明预期行为
```markdown
<!-- ✅ AI 是协作者，理解自然语言 -->
**需求讨论**：逐个澄清未定义的 gap，每个 gap 给出 2-3 个可选方案，
用户选择后记录到 discussion-artifact.json。
维度包括：scope / behavior / edge-case / constraint / dependency。
```

### 原则 2：渐进式披露

**反模式**：在文件开头列出所有参考文档
```markdown
<!-- ❌ 一次性加载全部上下文 -->
## 先读
- state-machine.md
- preflight.md
- artifact-schemas.md
- spec-template.md
- plan-template.md
```

**正模式**：在每个 Step 中按需引用
```markdown
<!-- ✅ 只在需要时才加载 -->
## Step 5: 生成 Spec
使用模板 `spec-template.md` 填充以下字段...
```

### 原则 3：CLI 接管状态操作

**反模式**：在提示词中教 AI 构造 JSON 结构
```markdown
<!-- ❌ AI 不应该知道 JSON 内部字段 -->
将以下结构写入 workflow-state.json:
{
  "status": "running",
  "quality_gates": { ... },
  "context_injection": { "schema_version": "1", ... }
}
```

**正模式**：告诉 AI 调什么 CLI 命令
```markdown
<!-- ✅ 让 CLI 处理状态持久化 -->
调用 `node utils/workflow/workflow_cli.js plan "需求描述"` 启动规划。
CLI 自动创建 workflow-state.json 并初始化所有必需字段。
```

**判断标准**：如果 CLI 已有对应命令 → 提示词只写"调 CLI"；如果没有 → 保留最小必需结构。

### 原则 4：命令语义对齐

**反模式**：命令名与 skill 职责不匹配
```
/workflow start  → 但这个 skill 做的是"规划"不是"开始执行"
```

**正模式**：命令名精确反映 skill 职责
```
/workflow plan   → 明确表示这是规划阶段
/workflow execute → 明确表示这是执行阶段
```

### 原则 5：集中化治理

**反模式**：HARD-GATE 散落在多个文件中
```
phase-0.3-ux-design-gate.md → UX HARD-GATE
phase-1.1-spec-user-review.md → Spec Review HARD-GATE
phase-2-plan-generation.md → No-TBD HARD-GATE
```

**正模式**：所有 HARD-GATE 集中在 SKILL.md 开头
```markdown
<HARD-GATE>
1. Spec 未经用户确认，不得生成 Plan
2. 讨论/UX 产物必须持久化为 JSON，不得仅在对话中存在
3. Plan 中不允许任何 TBD/TODO/占位符
</HARD-GATE>
```

### 原则 6：Self-Review 外置

**反模式**：审查逻辑嵌入主流程，增加行文长度
```markdown
## Step 5: 生成 Spec
... 200 行 Spec 生成逻辑 ...
### Self-Review
... 80 行审查清单 ...
```

**正模式**：主流程只保留"执行 Self-Review"指令，清单放到 references
```markdown
## Step 5: 生成 Spec
... 生成逻辑 ...
执行自审：阅读 `references/spec-self-review.md` 并逐项检查。
```

---

## 优化 Checklist

对任意 skill 执行优化时，按以下清单检查：

- [ ] **伪代码清理**：是否存在 TypeScript/Python 伪代码？→ 转为声明式自然语言
- [ ] **前置加载**：是否有"先读"章节一次性加载多个参考？→ 改为按需引用
- [ ] **JSON 构造**：AI 是否需要手动构造 JSON？→ 检查 CLI 是否已有对应命令
- [ ] **文件碎片**：是否拆成过多小文件（每个 < 100 行）？→ 考虑合并
- [ ] **HARD-GATE 位置**：治理规则是否散落在多个文件？→ 集中到 SKILL.md 开头
- [ ] **Self-Review**：审查清单是否嵌入主流程？→ 提取到 references/ 下
- [ ] **命令语义**：命令名是否与 skill 职责匹配？→ 改名并保留旧名别名
- [ ] **行动指令占比**：主文件中"AI 应该做什么"的内容占比是否 > 60%？
- [ ] **条件判断点**：条件分支是否过多（> 8 个）？→ 简化为 checklist

---

## 量化标准

| 指标 | 目标 |
|------|------|
| SKILL.md 行动指令占比 | ≥ 60% |
| TypeScript/伪代码行数 | 0 |
| 条件判断点 | ≤ 6 |
| "先读"前置引用数 | 0（改为按需引用） |
| AI 手动构造 JSON 的工件数 | 仅限 CLI 不覆盖的场景 |

---

## 实践案例：workflow-plan 优化记录

### 优化前

- **8 个文件**，~2,500 行
- TypeScript 伪代码 ~1,200 行（interface 定义 12+，async function 8+）
- 行动指令占比 ~20%
- 条件判断点 12+
- "先读" 前置加载 5 个参考文档
- AI 需手动构造 4 个 JSON 工件

### 优化后

- **4 个文件**，~700 行（-72%）
- TypeScript 伪代码 0 行（-100%）
- 行动指令占比 ~80%（4x 提升）
- 条件判断点 5-6（-50%）
- 前置引用 0（渐进式披露）
- AI 仅需构造 1 个 JSON 工件（analysis-result.json），其余 3 个由 CLI 自动创建

### 附带改动

| 改动 | 说明 |
|------|------|
| `state-machine.md` 350→165 行 | JSON schema → CLI 操作指南 |
| `preflight.md` 221→80 行 | 删除全部伪代码 |
| `/workflow start` → `/workflow plan` | 命令语义对齐（`start` 保留为别名） |

---

## 后续优化候选

| Skill | 现状 | 优化方向 |
|-------|------|---------|
| `workflow-execute` | SKILL.md 52 行索引页 + specs/ 多文件 | 合并为完整行动指南，同 workflow-plan |
| `workflow-review` | specs/execute/ 下 subagent-review.md 较长 | 精简伪代码，CLI 接管审查状态写入 |
| `workflow-delta` | 中等体量 | 检查 JSON 构造是否可由 CLI 接管 |
| `team-workflow` | 引用较多外部文档 | 检查前置加载情况 |
| `scan` | 295 行，含伪代码 | 声明式替代 |
