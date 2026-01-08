---
description: 启动智能工作流 - 分析需求并生成详细执行计划
argument-hint: "[-y] [-f] \"功能需求描述\" 或 --file \"PRD文档路径\""
allowed-tools: Task(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*), TaskOutput(*), mcp__auggie-mcp__codebase-retrieval(*), AskUserQuestion(*)
---

# 智能工作流启动（v2）

三阶段强制流程：**需求 → 设计 → 任务**

```
需求文档 ──▶ 代码分析 ──▶ tech-design.md ──▶ tasks.md ──▶ 执行
                │              │                │
                │         🛑 确认设计       🛑 确认任务
                │
           codebase-retrieval
```

## 规格引用

| 模块 | 路径 | 说明 |
|------|------|------|
| 状态机 | `specs/workflow/state-machine.md` | 状态文件结构 |
| 任务解析 | `specs/workflow/task-parser.md` | Task 接口定义 |
| 质量关卡 | `specs/workflow/quality-gate.md` | 关卡任务标记 |

---

## 🎯 执行流程

### Step 0：解析参数

```typescript
const args = $ARGUMENTS.join(' ');
let requirement = '';
let isBackendMode = false;
let autoConfirm = false;      // --yes / -y: 跳过确认对话框
let forceOverwrite = false;   // --force / -f: 强制覆盖已有文件

// 解析标志
const flags = args.match(/--(?:yes|force|backend|file)|-[yf]/g) || [];
autoConfirm = flags.some(f => f === '--yes' || f === '-y');
forceOverwrite = flags.some(f => f === '--force' || f === '-f');
isBackendMode = flags.some(f => f === '--backend' || f === '--file');

// 移除标志，获取需求内容
requirement = args
  .replace(/--(?:yes|force|backend|file)|-[yf]/g, '')
  .replace(/^["']|["']$/g, '')
  .trim();

if (!requirement) {
  console.log(`
❌ 请提供需求描述

用法：
  /workflow-start "实现用户认证功能"
  /workflow-start --file "docs/prd.md"
  /workflow-start -y "快速启动，跳过确认"
  /workflow-start -f "强制覆盖已有文件"
  `);
  return;
}

// 检测是否是文件路径
let requirementSource = 'inline';
let requirementContent = requirement;

if (requirement.endsWith('.md') && fileExists(requirement)) {
  requirementSource = requirement;
  requirementContent = readFile(requirement);
  console.log(`📄 需求文档：${requirement}\n`);
} else if (isBackendMode) {
  console.log(`⚠️ --backend 模式但文件不存在：${requirement}`);
  return;
} else {
  console.log(`📝 需求描述：${requirement}\n`);
}
```

---

### Step 1：项目配置检查（强制）

```typescript
const configPath = '.claude/config/project-config.json';

if (!fileExists(configPath)) {
  console.log(`
🚨 项目配置不存在，无法启动工作流

🔧 请先执行扫描命令：/scan
  `);
  return;
}

const projectConfig = JSON.parse(readFile(configPath));
const projectId = projectConfig.project?.id;

if (!projectId) {
  console.log(`🚨 项目配置缺少 project.id，请重新执行 /scan`);
  return;
}

console.log(`✅ 项目配置有效
📋 项目名称: ${projectConfig.project.name}
🆔 项目 ID: ${projectId}
`);
```

---

### Step 2：检测现有任务

