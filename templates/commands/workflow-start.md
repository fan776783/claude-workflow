---
description: 启动智能工作流 - 分析需求并生成详细执行计划
argument-hint: "\"功能需求描述\" 或 --backend \"PRD文档路径\""
allowed-tools: Task(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), mcp__mcp-router__sequentialthinking(*), mcp__codex__codex(*), AskUserQuestion(*)
---

# 智能工作流启动

统一的工作流入口，支持多种工作流类型：

| 类型 | 用法 | 说明 |
|------|------|------|
| **通用** | `/workflow-start "需求描述"` | 自动适配 5/13/22 步 |
| **后端** | `/workflow-start --backend "PRD路径"` | 从 PRD 生成 xq.md → fasj.md → 执行计划 |

**配置依赖**：`.claude/config/project-config.json`（自动读取项目配置）

**工作目录**：从配置自动读取（`project.rootDir`）

**工作流状态存储**：用户级目录（`~/.claude/workflows/`），完全避免 Git 冲突

**文档产物存储**：项目目录（`.claude/`），便于团队共享

---

## 🎯 执行流程

### Step -2：解析参数并确定工作流类型

```typescript
// 解析参数
const args = $ARGUMENTS.join(' ');
let workflowType = 'general';  // 默认通用工作流
let requirement = '';
let prdPath = '';

// 检测工作流类型
if (args.includes('--backend')) {
  workflowType = 'backend';
  // 提取 PRD 路径
  const match = args.match(/--backend\s+["']?([^"'\s]+)["']?/);
  prdPath = match ? match[1] : '';

  if (!prdPath) {
    console.log(`
❌ 后端工作流需要提供 PRD 文档路径

用法：
  /workflow-start --backend "docs/user-management-prd.md"
    `);
    return;
  }

  if (!fileExists(prdPath)) {
    console.log(`❌ PRD 文件不存在：${prdPath}`);
    return;
  }

  console.log(`📋 工作流类型：后端工作流（从 PRD 开始）`);
  console.log(`📄 PRD 文档：${prdPath}\n`);
} else {
  // 通用工作流
  requirement = args.replace(/^["']|["']$/g, '').trim();

  if (!requirement) {
    console.log(`
❌ 请提供需求描述

用法：
  /workflow-start "实现用户认证功能"
  /workflow-start --backend "docs/prd.md"
    `);
    return;
  }

  console.log(`📋 工作流类型：通用工作流`);
  console.log(`📝 需求描述：${requirement}\n`);
}
```

---

### Step -1：项目配置检查（强制前置条件）🚨

**目标**: 确保项目已扫描且包含有效的 `project.id`，否则**强制终止并要求执行** `/scan`

> ⚠️ **重要**：没有 `project-config.json` 或缺少 `project.id` 时，工作流**无法启动**。
> 这是为了确保工作流目录（`~/.claude/workflows/{project.id}/`）能正确关联到项目。

**执行逻辑**:

```typescript
console.log(`🔍 检查项目配置...\n`);

const cwd = process.cwd();
const configPath = path.join(cwd, '.claude/config/project-config.json');

// 检查配置文件是否存在
if (!fs.existsSync(configPath)) {
  console.log(`
🚨 项目配置不存在，无法启动工作流

📋 当前项目: ${path.basename(cwd)}
📍 项目路径: ${cwd}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 请先执行扫描命令：

   /scan

扫描完成后，重新执行：

   /workflow-start "你的需求描述"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
  // 强制终止，不提供跳过选项
  return;
}

