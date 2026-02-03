# workflow start - 启动工作流 (v3.0)

> 精简接口：自动检测 `.md` 文件，无需 `--backend`/`--file` 参数

三阶段强制流程：**需求 → 设计 → 意图审查 → 任务**

```
需求文档 ──▶ 代码分析 ──▶ tech-design.md ──▶ Intent Review ──▶ tasks.md ──▶ 执行
                │              │                   │                │
                │         🛑 确认设计          🔍 审查意图      🛑 确认任务
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
let forceOverwrite = false;   // --force / -f: 强制覆盖已有文件

// 解析标志
const flags = args.match(/--force|-f/g) || [];
forceOverwrite = flags.some(f => f === '--force' || f === '-f');

// 移除标志，获取需求内容
requirement = args
  .replace(/--force|-f/g, '')
  .replace(/^["']|["']$/g, '')
  .trim();

if (!requirement) {
  console.log(`
❌ 请提供需求描述

用法：
  /workflow start "实现用户认证功能"
  /workflow start docs/prd.md        # 自动检测 .md 文件
  /workflow start -f "强制覆盖已有文件"
  `);
  return;
}

// 自动检测：.md 结尾且文件存在 → 文件模式
let requirementSource = 'inline';
let requirementContent = requirement;

if (requirement.endsWith('.md') && fileExists(requirement)) {
  requirementSource = requirement;
  requirementContent = readFile(requirement);
  console.log(`📄 需求文档：${requirement}\n`);
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

  if (existingState.status !== 'completed' && existingState.status !== 'planned') {
    const backupPath = path.join(workflowDir, `backup-${Date.now()}.json`);
    copyFile(statePath, backupPath);

    const choice = await AskUserQuestion({
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

    if (choice === "继续旧任务") {
      console.log(`✅ 继续执行任务"${existingState.task_name}"\n🚀 执行命令：/workflow execute`);
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
  if (forceOverwrite) {
    existingChoice = "重新生成";
    console.log(`⚡ 强制覆盖：${techDesignPath}`);
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

### Phase 1.5：Intent Review（增量变更意图审查）

> v3.0 新增：在生成任务清单前，生成 Intent 文档供用户审查变更意图

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Phase 1.5: 意图审查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 确保工作流目录存在
ensureDir(workflowDir);

// 创建 changes 目录结构
const changeId = "CHG-001";
const changesDir = path.join(workflowDir, 'changes', changeId);
ensureDir(changesDir);

// 生成 Intent 文档
const intentContent = generateIntentSummary({
  requirement: requirementContent,
  techDesign: readFile(techDesignPath),
  analysisResult: analysisResult,
  taskName: taskName,
  changeId: changeId
});

const intentPath = path.join(changesDir, 'intent.md');
writeFile(intentPath, intentContent);

console.log(`
📄 Intent 文档已生成：${intentPath}

**变更概要**：
- 变更 ID: ${changeId}
- 触发类型: new_requirement
- 影响范围: ${analysisResult.relatedFiles.length} 个文件
`);

// Hard Stop: Intent 确认
const intentChoice = await AskUserQuestion({
  questions: [{
    question: "请确认以上变更意图是否正确？",
    header: "Intent Review",
    multiSelect: false,
    options: [
      { label: "意图正确", description: "继续生成任务清单" },
      { label: "需要调整", description: "暂停，手动编辑 intent.md 后重新执行" },
      { label: "取消", description: "放弃本次变更" }
    ]
  }]
});

if (intentChoice === "取消") {
  console.log(`
❌ 变更已取消

已清理临时文件。
  `);
  // 清理 changes 目录
  await Bash({ command: `rm -rf "${changesDir}"` });
  return;
}

if (intentChoice === "需要调整") {
  console.log(`
⏸️ 工作流已暂停

请编辑 Intent 文档后重新执行：
  1. 编辑文件：${intentPath}
  2. 重新启动：/workflow start "${requirement}"
  `);
  return;
}

// 更新审查状态
const reviewStatus = {
  change_id: changeId,
  reviewed_at: new Date().toISOString(),
  status: "approved",
  reviewer: "user"
};
writeFile(path.join(changesDir, 'review-status.json'), JSON.stringify(reviewStatus, null, 2));

console.log(`✅ Intent 已批准，继续生成任务清单`);
```

---

### 🛑 Hard Stop 1：设计方案确认

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛑 **设计方案确认**

📄 技术方案：${techDesignPath}