```typescript
// 路径安全校验：projectId 只允许字母数字和连字符
if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
  console.log(`🚨 项目 ID 包含非法字符: ${projectId}`);
  return;
}

const workflowDir = path.join(os.homedir(), '.claude/workflows', projectId);
const statePath = path.join(workflowDir, 'workflow-state.json');

if (fileExists(statePath)) {
  const existingState = JSON.parse(readFile(statePath));

  if (existingState.status !== 'completed') {
    const backupPath = path.join(workflowDir, `backup-${Date.now()}.json`);
    copyFile(statePath, backupPath);

    // autoConfirm 时自动选择"开始新任务"
    let choice = autoConfirm ? "开始新任务" : null;

    if (!choice) {
      choice = await AskUserQuestion({
        questions: [{
          question: `检测到未完成的任务"${existingState.task_name}"，如何处理？`,
          header: "任务冲突",
          multiSelect: false,
          options: [
            { label: "继续旧任务", description: "放弃新任务，继续执行之前的任务" },
            { label: "开始新任务", description: `旧任务已备份到 ${backupPath}` },
            { label: "取消", description: "不做任何更改" }
          ]
        }]
      });
    } else {
      console.log(`⚡ 自动选择：开始新任务（旧任务已备份到 ${backupPath}）`);
    }

    if (choice === "继续旧任务") {
      console.log(`✅ 继续执行任务"${existingState.task_name}"\n🚀 执行命令：/workflow-execute`);
      return;
    }
    if (choice === "取消") {
      console.log("✅ 操作已取消");
      return;
    }
  }
}
```

---

### Phase 0：代码分析（强制）⚠️

**目的**：在设计前充分理解代码库

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Phase 0: 代码分析
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 使用 codebase-retrieval 分析相关代码
const codeContext = await mcp__auggie-mcp__codebase-retrieval({
  information_request: `
    分析与以下需求相关的代码：

    需求：${requirementContent}

    请提供：
    1. 相关现有实现文件（可复用或需修改）
    2. 可继承的基类、可复用的工具类
    3. 相似功能的实现参考（作为模式参考）
    4. 技术约束（数据库、框架、规范、错误处理模式）
    5. 需要注意的依赖关系
  `
});

// 解析代码分析结果
const analysisResult = {
  relatedFiles: extractRelatedFiles(codeContext),
  reusableComponents: extractReusableComponents(codeContext),
  patterns: extractPatterns(codeContext),
  constraints: extractConstraints(codeContext),
  dependencies: extractDependencies(codeContext)
};