// 检查配置文件是否包含 project.id
let projectConfig;
try {
  projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
  console.log(`
🚨 项目配置文件损坏，无法解析

📍 文件路径: ${configPath}
❌ 错误信息: ${e.message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 请重新执行扫描命令：

   /scan

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
  return;
}

// 检查 project.id 是否存在
if (!projectConfig.project?.id) {
  console.log(`
🚨 项目配置缺少 project.id，无法关联工作流目录

📍 配置文件: ${configPath}
⚠️ 这可能是旧版本的配置文件

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 请重新执行扫描命令以更新配置：

   /scan

扫描会自动生成 project.id 并关联工作流目录。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
  return;
}

// 配置有效，显示项目信息
const projectId = projectConfig.project.id;
const projectName = projectConfig.project.name;
const workflowDir = path.join(os.homedir(), '.claude/workflows', projectId);

console.log(`✅ 项目配置有效

📋 项目名称: ${projectName}
🆔 项目 ID: ${projectId}
📁 工作流目录: ${workflowDir}
`);
```

**说明**:
- 🚨 **强制检查**: 配置文件不存在或无效时，**直接终止**，不提供跳过选项
- 🆔 **ID 校验**: 必须包含 `project.id`，用于关联工作流存储目录
- 🔗 **目录关联**: `project.id` 决定工作流存储在 `~/.claude/workflows/{project.id}/`
- 📦 **旧配置兼容**: 检测到旧配置（无 ID）时，提示重新初始化

---

### Step 0：检测现有任务并保护（必须）⚠️

#### 0.1 获取工作流目录

**从已验证的配置中读取 project.id**（Step -1 已确保配置有效）：

```typescript
// 此时 projectConfig 已在 Step -1 中加载并验证
const projectId = projectConfig.project.id;

// 获取用户级工作流路径
function getWorkflowMemoryPath(): string {
  const workflowDir = path.join(
    os.homedir(),
    '.claude/workflows',
    projectId
  );

  // 首次使用：创建目录和元数据
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });

    // 保存项目元数据（便于反向查找）
    const metaPath = path.join(workflowDir, 'project-meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      project_id: projectId,
      project_path: process.cwd(),
      project_name: projectConfig.project.name,
      created_at: new Date().toISOString()
    }, null, 2));
  }

  return path.join(workflowDir, 'workflow-memory.json');
}

// 使用用户级路径
const memoryPath = getWorkflowMemoryPath();
// 例如：~/.claude/workflows/a1b2c3d4e5f6/workflow-memory.json
```

**优点**：
- ✅ 配置驱动 - 项目 ID 来自 `project-config.json`，确保一致性
- ✅ 天然隔离 - 每个开发者独立管理
- ✅ 无 Git 冲突 - 工作流状态不在项目目录
- ✅ 多项目支持 - 自动切换不同项目的状态
- ✅ 可追溯 - `project-meta.json` 记录项目路径，便于反向查找

#### 0.2 向后兼容检查（可选）

检测项目级状态（旧方案）并提示迁移：

```typescript
const projectLevelPath = '.claude/workflow-memory.json';

if (fileExists(projectLevelPath)) {
  console.log(`
⚠️ 检测到项目级工作流状态（旧方案）

📍 位置：${projectLevelPath}

🔄 建议迁移到用户级目录：
  - 优点：完全避免 Git 冲突
  - 优点：多人协作无冲突
  - 优点：用户完全自主管理

执行命令：/workflow-migrate-to-user
或继续使用项目级（不推荐）
  `);

  // 询问用户选择
  // const choice = await AskUserQuestion(...);
}
```

#### 0.3 检测并保护现有任务

**在创建新任务前，必须先检查是否已有未完成的任务**：

```typescript
const memoryPath = getWorkflowMemoryPath(); // 使用用户级路径

