---
description: 后端工作流启动 - 从 PRD 到需求分析到方案设计到执行计划
argument-hint: "<PRD文档路径>"
allowed-tools: Task(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), AskUserQuestion(*), mcp__codex__codex(*), mcp__mcp-router__sequentialthinking(*)
---

# 后端工作流启动

从产品需求文档（PRD）出发，依次生成需求分析文档（xq.md）、方案设计文档（fasj.md）、工作流执行计划。

**特点**：
- 每生成一个文档后暂停，等待用户审查修改
- 与 Codex 协作讨论，确保需求理解和方案设计的准确性
- 文档存储在项目级目录，便于团队共享

---

## 🎯 执行流程概览

```
PRD.md → xq.md（需求分析）→ fasj.md（方案设计）→ workflow-memory.json（执行计划）
           ↓                    ↓
        暂停审查              暂停审查
```

---

## Step 0：前置检查

### 0.1 检查项目配置

```typescript
const configPath = '.claude/config/project-config.json';

if (!fileExists(configPath)) {
  console.log(`
⚠️ 项目配置不存在

请先执行初始化：
  /init-project-config

初始化完成后重新执行：
  /workflow-backend-start "<PRD文档路径>"
  `);
  return;
}

const config = JSON.parse(readFile(configPath));
```

### 0.2 检查后端配置（backend.fasjSpecPath）

```typescript
// 检查 backend 配置是否存在
if (!config.backend || !config.backend.fasjSpecPath) {
  console.log(`
⚠️ 未配置方案设计规范路径

后端工作流需要一份方案设计规范文档来指导 fasj.md 的生成。
  `);

  // 询问用户
  const answer = await AskUserQuestion({
    questions: [{
      question: "请选择方案设计规范的配置方式",
      header: "规范配置",
      multiSelect: false,
      options: [
        {
          label: "输入规范路径",
          description: "提供已有的方案设计规范文档路径"
        },
        {
          label: "使用默认模板",
          description: "使用内置的后端方案设计规范模板"
        },
        {
          label: "取消",
          description: "取消当前操作"
        }
      ]
    }]
  });

  if (answer.answers["规范配置"] === "取消") {
    return;
  }

  let fasjSpecPath;
  if (answer.answers["规范配置"] === "输入规范路径") {
    // 再次询问具体路径
    const pathAnswer = await AskUserQuestion({
      questions: [{
        question: "请输入方案设计规范文档的路径（相对于项目根目录）",
        header: "规范路径",
        multiSelect: false,
        options: [
          { label: ".claude/specs/fasj-spec.md", description: "推荐路径" },
          { label: "docs/backend-design-spec.md", description: "docs 目录" }
        ]
      }]
    });
    fasjSpecPath = pathAnswer.answers["规范路径"];
  } else {
    // 使用默认模板
    fasjSpecPath = ".claude/specs/backend-fasj-spec.md";
    // 创建默认规范文件（从内置模板复制）
    ensureDir(".claude/specs");
    copyTemplate("backend-fasj-spec.md", fasjSpecPath);
  }

  // 更新配置
  config.backend = config.backend || {};
  config.backend.fasjSpecPath = fasjSpecPath;
  config.backend.docDir = ".claude/docs";
  config.backend.enableCodexReview = true;
  writeFile(configPath, JSON.stringify(config, null, 2));

  console.log(`✅ 已更新配置：backend.fasjSpecPath = ${fasjSpecPath}`);
}

// 验证规范文件存在
if (!fileExists(config.backend.fasjSpecPath)) {
  console.log(`
❌ 方案设计规范文件不存在：${config.backend.fasjSpecPath}

请确保该文件存在，或重新配置：
  编辑 .claude/config/project-config.json 中的 backend.fasjSpecPath
  `);
  return;
}
```

### 0.3 检查现有工作流

```typescript
const memoryPath = getWorkflowMemoryPath(); // ~/.claude/workflows/{projectId}/workflow-memory.json

if (fileExists(memoryPath)) {
  const existingMemory = JSON.parse(readFile(memoryPath));

  if (existingMemory.status !== 'completed') {
    const backupPath = `${memoryPath}.backup-${Date.now()}.json`;
    copyFile(memoryPath, backupPath);

    const choice = await AskUserQuestion({
      questions: [{
        question: `检测到未完成的任务"${existingMemory.task_name}"，如何处理？`,
        header: "任务冲突",
        multiSelect: false,
        options: [
          { label: "继续旧任务", description: "使用 /workflow-execute 继续" },
          { label: "开始新任务", description: `旧任务已备份到 ${backupPath}` },
          { label: "取消", description: "不做任何更改" }
        ]
      }]
    });

    if (choice.answers["任务冲突"] === "继续旧任务") {
      console.log(`\n🚀 继续执行：/workflow-execute\n📊 查看状态：/workflow-status`);
      return;
    }
    if (choice.answers["任务冲突"] === "取消") {
      return;
    }
  }
}
```

---

## Step 1：解析 PRD 文档

### 1.1 读取并验证 PRD