console.log(`
✅ 代码分析完成

📁 相关文件：${analysisResult.relatedFiles.length} 个
🔧 可复用组件：${analysisResult.reusableComponents.length} 个
📐 架构模式：${analysisResult.patterns.length} 个
⚠️ 技术约束：${analysisResult.constraints.length} 个
`);
```

---

### Phase 1：生成技术方案（强制）⚠️

**目的**：在拆分任务前明确架构决策

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Phase 1: 生成技术方案
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 生成任务名称
const taskName = generateTaskName(requirementContent);
const sanitizedName = sanitize(taskName);

// 技术方案路径
const techDesignPath = `.claude/tech-design/${sanitizedName}.md`;
ensureDir('.claude/tech-design');

// 检查是否已存在技术方案
let existingChoice = null;
if (fileExists(techDesignPath)) {
  // forceOverwrite 时自动选择"重新生成"
  // autoConfirm 时自动选择"使用现有方案"
  if (forceOverwrite) {
    existingChoice = "重新生成";
    console.log(`⚡ 强制覆盖：${techDesignPath}`);
  } else if (autoConfirm) {
    existingChoice = "使用现有方案";
    console.log(`⚡ 使用现有技术方案：${techDesignPath}`);
  } else {
    existingChoice = await AskUserQuestion({
      questions: [{
        question: `技术方案已存在：${techDesignPath}，如何处理？`,
        header: "文件冲突",
        multiSelect: false,
        options: [
          { label: "使用现有方案", description: "跳过生成，直接使用已有的技术方案" },
          { label: "重新生成", description: "覆盖现有方案（原文件将丢失）" },
          { label: "取消", description: "停止工作流启动" }
        ]
      }]
    });

    if (existingChoice === "取消") {
      console.log("✅ 操作已取消");
      return;
    }

    if (existingChoice === "使用现有方案") {
      console.log(`✅ 使用现有技术方案：${techDesignPath}`);
      // 跳过生成，直接进入 Hard Stop 1
    }
  }
}

// 只在需要时生成技术方案
if (!fileExists(techDesignPath) || existingChoice === "重新生成") {
  // 预渲染复杂内容为字符串
  const relatedFilesTable = analysisResult.relatedFiles.length > 0
    ? analysisResult.relatedFiles.map(f =>
        `| \`${f.path}\` | ${f.purpose} | ${f.reuseType} |`
      ).join('\n')
    : '| - | - | - |';

  const patternsContent = analysisResult.patterns.length > 0
    ? analysisResult.patterns.map(p => `- **${p.name}**: ${p.description}`).join('\n')
    : '（未检测到）';

  const constraintsContent = analysisResult.constraints.length > 0
    ? analysisResult.constraints.map(c => `- ${c}`).join('\n')
    : '（无特殊约束）';

  // 尝试加载模板文件
  const techDesignTemplate = loadTemplate('tech-design-template.md');

  let techDesignContent: string;

  if (techDesignTemplate) {
    // 使用简单变量替换
    techDesignContent = replaceVars(techDesignTemplate, {
      requirement_source: requirementSource,
      created_at: new Date().toISOString(),
      task_name: taskName,
      requirement_summary: requirementContent,
      related_files_table: relatedFilesTable,
      existing_patterns: patternsContent,
      constraints: constraintsContent,
      module_structure: '（请根据需求补充模块结构）',
      data_models: '（请根据需求补充数据模型）',
      interface_design: '（请根据需求补充接口设计）',
      implementation_plan: '| 1 | （待补充） | `（待补充）` | - |',
      risks: '| （待评估） | - | - |',
      acceptance_criteria: '（从需求文档提取或补充）'
    });
  } else {
    // 模板缺失时使用简洁的内联生成
    techDesignContent = `---
version: 1
requirement_source: "${requirementSource}"
created_at: "${new Date().toISOString()}"
status: draft
---

# 技术方案: ${taskName}

## 1. 需求摘要

${requirementContent}

## 2. 代码分析结果

### 2.1 相关现有代码

| 文件 | 用途 | 复用方式 |
|------|------|----------|
${relatedFilesTable}

### 2.2 现有架构模式

${patternsContent}

### 2.3 技术约束

${constraintsContent}

## 3. 架构设计

### 3.1 模块划分

\`\`\`
（请根据需求补充模块结构）
\`\`\`

### 3.2 数据模型

\`\`\`typescript
（请根据需求补充数据模型）
\`\`\`

### 3.3 接口设计

\`\`\`typescript
（请根据需求补充接口设计）
\`\`\`

## 4. 实施计划

| 序号 | 任务 | 文件 | 依赖 |
|------|------|------|------|
| 1 | （待补充） | \`（待补充）\` | - |

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| （待评估） | - | - |

## 6. 验收标准

（从需求文档提取或补充）
`;
  }

  writeFile(techDesignPath, techDesignContent);

  console.log(`
✅ 技术方案草稿已生成

📄 文件路径：${techDesignPath}

⚠️ 请完善以下章节：
  - 3.1 模块划分
  - 3.2 数据模型
  - 3.3 接口设计
  - 4. 实施计划
  - 5. 风险与缓解
`);
}  // 结束 if (!fileExists || 重新生成)
```

---

### 🛑 Hard Stop 1：设计方案确认

```typescript
// autoConfirm 时跳过设计确认，直接继续
let designChoice = autoConfirm ? "继续拆分任务" : null;

if (!designChoice) {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛑 **设计方案确认**

📄 技术方案：${techDesignPath}

请选择下一步操作：

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  designChoice = await AskUserQuestion({
    questions: [{
      question: "如何处理技术方案？",
      header: "设计确认",
      multiSelect: false,
      options: [
        { label: "继续拆分任务", description: "方案已完善，基于此方案生成任务清单" },
        { label: "Codex 审查", description: "让 Codex 审查方案后再决定" },
        { label: "手动编辑后继续", description: "暂停，手动完善方案后重新执行" }
      ]
    }]
  });
} else {
  console.log(`⚡ 自动继续：跳过设计确认`);
}