// 检查是否存在现有任务记忆
if (fileExists(memoryPath)) {
  const existingMemory = JSON.parse(readFile(memoryPath));

  // 检查任务状态
  if (existingMemory.status !== 'completed') {
    // 未完成的任务，需要保护
    const backupPath = `.claude/workflow-memory-backup-${Date.now()}.json`;

    // 自动备份现有任务
    copyFile(memoryPath, backupPath);

    // 提示用户并询问操作
    const userChoice = await askUser({
      question: `⚠️ 检测到未完成的任务"${existingMemory.task_name}"（进度 ${existingMemory.current_step_id}/${existingMemory.total_steps}），如何处理？`,
      options: [
        {
          label: "继续执行旧任务",
          description: "放弃新任务，继续执行之前的任务"
        },
        {
          label: "开始新任务（备份旧任务）",
          description: `旧任务已备份到 ${backupPath}，开始新任务`
        },
        {
          label: "取消操作",
          description: "不做任何更改，退出命令"
        }
      ]
    });

    if (userChoice === "继续执行旧任务") {
      // 提示用户使用 /workflow-execute 继续
      console.log(`✅ 继续执行任务"${existingMemory.task_name}"`);
      console.log(`\n🚀 执行命令：/workflow-execute`);
      console.log(`\n📊 查看状态：/workflow-status`);
      return; // 终止新任务创建
    }

    if (userChoice === "取消操作") {
      console.log("✅ 操作已取消，未做任何更改");
      return; // 终止新任务创建
    }

    // 用户选择"开始新任务（备份旧任务）"
    console.log(`✅ 旧任务已备份到：${backupPath}`);
    console.log(`💡 如需恢复旧任务，执行：cp ${backupPath} ${memoryPath}`);
    console.log(`\n开始创建新任务...\n`);
  } else {
    // 已完成的任务，可以安全覆盖（但仍然备份）
    const backupPath = `.claude/workflow-memory-completed-${Date.now()}.json`;
    copyFile(memoryPath, backupPath);
    console.log(`📦 已完成的任务已归档到：${backupPath}\n`);
  }
}
```

### Step 1：使用 sequential-thinking 分析需求

```typescript
// 使用 sequential-thinking 深度分析需求
mcp__mcp-router__sequentialthinking({
  thought: "分析用户需求的复杂度和范围",
  // 分析维度：
  // 1. 功能复杂度（简单/中等/复杂）
  // 2. 预计代码量（< 300行 / 300-1000行 / > 1000行）
  // 3. 涉及模块数量
  // 4. 是否需要架构变更
  // 5. 是否需要 Codex 深度审查
  // 6. 预计开发时间
})
```

### Step 2：生成分步执行计划

**根据需求复杂度，生成详细的步骤清单**：

#### 简单任务（< 300行，< 1天）

```json
{
  "task_name": "{{功能名称}}",
  "complexity": "simple",
  "estimated_time": "< 1天",
  "steps": [
    {
      "id": 1,
      "phase": "analyze",
      "name": "快速上下文收集",
      "description": "识别相似实现，确认可复用组件",
      "action": "explore_code",
      "estimated_time": "10分钟"
    },
    {
      "id": 2,
      "phase": "implement",
      "name": "直接编码实现",
      "description": "按既有模式实现功能",
      "action": "code",
      "estimated_time": "30分钟"
    },
    {
      "id": 3,
      "phase": "test",
      "name": "编写单元测试",
      "description": "覆盖核心场景",
      "action": "write_tests",
      "estimated_time": "15分钟"
    },
    {
      "id": 4,
      "phase": "verify",
      "name": "运行验证",
      "description": "类型检查、lint、测试",
      "action": "verify",
      "estimated_time": "5分钟"
    },
    {
      "id": 5,
      "phase": "deliver",
      "name": "代码提交",
      "description": "规范提交信息",
      "action": "commit",
      "estimated_time": "5分钟"
    }
  ]
}
```

#### 中等任务（300-1000行，1-2天）

```json
{
  "task_name": "{{功能名称}}",
  "complexity": "medium",
  "estimated_time": "1-2天",
  "steps": [
    {
      "id": 1,
      "phase": "analyze",
      "name": "加载项目上下文",
      "action": "context_load",
      "estimated_time": "5分钟"
    },
    {
      "id": 2,
      "phase": "analyze",
      "name": "需求拆解",
      "action": "analyze_requirements",
      "estimated_time": "10分钟"
    },
    {
      "id": 3,
      "phase": "analyze",
      "name": "用户确认（如有歧义）",
      "action": "ask_user",
      "condition": "has_ambiguity",
      "estimated_time": "5分钟"
    },
    {
      "id": 4,
      "phase": "design",
      "name": "探索现有实现",
      "action": "explore_code",
      "estimated_time": "10分钟"
    },
    {
      "id": 5,
      "phase": "design",
      "name": "生成技术方案",
      "action": "write_tech_design",
      "estimated_time": "20分钟"
    },
    {
      "id": 6,
      "phase": "design",
      "name": "Codex 方案审查",
      "action": "codex_review_design",
      "estimated_time": "10分钟",
      "quality_gate": true,
      "threshold": 80
    },
    {
      "id": 7,
      "phase": "implement",
      "name": "实现功能点1",
      "action": "code",
      "estimated_time": "1小时",
      "context_policy": "fresh"
    },
    {
      "id": 8,
      "phase": "implement",
      "name": "实现功能点2",
      "action": "code",
      "estimated_time": "1小时"
    },
    {
      "id": 9,
      "phase": "implement",
      "name": "编写单元测试",
      "action": "write_tests",
      "estimated_time": "30分钟"
    },
    {
      "id": 10,
      "phase": "verify",
      "name": "Codex 代码审查",
      "action": "codex_review_code",
      "estimated_time": "10分钟",
      "quality_gate": true,
      "threshold": 80,
      "context_policy": "auto"
    },
    {
      "id": 11,
      "phase": "verify",
      "name": "质量验证",
      "action": "verify",
      "estimated_time": "15分钟"
    },
    {
      "id": 12,
      "phase": "deliver",
      "name": "补充文档",
      "action": "write_docs",
      "estimated_time": "20分钟"
    },
    {
      "id": 13,
      "phase": "deliver",
      "name": "代码提交",
      "action": "commit",
      "estimated_time": "5分钟"
    }
  ]
}
```

#### 复杂任务（> 1000行，> 2天）

```json
{
  "task_name": "{{功能名称}}",
  "complexity": "complex",
  "estimated_time": "> 2天",
  "steps": [
    {
      "id": 1,
      "phase": "analyze",
      "name": "加载项目上下文",
      "action": "context_load"
    },
    {
      "id": 2,
      "phase": "analyze",
      "name": "深度需求分析",
      "action": "analyze_requirements"
    },
    {
      "id": 3,
      "phase": "analyze",
      "name": "用户确认",
      "action": "ask_user",
      "condition": "has_ambiguity",
      "context_needs_chat": true
    },
    {
      "id": 4,
      "phase": "design",
      "name": "架构评估",
      "action": "architect_review"
    },
    {
      "id": 5,
      "phase": "design",
      "name": "探索现有实现",
      "action": "explore_code"
    },
    {
      "id": 6,
      "phase": "design",
      "name": "专项分析（按需）",
      "action": "specialized_analysis",
      "sub_actions": [
        "analyze_performance",
        "analyze_deps",
        "analyze_route",
        "analyze_store",
        "analyze_i18n"
      ]
    },
    {
      "id": 7,
      "phase": "design",
      "name": "生成技术方案文档",
      "action": "write_tech_design"
    },
    {
      "id": 8,
      "phase": "design",
      "name": "Codex 方案审查",
      "action": "codex_review_design",
      "quality_gate": true,
      "threshold": 80
    },
    {
      "id": 9,
      "phase": "design",
      "name": "根据 Codex 建议优化方案",
      "action": "optimize_design",
      "condition": "codex_score < 90"
    },
    {
      "id": 10,
      "phase": "implement",
      "name": "实现核心功能模块",
      "action": "code",
      "sub_tasks": "从技术方案提取",
      "context_policy": "fresh"
    },
    {
      "id": 11,
      "phase": "implement",
      "name": "编写单元测试",
      "action": "write_tests"
    },
    {
      "id": 12,
      "phase": "implement",
      "name": "运行测试验证",
      "action": "run_tests"
    },
    {
      "id": 13,
      "phase": "verify",
      "name": "Codex 代码审查",
      "action": "codex_review_code",
      "quality_gate": true,
      "threshold": 80,
      "context_policy": "fresh"
    },
    {
      "id": 14,
      "phase": "verify",
      "name": "架构级审查",
      "action": "architect_review"
    },
    {
      "id": 15,
      "phase": "verify",
      "name": "专项审查",
      "action": "specialized_review",
      "sub_actions": ["review_ui", "review_api", "review_tracking"]
    },
    {
      "id": 16,
      "phase": "verify",
      "name": "性能验证",
      "action": "analyze_performance"
    },
    {
      "id": 17,
      "phase": "verify",
      "name": "生成验证报告",
      "action": "write_verification_report"
    },
    {
      "id": 18,
      "phase": "deliver",
      "name": "更新技术方案文档",
      "action": "update_tech_design",
      "context_policy": "fresh"
    },
    {
      "id": 19,
      "phase": "deliver",
      "name": "补充 API 文档",
      "action": "write_api_docs"
    },
    {
      "id": 20,
      "phase": "deliver",
      "name": "编写使用文档",
      "action": "write_usage_docs"
    },
    {
      "id": 21,
      "phase": "deliver",
      "name": "代码提交",
      "action": "commit"
    },
    {
      "id": 22,
      "phase": "deliver",
      "name": "生成工作流总结",
      "action": "write_summary"
    }
  ]
}
```

---

### 🛑 Hard Stop: 方案确认（必须）

**在创建任务记忆文件前，必须展示执行计划并等待用户确认。**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 **执行计划已生成**

**任务名称**: ${task_name}
**复杂度**: ${complexity}
**预估时间**: ${estimated_time}
**总步骤数**: ${total_steps}

## 执行阶段

### 分析阶段 (Analyze)
${analyzeSteps.map(s => `- [ ] ${s.name}`).join('\n')}

### 设计阶段 (Design)
${designSteps.map(s => `- [ ] ${s.name}`).join('\n')}

### 实现阶段 (Implement)
${implementSteps.map(s => `- [ ] ${s.name}`).join('\n')}

### 验证阶段 (Verify)
${verifySteps.map(s => `- [ ] ${s.name}`).join('\n')}

### 交付阶段 (Deliver)
${deliverSteps.map(s => `- [ ] ${s.name}`).join('\n')}

## 质量门控
${qualityGates.map(g => `- ${g.name}: 阈值 ${g.threshold}%`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## **是否继续执行此方案？(Y/N)**

⚠️ **Hard Stop** - 工作流已暂停，等待您的确认。

请回复：
- **Y** 或 **是** - 确认方案，开始执行
- **N** 或 **否** - 终止并修改方案

[立即终止回复，禁止继续执行任何操作]
```

