---
description: 启动智能工作流 - 分析需求并生成详细执行计划
argument-hint: "\"功能需求描述\" 或 --backend \"PRD文档路径\""
allowed-tools: Task(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*), TaskOutput(*), mcp__auggie-mcp__codebase_retrieval(*), AskUserQuestion(*)
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

---

## 🎯 执行流程

### Step 0：解析参数

```typescript
const args = $ARGUMENTS.join(' ');
let requirement = '';
let isBackendMode = false;

// 解析 --backend flag
if (args.startsWith('--backend ')) {
  isBackendMode = true;
  requirement = args.replace(/^--backend\s+/, '').replace(/^["']|["']$/g, '').trim();
} else {
  requirement = args.replace(/^["']|["']$/g, '').trim();
}

if (!requirement) {
  console.log(`
❌ 请提供需求描述

用法：
  /workflow-start "实现用户认证功能"
  /workflow-start --backend "docs/prd.md"
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
const codeContext = await mcp__auggie-mcp__codebase_retrieval({
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

// 只在需要时生成技术方案
if (!fileExists(techDesignPath) || existingChoice === "重新生成") {
  // 尝试从模板文件生成技术方案
  const techDesignTemplate = loadTemplate('tech-design-template.md');

  let techDesignContent: string;

  if (techDesignTemplate) {
    // 使用模板渲染
    const templateData = {
      requirement_source: requirementSource,
      created_at: new Date().toISOString(),
      task_name: taskName,
      requirement_summary: requirementContent,
      existing_patterns: analysisResult.patterns.map(p => `- **${p.name}**: ${p.description}`).join('\n'),
      constraints: analysisResult.constraints.map(c => `- ${c}`).join('\n'),
      module_structure: '（请根据需求补充模块结构）',
      data_models: '（请根据需求补充数据模型）',
      interface_design: '（请根据需求补充接口设计）',
      acceptance_criteria: '（从需求文档提取或补充）'
    };

    // 手动处理 relatedFiles 表格（模板的 each 语法不够灵活）
    techDesignContent = renderTemplate(techDesignTemplate, templateData);

    // 替换文件表格行
    const fileTableRow = analysisResult.relatedFiles.length > 0
      ? analysisResult.relatedFiles.map(f =>
          `| \`${f.path}\` | ${f.purpose} | ${f.reuseType} |`
        ).join('\n')
      : '| - | - | - |';
    techDesignContent = techDesignContent.replace(
      /\| `\{\{file_path\}\}` \| \{\{purpose\}\} \| \{\{reuse_type\}\} \|/,
      fileTableRow
    );

    // 替换实施计划表格行
    techDesignContent = techDesignContent.replace(
      /\| \{\{index\}\} \| \{\{task_name\}\} \| `\{\{file_path\}\}` \| \{\{dependencies\}\} \|/,
      '| 1 | （待补充） | `（待补充）` | - |'
    );

    // 替换风险表格行
    techDesignContent = techDesignContent.replace(
      /\| \{\{risk\}\} \| \{\{impact\}\} \| \{\{mitigation\}\} \|/,
      '| （待评估） | - | - |'
    );

  } else {
    // 回退到内置模板
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
${analysisResult.relatedFiles.map(f =>
  `| \`${f.path}\` | ${f.purpose} | ${f.reuseType} |`
).join('\n')}

### 2.2 现有架构模式

${analysisResult.patterns.map(p => `- **${p.name}**: ${p.description}`).join('\n')}

### 2.3 技术约束

${analysisResult.constraints.map(c => `- ${c}`).join('\n')}

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
const checksum = generateChecksum(tasks);
const tasksPath = path.join(workflowDir, `tasks-${sanitizedName}.md`);

// 尝试从模板文件生成任务清单
const tasksTemplate = loadTemplate('tasks-template.md');

let tasksContent: string;

if (tasksTemplate) {
  // 准备模板数据
  const templateData = {
    tech_design_path: techDesignPath,
    created_at: new Date().toISOString(),
    checksum: checksum,
    task_name: taskName,
    constraints: analysisResult.constraints,
    acceptance_criteria: extractAcceptanceCriteria(techDesign).map((ac, i) => ({
      id: `AC${i + 1}`,
      description: ac
    })),
    tasks: tasks.map(t => ({
      ...t,
      file: t.file || '',
      leverage: t.leverage || '',
      design_ref: t.design_ref || '',
      depends: t.depends || '',
      threshold: t.threshold || 80
    }))
  };

  tasksContent = renderTemplate(tasksTemplate, templateData);

} else {
  // 回退到内置模板
  tasksContent = `---
version: 1
tech_design: "${techDesignPath}"
created_at: "${new Date().toISOString()}"
checksum: "${checksum}"
---

# Tasks: ${taskName}

## 设计文档

📄 \`${techDesignPath}\`

## 约束（从设计文档继承）

${analysisResult.constraints.map(c => `- ${c}`).join('\n')}

## 验收标准

${extractAcceptanceCriteria(techDesign).map((ac, i) =>
  `- [ ] AC${i + 1}: ${ac}`
).join('\n')}

---

${tasks.map(t => `
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
`).join('\n')}
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
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛑 **任务清单确认**

📄 技术方案：${techDesignPath}
📋 任务清单：${tasksPath}
📊 任务数量：${tasks.length}

**是否开始执行？**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const executeChoice = await AskUserQuestion({
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
  tasks_checksum: checksum,
  current_task: "T1",
  status: "in_progress",
  phase: "execute",
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
 * 简易模板渲染函数
 * 支持：{{variable}}, {{#each array}}, {{#if condition}}, {{this}}, {{this.prop}}
 */
function renderTemplate(template: string, data: Record<string, any>): string {
  let result = template;

  // 处理 {{#each array}}...{{/each}}
  result = result.replace(
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, arrayName, content) => {
      const arr = data[arrayName];
      if (!Array.isArray(arr)) return '';
      return arr.map((item, index) => {
        let itemContent = content;
        // 替换 {{this}} 和 {{this.prop}}
        itemContent = itemContent.replace(/\{\{this\.(\w+)\}\}/g, (__, prop) =>
          item[prop] !== undefined ? String(item[prop]) : ''
        );
        itemContent = itemContent.replace(/\{\{this\}\}/g, String(item));
        itemContent = itemContent.replace(/\{\{@index\}\}/g, String(index));
        return itemContent;
      }).join('');
    }
  );

  // 处理 {{#if condition}}...{{/if}}（简化版：非空即真）
  result = result.replace(
    /\{\{#if\s+(\S+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, condition, content) => {
      // 支持 this.prop 格式
      const value = condition.startsWith('this.')
        ? null  // 在 each 外部不支持 this.xxx
        : data[condition];
      return value ? content : '';
    }
  );

  // 处理普通变量 {{variable}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    data[key] !== undefined ? String(data[key]) : ''
  );

  return result;
}

/**
 * 读取模板文件（从 ~/.claude/docs/ 目录）
 */
function loadTemplate(templateName: string): string {
  const templatePath = path.join(os.homedir(), '.claude/docs', templateName);
  if (fileExists(templatePath)) {
    return readFile(templatePath);
  }
  // 回退到内置模板
  console.log(`⚠️ 模板文件不存在：${templatePath}，使用内置模板`);
  return '';
}

function generateChecksum(tasks: Task[]): string {
  const content = JSON.stringify(tasks.map(t => ({
    id: t.id,
    name: t.name,
    file: t.file,
    actions: t.actions,
    depends: t.depends,
    quality_gate: t.quality_gate,
    threshold: t.threshold
  })));
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function determinePhase(item: any): string {
  const name = item.task.toLowerCase();
  if (name.includes('接口') || name.includes('设计') || name.includes('interface')) return 'design';
  if (name.includes('测试') || name.includes('test')) return 'test';
  if (name.includes('审查') || name.includes('review')) return 'verify';
  if (name.includes('提交') || name.includes('commit') || name.includes('文档')) return 'deliver';
  return 'implement';
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