if (designChoice === "手动编辑后继续") {
  console.log(`
⏸️ 工作流已暂停

请完善技术方案后重新执行：
  1. 编辑文件：${techDesignPath}
  2. 重新启动：/workflow-start "${requirement}"
  `);
  return;
}

if (designChoice === "Codex 审查") {
  // 调用 Codex 审查 - 使用临时文件避免 heredoc 注入
  const tempFile = `/tmp/codex-review-${Date.now()}.txt`;
  const reviewPrompt = `ROLE_FILE: ~/.claude/prompts/codex/reviewer.md

<TASK>
请审查以下技术方案文档：

${readFile(techDesignPath)}

请重点关注：
1. 架构设计是否合理
2. 模块划分是否清晰
3. 接口设计是否完整
4. 实施计划是否可行
5. 风险评估是否充分

请提供评分和改进建议。
</TASK>

OUTPUT: DESIGN REVIEW REPORT 格式。`;
  writeFile(tempFile, reviewPrompt);

  const codexResult = await Bash({
    command: `codeagent-wrapper --backend codex - ${process.cwd()} < "${tempFile}"`,
    run_in_background: true
  });

  const codexOutput = await TaskOutput({ task_id: codexResult.task_id, block: true });

  // 清理临时文件
  await Bash({ command: `rm -f "${tempFile}"` });

  // 追加审查结果
  appendFile(techDesignPath, `\n\n## 7. Codex 审查记录\n\n${codexOutput}`);

  const score = extractScore(codexOutput);

  if (score < 70) {
    console.log(`
⚠️ Codex 评分：${score}/100（建议 ≥70）

请根据审查意见完善方案后重新执行。
    `);
    return;
  }

  console.log(`✅ Codex 评分：${score}/100，继续拆分任务`);
}
```

---

### Phase 2：基于设计生成任务清单

> ⚠️ **强制要求**：必须生成 `tasks-*.md` 文件到 `~/.claude/workflows/{projectId}/` 目录。
> **禁止**使用 `TodoWrite` 工具替代此步骤。`TodoWrite` 仅用于 Claude 内部进度跟踪，不是工作流任务文档。

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Phase 2: 基于设计生成任务清单
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 读取完善后的技术方案
const techDesign = readFile(techDesignPath);

// 从技术方案提取实施计划
const implementationPlan = extractImplementationPlan(techDesign);

// 为每个任务补充详细信息
const tasks = implementationPlan.map((item, index) => ({
  id: `T${index + 1}`,
  name: item.task,
  phase: determinePhase(item),
  file: item.file,
  leverage: findLeverage(item.file, analysisResult.reusableComponents),
  design_ref: item.section || `4.${index + 1}`,
  requirement: item.description || item.task,
  actions: determineActions(item),
  depends: item.depends ? `T${item.depends}` : null,
  quality_gate: item.isQualityGate || false,
  threshold: item.threshold || 80,
  status: 'pending'
}));

// 添加标准质量关卡（如果没有）
if (!tasks.some(t => t.quality_gate)) {
  const lastImplTask = tasks.filter(t => t.phase === 'implement').pop();
  if (lastImplTask) {
    tasks.push({
      id: `T${tasks.length + 1}`,
      name: 'Codex 代码审查',
      phase: 'verify',
      file: null,
      leverage: null,
      design_ref: null,
      requirement: `审查 ${lastImplTask.id} 及之前的代码实现`,
      actions: 'codex_review',
      depends: lastImplTask.id,
      quality_gate: true,
      threshold: 80,
      status: 'pending'
    });
  }
}

// 添加提交任务
tasks.push({
  id: `T${tasks.length + 1}`,
  name: '提交代码',
  phase: 'deliver',
  file: null,
  leverage: null,
  design_ref: null,
  requirement: '规范 commit message，确保 CI 通过',
  actions: 'git_commit',
  depends: `T${tasks.length}`,
  quality_gate: false,
  status: 'pending'
});

// 生成 tasks.md
const tasksPath = path.join(workflowDir, `tasks-${sanitizedName}.md`);

// 预渲染复杂内容
const constraintsMarkdown = analysisResult.constraints.length > 0
  ? analysisResult.constraints.map(c => `- ${c}`).join('\n')
  : '（无特殊约束）';

const acceptanceCriteria = extractAcceptanceCriteria(techDesign);
const acceptanceMarkdown = acceptanceCriteria.length > 0
  ? acceptanceCriteria.map((ac, i) => `- [ ] AC${i + 1}: ${ac}`).join('\n')
  : '- [ ] AC1: （待定义）';

// 渲染任务列表
const tasksMarkdown = tasks.map(t => `
## ${t.id}: ${t.name}
<!-- id: ${t.id}, design_ref: ${t.design_ref || 'N/A'} -->
- **阶段**: ${t.phase}
${t.file ? `- **文件**: \`${t.file}\`` : ''}
${t.leverage ? `- **复用**: \`${t.leverage}\`` : ''}
${t.design_ref ? `- **设计参考**: tech-design.md § ${t.design_ref}` : ''}
- **需求**: ${t.requirement}
- **actions**: \`${t.actions}\`
${t.depends ? `- **依赖**: ${t.depends}` : ''}
${t.quality_gate ? `- **质量关卡**: true\n- **阈值**: ${t.threshold}` : ''}
- **状态**: ${t.status}
`).join('\n');