**说明**：
- 🛑 **强制确认**：必须等待用户明确回复 Y 才能继续
- 📋 **信息完整**：展示所有阶段、步骤、质量门控
- ⚠️ **可调整**：用户可以在确认前要求修改方案
- 🔄 **可重新生成**：用户可以选择 N 重新分析需求

---

### Step 3：创建任务记忆文件

**文件路径**：`.claude/workflow-memory.json`

```json
{
  "task_name": "多租户权限管理",
  "task_description": "实现多租户权限管理系统，支持租户隔离和 RBAC 权限模型",
  "complexity": "complex",
  "estimated_time": "> 2天",
  "started_at": "2025-01-19T10:00:00Z",
  "updated_at": "2025-01-19T10:00:00Z",
  "current_step_id": 1,
  "total_steps": 22,
  "status": "in_progress",

  "steps": [
    {
      "id": 1,
      "phase": "analyze",
      "name": "加载项目上下文",
      "description": "快速了解相关代码结构，识别技术栈和架构约束",
      "action": "context_load",
      "status": "pending",
      "estimated_time": "5分钟",
      "depends_on": [],
      "output_artifacts": [".claude/context-summary-{{task_name}}.md"]
    },
    {
      "id": 2,
      "phase": "analyze",
      "name": "深度需求分析",
      "description": "拆解复杂需求为可执行的功能点，识别依赖关系和风险",
      "action": "analyze_requirements",
      "status": "pending",
      "estimated_time": "10分钟",
      "depends_on": [1],
      "output_artifacts": ["需求分析结果记录到 workflow-memory.json"]
    },
    {
      "id": 10,
      "phase": "implement",
      "name": "实现核心功能模块",
      "description": "按技术方案实施编码",
      "action": "code",
      "status": "pending",
      "estimated_time": "2小时",
      "depends_on": [9],
      "context_policy": "fresh",
      "output_artifacts": ["修改的代码文件"]
    }
    // ... 更多步骤
  ],

  "requirements": {
    "summary": "实现多租户权限管理系统，支持租户隔离和基于 RBAC 的权限模型",
    "acceptanceCriteria": [
      "用户只能访问所属租户的数据",
      "支持 RBAC 权限模型（用户-角色-权限）",
      "超级管理员可以跨租户管理"
    ],
    "nonFunctional": [
      "权限检查响应时间 < 50ms",
      "支持 1000+ 并发用户"
    ],
    "openQuestions": [],
    "businessContext": [
      "SaaS 平台需要支持多个企业客户独立使用",
      "不同租户的数据必须完全隔离"
    ]
  },

  "userPreferences": {
    "libraries": {
      "avoid": [],
      "prefer": []
    },
    "codingStyleOverrides": {},
    "communication": {
      "explanationLevel": "medium",
      "language": "zh-CN"
    }
  },

  "domainContext": {
    "businessGoals": [],
    "glossary": [],
    "constraints": []
  },

  "artifacts": {
    "context_summary": null,
    "tech_design": null,
    "verification_report": null,
    "api_docs": null,
    "usage_docs": null,
    "workflow_summary": null
  },

  "quality_gates": {
    "codex_design_review": {
      "step_id": 8,
      "threshold": 80,
      "actual_score": null,
      "passed": null
    },
    "codex_code_review": {
      "step_id": 13,
      "threshold": 80,
      "actual_score": null,
      "passed": null
    }
  },

  "decisions": [
    {
      "id": "D-001",
      "title": "使用中间件模式注入租户上下文",
      "summary": "在请求级别注入租户信息，所有下游服务自动获取",
      "rationale": ["符合现有架构模式", "减少代码侵入"],
      "status": "accepted",
      "madeAtStep": "design",
      "timestamp": "2025-01-19T11:00:00Z"
    }
  ],

  "issues": [
    {
      "id": "I-001",
      "title": "现有 User 表缺少 tenant_id 字段",
      "description": "需要数据库迁移",
      "impact": "中",
      "status": "open",
      "workaround": "",
      "foundAtStep": "analyze",
      "timestamp": "2025-01-19T10:30:00Z"
    }
  ],

  "meta": {
    "version": 2,
    "lastUpdatedAt": "2025-01-19T11:30:00Z"
  }
}
```