```typescript
const prdPath = $ARGUMENTS[0]; // 用户提供的 PRD 路径

if (!prdPath) {
  console.log(`
❌ 请提供 PRD 文档路径

用法：
  /workflow-backend-start "docs/user-management-prd.md"
  `);
  return;
}

if (!fileExists(prdPath)) {
  console.log(`❌ PRD 文件不存在：${prdPath}`);
  return;
}

const prdContent = readFile(prdPath);
const baseName = path.basename(prdPath, '.md').replace(/-prd$/, '');

console.log(`
📄 PRD 文档：${prdPath}
📝 基础名称：${baseName}
📁 输出目录：${config.backend.docDir || '.claude/docs'}
`);
```

### 1.2 提取 PRD 核心信息

```typescript
// 使用 sequential-thinking 分析 PRD
mcp__mcp-router__sequentialthinking({
  thought: `分析 PRD 文档的核心内容：
    1. 业务背景和目标
    2. 功能范围（In Scope / Out of Scope）
    3. 核心业务流程
    4. 关键实体和数据
    5. 非功能需求（性能、安全、合规）
    6. 风险和依赖`,
  thoughtNumber: 1,
  totalThoughts: 3,
  nextThoughtNeeded: true
});
```

---

## Step 2：生成需求分析文档（xq.md）

### 2.1 与 Codex 讨论需求理解

```typescript
const codexResult = await mcp__codex__codex({
  PROMPT: `请帮我分析这份后端 PRD 文档，重点关注：

1. **需求边界**：哪些是本次迭代必须做的？哪些明确不做？
2. **业务流程**：核心用例的主成功路径和异常路径
3. **数据需求**：需要哪些核心实体？查询维度是什么？
4. **非功能需求**：性能、安全、可用性的具体要求
5. **风险点**：可能的歧义、遗漏、依赖问题

PRD 内容：
---
${prdContent}
---

请以结构化方式输出你的分析，并指出需要与用户确认的问题。`,
  cd: process.cwd(),
  sandbox: "read-only"
});

// 保存 SESSION_ID
const codexSessionId = codexResult.SESSION_ID;
```

### 2.2 生成 xq.md

```typescript
const xqPath = `${config.backend.docDir || '.claude/docs'}/${baseName}-xq.md`;
ensureDir(path.dirname(xqPath));

const xqContent = generateXqDocument({
  baseName,
  prdPath,
  prdContent,
  codexAnalysis: codexResult.agent_messages,
  timestamp: new Date().toISOString()
});

writeFile(xqPath, xqContent);

console.log(`
✅ 需求分析文档已生成：${xqPath}

📋 文档结构：
  - 元信息
  - 背景与业务目标
  - 范围与边界
  - 角色与主体
  - 关键业务流程
  - 功能需求拆解
  - 非功能需求
  - 数据与接口线索
  - 风险、依赖与假设
  - 验收标准
  - Codex 协作记录
`);
```

### 2.3 创建工作流记忆（暂停点）

```typescript
const memory = {
  task_name: `${baseName}-backend`,
  task_description: `后端开发工作流：${baseName}`,
  complexity: "medium",
  workflow_type: "backend",
  started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  current_step_id: 1,
  total_steps: 10,
  status: "in_progress",

  source_docs: {
    prd: prdPath,
    xq: xqPath,
    fasj: null
  },

  steps: [
    {
      id: 1,
      phase: "analyze",
      name: "生成需求分析文档（xq.md）",
      action: "backend_generate_xq",
      status: "completed",
      completed_at: new Date().toISOString(),
      output_artifacts: [xqPath]
    },
    {
      id: 2,
      phase: "analyze",
      name: "审查需求分析文档",
      description: "用户审查 xq.md，可手动修改后继续",
      action: "backend_review_xq",
      status: "pending",
      depends_on: [1]
    },
    {
      id: 3,
      phase: "design",
      name: "生成方案设计文档（fasj.md）",
      action: "backend_generate_fasj",
      status: "pending",
      depends_on: [2]
    },
    {
      id: 4,
      phase: "design",
      name: "Codex 方案审查",
      action: "codex_design_review",
      status: "pending",
      depends_on: [3],
      quality_gate: true,
      threshold: 80
    },
    {
      id: 5,
      phase: "design",
      name: "审查并修订方案设计",
      action: "backend_refine_fasj",
      status: "pending",
      depends_on: [4]
    },
    {
      id: 6,
      phase: "implement",
      name: "生成实施计划",
      action: "backend_plan_implementation",
      status: "pending",
      depends_on: [5]
    },
    {
      id: 7,
      phase: "implement",
      name: "执行开发任务",
      action: "execute_code",
      status: "pending",
      depends_on: [6]
    },
    {
      id: 8,
      phase: "verify",
      name: "自测与验证",
      action: "backend_self_verify",
      status: "pending",
      depends_on: [7]
    },
    {
      id: 9,
      phase: "verify",
      name: "Codex 代码审查",
      action: "codex_code_review",
      status: "pending",
      depends_on: [8],
      quality_gate: true,
      threshold: 80
    },
    {
      id: 10,
      phase: "deliver",
      name: "完善文档并总结",
      action: "write_summary",
      status: "pending",
      depends_on: [9]
    }
  ],

  artifacts: {
    requirement_analysis: xqPath,
    tech_design: null,
    verification_report: null,
    workflow_summary: null
  },

  quality_gates: {
    codex_design_review: { step_id: 4, threshold: 80, actual_score: null, passed: null },
    codex_code_review: { step_id: 9, threshold: 80, actual_score: null, passed: null }
  },

  codex_session_id: codexSessionId,
  decisions: [],
  issues: []
};

saveWorkflowMemory(memory);
```