// 尝试加载模板文件
const tasksTemplate = loadTemplate('tasks-template.md');

let tasksContent: string;

if (tasksTemplate) {
  // 使用简单变量替换
  tasksContent = replaceVars(tasksTemplate, {
    tech_design_path: techDesignPath,
    created_at: new Date().toISOString(),
    task_name: taskName,
    constraints: constraintsMarkdown,
    acceptance_criteria: acceptanceMarkdown,
    tasks: tasksMarkdown
  });
} else {
  // 模板缺失时使用简洁的内联生成
  tasksContent = `---
version: 1
tech_design: "${techDesignPath}"
created_at: "${new Date().toISOString()}"
---

# Tasks: ${taskName}

## 设计文档

📄 \`${techDesignPath}\`

## 约束（从设计文档继承）

${constraintsMarkdown}

## 验收标准

${acceptanceMarkdown}

---

${tasksMarkdown}
`;
}

ensureDir(workflowDir);
writeFile(tasksPath, tasksContent);

console.log(`
✅ 任务清单已生成

📄 文件路径：${tasksPath}
📊 任务数量：${tasks.length}

${tasks.map(t => `- [ ] ${t.id}: ${t.name} (${t.phase})`).join('\n')}
`);
```

---

### 🛑 Hard Stop 2：任务清单确认

```typescript
// autoConfirm 时跳过任务清单确认，直接开始执行
let executeChoice = autoConfirm ? "开始执行" : null;

if (!executeChoice) {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛑 **任务清单确认**

📄 技术方案：${techDesignPath}
📋 任务清单：${tasksPath}
📊 任务数量：${tasks.length}

**是否开始执行？**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  executeChoice = await AskUserQuestion({
    questions: [{
      question: "是否开始执行任务？",
      header: "执行确认",
      multiSelect: false,
      options: [
        { label: "开始执行", description: "确认任务清单，开始执行第一个任务" },
        { label: "编辑后执行", description: "暂停，手动调整任务后执行 /workflow-execute" },
        { label: "取消", description: "取消工作流" }
      ]
    }]
  });
} else {
  console.log(`⚡ 自动继续：开始执行任务`);
}