### Step 4：提示用户开始执行

```markdown
✅ 工作流已启动！

**任务名称**：{{task_name}}
**复杂度**：{{complexity}}
**预计耗时**：{{estimated_time}}
**总步骤数**：{{total_steps}}

📋 **执行计划**：
- 阶段1：需求分析（{{steps_count}}个步骤）
- 阶段2：技术方案设计 + Codex 审查（{{steps_count}}个步骤）⭐
- 阶段3：开发实施（{{steps_count}}个步骤）
- 阶段4：质量验证 + Codex 审查（{{steps_count}}个步骤）⭐
- 阶段5：文档与交付（{{steps_count}}个步骤）

🎯 **质量关卡**：
- Codex 方案审查（步骤8）：评分需 ≥ 80
- Codex 代码审查（步骤13）：评分需 ≥ 80

📁 **任务记忆已保存**：`.claude/workflow-memory.json`

---

## 🚀 下一步

执行命令开始第一步：
\```bash
/workflow-execute
\```

**提示**：
- 可以在当前对话中连续执行
- 建议在新对话中执行关键步骤（如 Codex 审查），避免上下文消耗
- 随时可以执行 `/workflow-status` 查看进度
- 每次执行 `/workflow-execute` 会自动执行下一个未完成的步骤
```

