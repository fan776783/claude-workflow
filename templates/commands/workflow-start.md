---
description: 启动智能工作流 - 分析需求并生成详细执行计划
argument-hint: "\"功能需求描述\""
allowed-tools: Task(*), Read(*), Write(*), mcp__mcp-router__sequentialthinking(*), AskUserQuestion(*)
---

# 智能工作流启动

分析需求复杂度，生成详细的分步执行计划，创建任务记忆。

**配置依赖**：`.claude/config/project-config.json`（自动读取项目配置）

**工作目录**：从配置自动读取（`project.rootDir`）

**工作流状态存储**：用户级目录（`~/.claude/workflows/`），完全避免 Git 冲突 ⭐ NEW

**文档产物存储**：项目目录（`.claude/`），便于团队共享（上下文摘要、验证报告、技术方案等）

---

## 🎯 执行流程

### Step -1：项目初始化检查（前置条件）⭐

**目标**: 确保项目已初始化 Claude Workflow 配置，如果未初始化则引导执行 `/init-project-config`

**执行逻辑**:

```typescript
console.log(`🔍 检查项目配置...\n`);

const cwd = process.cwd();
const configPath = path.join(cwd, '.claude/config/project-config.json');

if (!fs.existsSync(configPath)) {
  console.log(`
⚠️ 检测到项目未初始化

📋 当前项目: ${path.basename(cwd)}
📍 项目路径: ${cwd}

🔧 需要创建 Claude Workflow 配置文件
  `);

  // 询问是否初始化
  const answer = await AskUserQuestion({
    questions: [{
      question: "项目配置文件不存在，是否执行初始化？",
      header: "项目初始化",
      multiSelect: false,
      options: [
        {
          label: "执行初始化（推荐）",
          description: "执行 /init-project-config 自动检测并生成完整配置"
        },
        {
          label: "取消",
          description: "取消当前工作流"
        }
      ]
    }]
  });

  const choice = answer.answers["项目初始化"];

  if (choice === "执行初始化（推荐）") {
    console.log(`
🚀 请执行以下命令初始化项目：

   /init-project-config

初始化完成后，重新执行：

   /workflow-start "你的需求描述"
    `);
    // 终止当前工作流，让用户先执行初始化
    return;
  } else {
    console.log(`\n❌ 工作流已取消\n`);
    return;
  }
} else {
  console.log(`✅ 项目配置已存在: ${configPath}\n`);
}
```

**说明**:
- ✅ **前置检查**: 在工作流开始前确保配置文件存在
- ✅ **引导初始化**: 缺少配置时引导执行 `/init-project-config`
- ✅ **完整检测**: `/init-project-config` 提供更全面的项目检测（微前端、可观测性等）
- ✅ **向后兼容**: 已初始化的项目直接跳过

---

### Step 0：检测现有任务并保护（必须）⚠️

#### 0.1 项目识别（自动）⭐ NEW

**基于当前工作目录（cwd）自动识别项目**：

```typescript
// 获取项目唯一标识（基于当前工作目录 hash）
function getProjectId(): string {
  const cwd = process.cwd(); // 例如：/Users/ws/dev/skymediafrontend
  const hash = crypto.createHash('md5')
    .update(cwd)
    .digest('hex')
    .substring(0, 12); // 例如：a1b2c3d4e5f6
  return hash;
}

// 获取用户级工作流路径
function getWorkflowMemoryPath(): string {
  const projectId = getProjectId();
  const workflowDir = path.join(
    os.homedir(),
    '.claude/workflows',
    projectId
  );

  // 首次使用：创建目录和元数据
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });

    // 保存项目元数据
    saveProjectMeta(projectId, {
      path: process.cwd(),
      name: path.basename(process.cwd()),
      createdAt: new Date().toISOString()
    });
  }

  return path.join(workflowDir, 'workflow-memory.json');
}

// 使用用户级路径
const memoryPath = getWorkflowMemoryPath();
// 例如：~/.claude/workflows/a1b2c3d4e5f6/workflow-memory.json
```

**优点**：
- ✅ 完全自动化 - 用户无需任何配置
- ✅ 天然隔离 - 每个开发者独立管理
- ✅ 无 Git 冲突 - 工作流状态不在项目目录
- ✅ 多项目支持 - 自动切换不同项目的状态

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
      "estimated_time": "1小时"
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
      "threshold": 80
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
      "condition": "has_ambiguity"
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
      "sub_tasks": "从技术方案提取"
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
      "threshold": 80
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
      "action": "update_tech_design"
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

### Step 3：创建任务记忆文件

**文件路径**：`.claude/workflow-memory.json`

```json
{
  "task_name": "多租户权限管理",
  "task_description": "实现多租户权限管理系统，支持租户隔离和 RBAC 权限模型",
  "complexity": "complex",
  "estimated_time": "> 2天",
  "started_at": "2025-01-19 10:00:00",
  "updated_at": "2025-01-19 10:00:00",
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
    // ... 更多步骤
  ],

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

  "decisions": [],

  "issues": []
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
# 启动工作流
/workflow-start "功能需求"

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