if (executeChoice === "取消") {
  console.log("✅ 工作流已取消");
  return;
}
```

---

### Step 3：创建工作流状态

```typescript
// 创建精简的 workflow-state.json
const state = {
  task_name: taskName,
  tech_design: techDesignPath,
  tasks_file: `tasks-${sanitizedName}.md`,
  current_task: "T1",
  status: "in_progress",
  phase: "execute",
  execution_mode: "phase",        // step | phase | quality_gate（默认阶段模式）
  pause_before_commit: true,      // git_commit 前始终暂停确认
  use_subagent: tasks.length > 5, // 任务数 > 5 时自动启用 subagent 模式
  started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  progress: {
    completed: [],
    skipped: [],
    failed: []
  },
  quality_gates: tasks
    .filter(t => t.quality_gate)
    .reduce((acc, t) => ({
      ...acc,
      [t.name.replace(/\s+/g, '_').toLowerCase()]: {
        task_id: t.id,
        threshold: t.threshold,
        actual_score: null,
        passed: null
      }
    }), {}),
  artifacts: {
    tech_design: techDesignPath
  }
};

writeFile(statePath, JSON.stringify(state, null, 2));

// 保存项目元数据
const metaPath = path.join(workflowDir, 'project-meta.json');
if (!fileExists(metaPath)) {
  writeFile(metaPath, JSON.stringify({
    project_id: projectId,
    project_path: process.cwd(),
    project_name: projectConfig.project.name,
    created_at: new Date().toISOString()
  }, null, 2));
}

console.log(`
✅ 工作流已启动！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**任务名称**：${taskName}
**技术方案**：${techDesignPath}
**任务清单**：${tasksPath}
**任务数量**：${tasks.length}

**文件结构**：
.claude/
└── tech-design/
    └── ${sanitizedName}.md    ← 技术方案

~/.claude/workflows/${projectId}/
├── workflow-state.json        ← 运行时状态
└── tasks-${sanitizedName}.md  ← 任务清单

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **下一步**

${executeChoice === "开始执行" ? '自动开始执行第一个任务...' : `
执行命令开始：
\`\`\`bash
/workflow-execute
\`\`\`
`}
`);

if (executeChoice === "开始执行") {
  // 自动执行第一个任务
  await executeCommand('/workflow-execute');
}
```

---

## 📦 辅助函数