---

## 💡 示例输出

### 简单任务

```
✅ 工作流已启动！

**任务名称**：简单权限验证
**复杂度**：简单
**预计耗时**：< 1天
**总步骤数**：5

📋 执行计划：
1. ⏸️ 快速上下文收集（10分钟）
2. ⏸️ 直接编码实现（30分钟）
3. ⏸️ 编写单元测试（15分钟）
4. ⏸️ 运行验证（5分钟）
5. ⏸️ 代码提交（5分钟）

💡 这是一个简单任务，可以在一个对话中完成所有步骤。

🚀 执行命令：/workflow-execute
```

### 复杂任务

```
✅ 工作流已启动！

**任务名称**：多租户权限管理
**复杂度**：复杂
**预计耗时**：> 2天
**总步骤数**：22

📋 执行计划：
- 阶段1：需求分析（3个步骤）
- 阶段2：技术方案设计 + Codex 审查（6个步骤）⭐
- 阶段3：开发实施（3个步骤）
- 阶段4：质量验证 + Codex 审查（7个步骤）⭐
- 阶段5：文档与交付（5个步骤）

🎯 质量关卡：
- ⚠️ Codex 方案审查（步骤8）：评分需 ≥ 80，否则无法继续
- ⚠️ Codex 代码审查（步骤13）：评分需 ≥ 80，否则无法交付

💡 建议执行方式：
- 阶段1-2：在当前对话中执行（约30-40分钟）
- 阶段3：在新对话中执行（主要开发时间）
- 阶段4-5：在新对话中执行（约1-2小时）

🚀 执行命令：/workflow-execute
```