请选择下一步操作：

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const designChoice = await AskUserQuestion({
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

if (designChoice === "手动编辑后继续") {
  console.log(`
⏸️ 工作流已暂停

请完善技术方案后重新执行：
  1. 编辑文件：${techDesignPath}
  2. 重新启动：/workflow start "${requirement}"
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

// 为每个任务补充详细信息（包含依赖分类）
const tasks = implementationPlan.map((item, index) => {
  const task = {
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
  };

  // 渐进式工作流：自动分类任务依赖
  const blockedBy = classifyTaskDependencies(task);
  if (blockedBy.length > 0) {
    task.blocked_by = blockedBy;
    task.status = 'blocked';  // 有未解除依赖时标记为 blocked
  }

  return task;
});

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
${t.blocked_by ? `- **阻塞依赖**: \`${t.blocked_by.join(', ')}\`` : ''}
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
    checksum: '',  // 可选：后续可添加内容校验
    last_change_id: changeId,
    task_name: taskName,
    constraints: constraintsMarkdown,
    acceptance_criteria: acceptanceMarkdown,
    tasks: tasksMarkdown
  });
} else {
  // 模板缺失时使用简洁的内联生成
  tasksContent = `---
version: 2
tech_design: "${techDesignPath}"
created_at: "${new Date().toISOString()}"
checksum: ""
last_change: "${changeId}"
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

### 🛑 Hard Stop 2：规划完成（强制停止）

```typescript
// 规划完成后强制停止，不提供自动执行选项
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛑 **规划完成**

📄 技术方案：${techDesignPath}
📋 任务清单：${tasksPath}
📊 任务数量：${tasks.length}

**请审查上述文件后执行工作流**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
```

---

### Step 3：创建工作流状态

```typescript
// 统计阻塞任务
const blockedTasks = tasks.filter(t => t.status === 'blocked');
const pendingTasks = tasks.filter(t => t.status === 'pending');

// ═══════════════════════════════════════════════════════════════
// 约束系统初始化 (v2.1)
// ═══════════════════════════════════════════════════════════════

// 从代码分析结果提取约束（初始化为 soft，需人工确认升级为 hard）
const initialConstraints = {
  hard: [],  // 硬约束（必须满足）
  soft: analysisResult.constraints.map((c, i) => ({
    id: `C${String(i + 1).padStart(3, '0')}`,
    description: c,
    type: 'soft',
    category: detectConstraintCategory(c),
    sourceModel: 'claude',
    phase: 'analysis',
    verified: false
  })),
  openQuestions: [],      // 待澄清问题
  successCriteria: extractAcceptanceCriteria(techDesign)  // 成功标准
};

// 约束分类检测函数
function detectConstraintCategory(description: string): string {
  const text = description.toLowerCase();
  if (/安全|密码|加密|认证|授权|xss|sql|csrf/.test(text)) return 'security';
  if (/性能|速度|延迟|缓存|优化/.test(text)) return 'performance';
  if (/接口|api|契约|格式|协议/.test(text)) return 'interface';
  if (/数据|类型|校验|验证|schema/.test(text)) return 'data';
  if (/错误|异常|边界|容错/.test(text)) return 'error';
  return 'requirement';
}

// 创建精简的 workflow-state.json
// 状态为 planned，等待用户审查后执行
const state = {
  task_name: taskName,
  tech_design: techDesignPath,
  tasks_file: `tasks-${sanitizedName}.md`,
  current_task: pendingTasks.length > 0 ? pendingTasks[0].id : (blockedTasks.length > 0 ? null : "T1"),
  status: "planned",  // 规划完成，等待执行
  phase: "plan",
  execution_mode: "phase",        // step | phase | boundary | quality_gate（默认阶段模式）
  mode: blockedTasks.length > 0 ? "progressive" : "normal",  // 渐进式工作流模式
  pause_before_commit: true,      // git_commit 前始终暂停确认
  use_subagent: tasks.length > 5, // 任务数 > 5 时自动启用 subagent 模式
  consecutive_count: 0,           // 连续执行任务计数
  unblocked: [],                  // 已解除的依赖列表
  sessions: {                     // 多模型会话 ID（由分析阶段填充）
    codex: null,
    gemini: null,
    claude: null
  },
  started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  progress: {
    completed: [],
    blocked: blockedTasks.map(t => t.id),  // 被阻塞的任务 ID
    skipped: [],
    failed: []
  },
  // 约束系统 (v2.2) - 增加 PBT 属性
  constraints: {
    ...initialConstraints,
    pbtProperties: []  // PBT 属性由 Phase 1.5 填充
  },
  // 零决策审计（初始为空，由执行阶段填充）
  zeroDecisionAudit: {
    passed: null,
    antiPatterns: [],
    remainingAmbiguities: [],
    auditedAt: null
  },
  // 上下文感知指标 - 详见 specs/shared/context-awareness.md
  contextMetrics: {
    estimatedTokens: 0,
    warningThreshold: 60,
    dangerThreshold: 80,
    maxConsecutiveTasks: 5,
    usagePercent: 0,
    history: []
  },
  // 边界调度 (v2.2) - 详见 specs/workflow/subagent-routing.md
  boundaryScheduling: {
    enabled: false,               // 使用 --boundary 模式时启用
    currentBoundary: null,
    boundaryProgress: {}          // 按边界 ID 记录进度
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
  },
  // Delta Tracking 系统 (v3.0)
  delta_tracking: {
    enabled: true,
    changes_dir: "changes/",
    current_change: changeId,
    applied_changes: [changeId],
    change_counter: 1
  }
};

// 创建 Genesis Change (delta.json)
const genesisChange = {
  id: changeId,
  parent_change: null,
  created_at: new Date().toISOString(),
  status: "applied",
  trigger: {
    type: "new_requirement",
    description: requirementContent.substring(0, 200),
    source: requirementSource
  },
  spec_deltas: [{
    operation: "ADDED",
    section: "full",
    before: null,
    after: techDesignPath,
    rationale: "Initial tech design"
  }],
  task_deltas: tasks.map(t => ({
    operation: "ADDED",
    task_id: t.id,
    full_task: t,
    rationale: "Initial task planning"
  }))
};

writeFile(
  path.join(changesDir, 'delta.json'),
  JSON.stringify(genesisChange, null, 2)
);

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
✅ 规划完成！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**任务名称**：${taskName}
**技术方案**：${techDesignPath}
**任务清单**：${tasksPath}
**任务数量**：${tasks.length}
${state.mode === 'progressive' ? `**工作模式**：渐进式（${blockedTasks.length} 个任务等待依赖）` : ''}

**文件结构**：
.claude/
└── tech-design/
    └── ${sanitizedName}.md    ← 技术方案

~/.claude/workflows/${projectId}/
├── workflow-state.json        ← 运行时状态
├── tasks-${sanitizedName}.md  ← 任务清单
└── changes/
    └── ${changeId}/
        ├── delta.json         ← 变更描述
        ├── intent.md          ← 意图文档
        └── review-status.json ← 审查状态

${blockedTasks.length > 0 ? `
**⏳ 阻塞任务**（需解除依赖后执行）：
${blockedTasks.map(t => `- ${t.id}: ${t.name} [等待: ${t.blocked_by.join(', ')}]`).join('\n')}

**💡 解除阻塞**：
\`\`\`bash
/workflow unblock api_spec    # 后端接口已就绪
/workflow unblock design_spec # 设计稿已就绪
\`\`\`
` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **下一步**

请审查技术方案和任务清单，确认无误后执行：
\`\`\`bash
/workflow execute
\`\`\`
`);
// 规划完成，强制停止，不自动执行
```

---

## 📦 辅助函数

```typescript
/**
 * 生成 Intent 摘要文档 (v3.0)
 */
function generateIntentSummary(params: {
  requirement: string;
  techDesign: string;
  analysisResult: any;
  taskName: string;
  changeId: string;
}): string {
  const { requirement, techDesign, analysisResult, taskName, changeId } = params;

  return `# Intent: ${taskName}

## Change ID: ${changeId}

## 触发

- **类型**: new_requirement
- **来源**: ${requirementSource}

## 变更意图

${requirement.substring(0, 500)}

## 影响分析

### 涉及文件

${analysisResult.relatedFiles.map(f => `- \`${f.path}\` — ${f.purpose}`).join('\n') || '（无已有文件受影响）'}