### 2.4 输出暂停提示

```markdown
---

## ⏸️ 工作流已暂停 - 等待审查

**当前进度**：1 / 10（需求分析已完成）

### 📄 已生成文档

**需求分析文档**：`{{xqPath}}`

### 📝 请执行以下操作

1. **审查文档**：
   ```bash
   cat {{xqPath}}
   ```

2. **修改文档**（如需要）：
   - 直接编辑 `{{xqPath}}`
   - 补充遗漏的需求点
   - 修正不准确的理解
   - 完善验收标准

3. **继续执行**（审查完成后）：
   ```bash
   /workflow-execute
   ```

---

### 💡 提示

- 需求分析文档是后续方案设计的基础，请仔细审查
- 如有疑问，可以在文档的"Codex 协作记录"部分记录
- 下一步将根据此文档 + 方案设计规范生成技术方案
```

---

## 📁 文档结构说明

### xq.md 需求分析文档结构

```markdown
# 后端需求分析 - {模块名称}

## 0. 元信息
- 源 PRD：{prdPath}
- 文档版本：v1.0
- 生成时间：{timestamp}
- 参与 Agent：Claude Code（分析）、Codex（审查）

## 1. 背景与业务目标
## 2. 范围与边界
### 2.1 In Scope
### 2.2 Out of Scope

## 3. 角色与主体
## 4. 关键业务流程与用例
## 5. 功能需求拆解（FR-01, FR-02, ...）
## 6. 非功能需求
## 7. 数据与接口线索
## 8. 风险、依赖与假设
## 9. 验收标准
## 10. Codex 协作记录
```

### fasj.md 方案设计文档结构

```markdown
# 后端技术方案 - {模块名称}

## 0. 元信息
## 1. 设计目标与原则
## 2. 架构与边界
## 3. 模块与职责划分
## 4. 数据模型设计
### 4.1 领域模型
### 4.2 持久化模型
### 4.3 缓存与派生数据

## 5. 接口设计（API 契约）
### 5.1 外部 API
### 5.2 请求/响应结构
### 5.3 内部接口/事件

## 6. 业务流程与状态设计
## 7. 非功能设计
## 8. 数据迁移与兼容性
## 9. 实施计划
### 9.1 工作项列表（T-01, T-02, ...）
### 9.2 里程碑

## 10. 测试与验收方案
## 11. Codex 审查记录
```

---

## ⚙️ 配置说明

### project-config.json 中的 backend 配置

```json
{
  "backend": {
    "docDir": ".claude/docs",
    "fasjSpecPath": ".claude/specs/backend-fasj-spec.md",
    "xqSpecPath": ".claude/specs/backend-xq-spec.md",
    "enableCodexReview": true
  }
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `docDir` | 文档输出目录 | `.claude/docs` |
| `fasjSpecPath` | 方案设计规范路径 | 必填，首次使用时询问 |
| `xqSpecPath` | 需求分析规范路径 | 可选 |
| `enableCodexReview` | 是否启用 Codex 审查 | `true` |

---

## 🔄 与其他命令的关系

```bash
# 启动后端工作流
/workflow-backend-start "docs/user-management-prd.md"

# 继续执行（审查完成后）
/workflow-execute

# 查看状态
/workflow-status

# 跳过步骤（慎用）
/workflow-skip-step

# 重试步骤
/workflow-retry-step
```

---

## 💡 使用示例

```bash
# 1. 启动工作流
/workflow-backend-start "docs/payment-prd.md"

# 输出：
# ✅ 需求分析文档已生成：.claude/docs/payment-xq.md
# ⏸️ 工作流已暂停 - 等待审查
#
# 审查完成后执行：/workflow-execute

# 2. 审查 xq.md 并修改
cat .claude/docs/payment-xq.md
# （手动编辑文件）

# 3. 继续执行，生成 fasj.md
/workflow-execute

# 输出：
# ✅ 方案设计文档已生成：.claude/docs/payment-fasj.md
# ⏸️ 工作流已暂停 - 等待审查

# 4. 审查 fasj.md 并修改
cat .claude/docs/payment-fasj.md
# （手动编辑文件）

# 5. 继续执行，生成执行计划
/workflow-execute

# 输出：
# ✅ 执行计划已生成
# 🚀 下一步：/workflow-execute 开始开发
```