---

## 🔄 与其他命令的关系

```bash
# 启动工作流（通用）
/workflow-start "功能需求"

# 启动工作流（后端，从 PRD 开始）
/workflow-start --backend "docs/prd.md"

# 执行下一步（可重复调用）
/workflow-execute

# 查看当前状态
/workflow-status

# 跳过当前步骤（高级用法，慎用）
/workflow-skip-step

# 重做当前步骤
/workflow-retry-step
```

---

## ⚙️ 高级选项

### 自定义步骤清单

如果自动生成的步骤不符合需求，可以手动编辑 `workflow-memory.json`：

```bash
# 编辑步骤清单
# 可以添加、删除、修改步骤
# 注意保持 JSON 格式正确
```

### 强制使用特定复杂度模板

```bash
# 在需求描述中添加提示
/workflow-start "简单权限验证 [complexity:simple]"
/workflow-start "复杂功能 [complexity:complex]"
```

---

## 🔒 任务保护机制

### 自动备份

**启动新任务前会自动检测现有任务**：

1. **未完成的任务**：
   - 自动备份到 `.claude/workflow-memory-backup-{timestamp}.json`
   - 询问用户：继续旧任务 / 开始新任务（备份） / 取消操作
   - 防止意外覆盖未完成的工作

2. **已完成的任务**：
   - 自动归档到 `.claude/workflow-memory-completed-{timestamp}.json`
   - 直接创建新任务

### 恢复备份任务

```bash
# 查看所有备份
ls -lh .claude/workflow-memory-*.json

# 恢复特定备份（替换当前任务）
cp .claude/workflow-memory-backup-1737123456789.json .claude/workflow-memory.json

# 查看备份内容（确认是否是需要恢复的任务）
cat .claude/workflow-memory-backup-1737123456789.json | grep -E '"task_name"|"status"|"current_step_id"|"total_steps"'

# 恢复后继续执行
/workflow-execute
```

### 清理旧备份

```bash
# 查看备份文件大小
ls -lh .claude/workflow-memory-*.json

# 删除旧的已完成任务备份
rm .claude/workflow-memory-completed-*.json

# 保留最近的备份，删除旧备份
# (手动确认后执行)
```

---

## 📖 相关文档

```bash
# 查看当前任务记忆
cat .claude/workflow-memory.json

# 查看详细使用指南
cat .claude/workflow-two-command-guide.md

# 查看工作流总览
cat .claude/workflow-summary.md
```

---

# 📦 后端工作流（--backend 模式）

当使用 `--backend` 参数时，执行后端专用工作流：从 PRD 文档出发，依次生成需求分析文档（xq.md）、方案设计文档（fasj.md）、工作流执行计划。

## 后端工作流特点

- 每生成一个文档后暂停，等待用户审查修改
- 与 Codex 协作讨论，确保需求理解和方案设计的准确性
- 文档存储在项目级目录，便于团队共享

## 后端工作流执行流程

```
PRD.md → xq.md（需求分析）→ fasj.md（方案设计）→ workflow-memory.json（执行计划）
           ↓                    ↓
        暂停审查              暂停审查
```

### Backend Step 1：检查后端配置

```typescript
// 检查 backend 配置是否存在
if (!config.backend || !config.backend.fasjSpecPath) {
  console.log(`⚠️ 未配置方案设计规范路径`);

  // 询问用户配置方式
  const answer = await AskUserQuestion({
    questions: [{
      question: "请选择方案设计规范的配置方式",
      header: "规范配置",
      multiSelect: false,
      options: [
        { label: "输入规范路径", description: "提供已有的方案设计规范文档路径" },
        { label: "使用默认模板", description: "使用内置的后端方案设计规范模板" },
        { label: "取消", description: "取消当前操作" }
      ]
    }]
  });

  // 根据选择更新配置...
}
```