### 技术约束

${analysisResult.constraints.map(c => `- ${c}`).join('\n') || '（无特殊约束）'}

### 可复用组件

${analysisResult.reusableComponents.map(c => `- \`${c.path}\` — ${c.description || c.purpose}`).join('\n') || '（无可复用组件）'}

## 审查状态

- **状态**: pending
- **审查人**: -
- **审查时间**: -
`;
}

/**
 * 生成下一个变更 ID
 */
function nextChangeId(state: any): string {
  const counter = (state.delta_tracking?.change_counter || 0) + 1;
  state.delta_tracking.change_counter = counter;
  return \`CHG-\${String(counter).padStart(3, '0')}\`;
}

/**
 * 任务依赖自动分类
 * 根据任务名称和文件路径判断是否需要外部依赖（接口规格/设计稿）
 *
 * @returns 依赖标识数组：'api_spec' | 'design_spec'
 */
function classifyTaskDependencies(task: { name: string; file?: string }): string[] {
  const deps: string[] = [];
  const name = task.name.toLowerCase();
  const file = (task.file || '').toLowerCase();

  // 需要后端接口的任务
  if (/api|接口|服务层|service|fetch|request|http|数据获取|后端/.test(name) ||
      /services\/|api\/|http\/|requests\//.test(file)) {
    deps.push('api_spec');
  }

  // 需要设计稿的任务
  if (/ui|样式|组件|还原|视觉|布局|卡片|弹窗|表单|界面|页面/.test(name) ||
      /\.vue$|\.tsx$|\.jsx$|\.css$|\.scss$/.test(file) ||
      /components\/|pages\/|views\//.test(file)) {
    // 排除骨架类任务（这些可以先做）
    if (!/骨架|skeleton|mock|stub|placeholder/.test(name)) {
      deps.push('design_spec');
    }
  }

  return deps;
}

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
/workflow execute

# 查看状态
/workflow status

# 跳过当前步骤（慎用）
/workflow execute --skip

# 重试当前步骤
/workflow execute --retry
```