```typescript
function sanitize(name: string): string {
  return name
    .normalize('NFKD')                           // Unicode 规范化
    .replace(/[\u4e00-\u9fa5]/g, '')              // 移除中文字符（确保 ASCII-only）
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')                  // 只保留字母数字
    .replace(/^-|-$/g, '')
    .substring(0, 50) || 'workflow';              // 空时兜底
}

/**
 * 读取模板文件
 * 优先级：用户目录 > 仓库模板目录
 * 不再有内置模板回退，模板缺失时快速失败
 */
function loadTemplate(templateName: string): string {
  // 1. 用户覆盖（优先）
  const userPath = path.join(os.homedir(), '.claude/docs', templateName);
  if (fileExists(userPath)) {
    return readFile(userPath);
  }

  // 2. 仓库模板（默认）
  const repoPath = path.join(process.cwd(), 'templates/docs', templateName);
  if (fileExists(repoPath)) {
    return readFile(repoPath);
  }

  // 3. 快速失败
  console.log(`⚠️ 模板文件不存在：${templateName}`);
  console.log(`  尝试路径：${userPath}`);
  console.log(`  尝试路径：${repoPath}`);
  return '';
}

/**
 * 简单变量替换（仅支持 {{variable}}）
 * 不支持循环和条件，复杂内容应预渲染为字符串
 */
function replaceVars(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    data[key] !== undefined ? data[key] : ''
  );
}

/**
 * 细粒度阶段定义 - 避免单个 phase 任务过多导致上下文溢出
 *
 * 阶段划分原则：
 * - 每个阶段理想任务数：3-5 个
 * - 超过 5 个任务的大阶段应拆分为子阶段
 *
 * 阶段定义：
 * - design: 接口设计、架构设计、类型定义
 * - infra: 基础设施、Store、工具函数、指令、守卫
 * - ui-layout: 页面布局、路由、菜单配置
 * - ui-display: 展示组件（卡片、表格、列表）
 * - ui-form: 表单组件（弹窗、输入、选择器）
 * - ui-integrate: 组件集成、注册、组装
 * - test: 单元测试、集成测试
 * - verify: 代码审查、质量关卡
 * - deliver: 提交、发布、文档
 */
function determinePhase(item: any): string {
  const name = item.task.toLowerCase();
  const file = (item.file || '').toLowerCase();

  // 1. 设计阶段
  if (/接口|设计|interface|架构|architecture|类型|type/.test(name)) return 'design';

  // 2. 基础设施阶段（Store、工具、指令、守卫）
  if (/store|composable|hook|工具|util|helper|指令|directive|守卫|middleware|guard/.test(name) ||
      /stores\/|composables\/|utils\/|directives\/|middleware\//.test(file)) return 'infra';

  // 3. UI 布局阶段（页面、路由、菜单）
  if (/页面|page|路由|route|菜单|menu|布局|layout|主页|index/.test(name) ||
      /pages\/.*index|pages\/.*\.vue$/.test(file)) return 'ui-layout';

  // 4. UI 展示组件（卡片、表格、列表）
  if (/卡片|card|表格|table|列表|list|展示|display|筛选|filter/.test(name)) return 'ui-display';

  // 5. UI 表单组件（弹窗、表单、选择器）
  if (/弹窗|modal|dialog|表单|form|选择|select|输入|input|编辑|edit|创建|create/.test(name) ||
      /modals\/|dialogs\//.test(file)) return 'ui-form';

  // 6. UI 集成（注册、扩展、改造）
  if (/注册|register|集成|integrate|扩展|extend|改造|refactor|provider/.test(name)) return 'ui-integrate';

  // 7. 测试阶段
  if (/测试|test|单元|unit|集成|integration/.test(name)) return 'test';

  // 8. 验证阶段
  if (/审查|review|验证|verify|验收|qa|确认|check/.test(name)) return 'verify';

  // 9. 交付阶段
  if (/提交|commit|发布|release|部署|deploy|文档|doc/.test(name)) return 'deliver';

  // 默认：根据文件路径进一步判断
  if (/components\//.test(file)) return 'ui-display';  // 组件默认归类为展示

  return 'implement';  // 兜底
}

function determineActions(item: any): string {
  const phase = determinePhase(item);
  switch (phase) {
    case 'design': return 'create_file';
    case 'implement': return 'create_file,edit_file';
    case 'test': return 'create_file,run_tests';
    case 'verify': return 'codex_review';
    case 'deliver': return 'git_commit';
    default: return 'edit_file';
  }
}

function findLeverage(file: string, reusableComponents: any[]): string | null {
  if (!file) return null;

  // 根据文件类型匹配可复用组件
  const matches = reusableComponents.filter(c => {
    if (file.includes('Service') && c.path.includes('BaseService')) return true;
    if (file.includes('Controller') && c.path.includes('BaseController')) return true;
    if (file.includes('middleware') && c.path.includes('base')) return true;
    if (file.includes('Model') && c.path.includes('BaseModel')) return true;
    return false;
  });

  return matches.map(m => m.path).join(', ') || null;
}
```

---

## 🔄 相关命令

```bash
# 执行下一步
/workflow-execute

# 查看状态
/workflow-status

# 跳过当前步骤（慎用）
/workflow-skip-step

# 重试当前步骤
/workflow-retry-step
```