### Backend Step 2：解析 PRD 并与 Codex 讨论

```typescript
const prdContent = readFile(prdPath);
const baseName = path.basename(prdPath, '.md').replace(/-prd$/, '');

// 与 Codex 讨论需求理解
const codexResult = await mcp__codex__codex({
  PROMPT: `请帮我分析这份后端 PRD 文档，重点关注：
    1. 需求边界：哪些是本次迭代必须做的？
    2. 业务流程：核心用例的主成功路径和异常路径
    3. 数据需求：需要哪些核心实体？
    4. 非功能需求：性能、安全、可用性的具体要求
    5. 风险点：可能的歧义、遗漏、依赖问题

    PRD 内容：
    ${prdContent}`,
  sandbox: "read-only"
});
```

### Backend Step 3：生成 xq.md 并暂停

生成需求分析文档后，工作流暂停等待用户审查：

```markdown
⏸️ 工作流已暂停 - 等待审查

**当前进度**：1 / 10（需求分析已完成）

📄 已生成文档：.claude/docs/{baseName}-xq.md

📝 请执行以下操作：
1. 审查文档：cat .claude/docs/{baseName}-xq.md
2. 修改文档（如需要）
3. 继续执行：/workflow-execute
```

### Backend Step 4-5：生成 fasj.md 并 Codex 审查

继续执行后，根据 xq.md 和方案设计规范生成技术方案，然后进行 Codex 审查。

### 后端工作流步骤清单（10步）

| 步骤 | 阶段 | 名称 | 说明 |
|------|------|------|------|
| 1 | analyze | 生成需求分析文档 | 输出 xq.md |
| 2 | analyze | 审查需求分析文档 | ⏸️ 暂停等待用户 |
| 3 | design | 生成方案设计文档 | 输出 fasj.md |
| 4 | design | Codex 方案审查 | 质量关卡 ≥80 |
| 5 | design | 审查并修订方案 | ⏸️ 暂停等待用户 |
| 6 | implement | 生成实施计划 | 拆解工作项 |
| 7 | implement | 执行开发任务 | 编码实现 |
| 8 | verify | 自测与验证 | 运行测试 |
| 9 | verify | Codex 代码审查 | 质量关卡 ≥80 |
| 10 | deliver | 完善文档并总结 | 输出总结 |

## 后端文档结构

### xq.md 需求分析文档

```markdown
# 后端需求分析 - {模块名称}

## 0. 元信息
## 1. 背景与业务目标
## 2. 范围与边界（In Scope / Out of Scope）
## 3. 角色与主体
## 4. 关键业务流程与用例
## 5. 功能需求拆解（FR-01, FR-02, ...）
## 6. 非功能需求
## 7. 数据与接口线索
## 8. 风险、依赖与假设
## 9. 验收标准
## 10. Codex 协作记录
```

### fasj.md 方案设计文档

```markdown
# 后端技术方案 - {模块名称}

## 0. 元信息
## 1. 设计目标与原则
## 2. 架构与边界
## 3. 模块与职责划分
## 4. 数据模型设计
## 5. 接口设计（API 契约）
## 6. 业务流程与状态设计
## 7. 非功能设计
## 8. 数据迁移与兼容性
## 9. 实施计划（工作项列表）
## 10. 测试与验收方案
## 11. Codex 审查记录
```

## 后端配置说明

在 `project-config.json` 中配置：

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

## 后端工作流示例

```bash
# 1. 启动后端工作流
/workflow-start --backend "docs/payment-prd.md"

# 输出：
# ✅ 需求分析文档已生成：.claude/docs/payment-xq.md
# ⏸️ 工作流已暂停 - 等待审查

# 2. 审查 xq.md 并修改
cat .claude/docs/payment-xq.md
# （手动编辑文件）

# 3. 继续执行，生成 fasj.md
/workflow-execute

# 4. 审查 fasj.md 并修改
cat .claude/docs/payment-fasj.md

# 5. 继续执行，开始开发
/workflow-execute
```
