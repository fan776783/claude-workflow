# workflow start - 启动工作流 (v3.0)

> 精简接口：自动检测 `.md` 文件，无需 `--backend`/`--file` 参数

四阶段强制流程：**需求 → 需求结构化 → 设计 → 意图审查 → 任务**

```
需求文档 ──▶ 代码分析 ──▶ 需求结构化 ──▶ tech-design.md ──▶ Intent Review ──▶ tasks.md ──▶ 执行
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

### Phase 0.5：需求结构化提取（条件执行）

**目的**：从 PRD 中提取结构化数据，确保表单字段、角色权限、业务规则等细节不丢失

> 仅对文件来源且长度 > 500 的需求执行（向后兼容：内联需求 / 短文本自动跳过）

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔬 Phase 0.5: 需求结构化提取
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

let requirementAnalysis: RequirementAnalysis | null = null;

if (requirementSource !== 'inline' && requirementContent.length > 500) {
  requirementAnalysis = extractStructuredRequirements(requirementContent);

  const dimensions = [
    { key: 'changeRecords', label: '变更记录' },
    { key: 'formFields', label: '表单字段' },
    { key: 'rolePermissions', label: '角色权限' },
    { key: 'interactions', label: '交互规格' },
    { key: 'businessRules', label: '业务规则' },
    { key: 'edgeCases', label: '边界场景' },
    { key: 'uiDisplayRules', label: 'UI展示规则' },
    { key: 'functionalFlows', label: '功能流程' },
    { key: 'dataContracts', label: '数据契约' },
  ];

  const stats = dimensions
    .map(d => `${d.label}: ${requirementAnalysis[d.key]?.length || 0}`)
    .join(' | ');

  // 覆盖率验证：PRD 行数 vs 提取条目数
  const prdLineCount = requirementContent.split('\n').length;
  const totalExtracted = dimensions.reduce((sum, d) => sum + (requirementAnalysis[d.key]?.length || 0), 0);
  const emptyDimensions = dimensions.filter(d => (requirementAnalysis[d.key]?.length || 0) === 0);
  const coverageWarning = (prdLineCount > 200 && totalExtracted < 20)
    ? `\n⚠️ 覆盖率偏低：PRD ${prdLineCount} 行，仅提取 ${totalExtracted} 条。请检查是否遗漏需求细节。`
    : '';
  const emptyWarning = emptyDimensions.length > 3
    ? `\n⚠️ ${emptyDimensions.length} 个维度为空（${emptyDimensions.map(d => d.label).join('、')}），请确认 PRD 是否涉及这些维度。`
    : '';

  console.log(`
✅ 需求结构化提取完成（9 维度）

📊 ${stats}
📈 总提取条目: ${totalExtracted} | PRD 行数: ${prdLineCount}${coverageWarning}${emptyWarning}
`);
} else {
  console.log(`⏭️ 跳过（${requirementSource === 'inline' ? '内联需求' : '文本过短'}）\n`);
}
```

---

### Phase 0.6：生成验证清单（条件执行）

**目的**：将结构化需求转换为可执行的验证清单，指导任务实现和验收测试

> 仅在 Phase 0.5 成功提取结构化需求后执行

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Phase 0.6: 生成验证清单
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

let acceptanceChecklist: AcceptanceChecklist | null = null;

if (requirementAnalysis) {
  acceptanceChecklist = generateAcceptanceChecklist(requirementAnalysis, taskName);

  const stats = [
    `表单验证: ${acceptanceChecklist.formValidations.length}`,
    `权限验证: ${acceptanceChecklist.permissionValidations.length}`,
    `交互验证: ${acceptanceChecklist.interactionValidations.length}`,
    `业务规则: ${acceptanceChecklist.businessRuleValidations.length}`,
    `边界场景: ${acceptanceChecklist.edgeCaseValidations.length}`,
    `UI展示: ${acceptanceChecklist.uiDisplayValidations.length}`,
    `功能流程: ${acceptanceChecklist.functionalFlowValidations.length}`
  ].join(' | ');

  const totalItems = [
    acceptanceChecklist.formValidations,
    acceptanceChecklist.permissionValidations,
    acceptanceChecklist.interactionValidations,
    acceptanceChecklist.businessRuleValidations,
    acceptanceChecklist.edgeCaseValidations,
    acceptanceChecklist.uiDisplayValidations,
    acceptanceChecklist.functionalFlowValidations
  ].reduce((sum, arr) => sum + arr.length, 0);

  console.log(`
✅ 验证清单生成完成

📊 ${stats}
📈 总验收项: ${totalItems}
`);

  // 生成验证清单文件
  const checklistPath = `.claude/acceptance/${sanitizedName}-checklist.md`;
  ensureDir('.claude/acceptance');

  const checklistContent = renderAcceptanceChecklist(acceptanceChecklist, {
    taskName,
    requirementSource,
    techDesignPath,
    createdAt: new Date().toISOString()
  });

  writeFile(checklistPath, checklistContent);

  console.log(`
📄 验证清单已保存: ${checklistPath}

💡 任务执行时将自动关联相关验收项
`);
} else {
  console.log(`⏭️ 跳过（未执行 Phase 0.5）\n`);
}
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

  // 预渲染需求详情章节（Phase 0.5 产物）
  const requirementDetailSections = requirementAnalysis
    ? renderRequirementDetailSections(requirementAnalysis)
    : '';

  let techDesignContent: string;

  if (techDesignTemplate) {
    // 使用简单变量替换
    techDesignContent = replaceVars(techDesignTemplate, {
      requirement_source: requirementSource,
      created_at: new Date().toISOString(),
      task_name: taskName,
      requirement_summary: requirementContent,
      requirement_detail_sections: requirementDetailSections,
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
version: 2
requirement_source: "${requirementSource}"
created_at: "${new Date().toISOString()}"
status: draft
---

# 技术方案: ${taskName}

## 1. 需求摘要

${requirementContent}

${requirementDetailSections}

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

  // 构建审查提示词（含需求覆盖检查）
  const requirementContext = requirementAnalysis
    ? `\n\n<STRUCTURED_REQUIREMENTS>\n${JSON.stringify(requirementAnalysis, null, 2)}\n</STRUCTURED_REQUIREMENTS>\n\n请额外执行 Requirement Alignment 检查，验证技术方案是否覆盖上述结构化需求中的所有条目。`
    : '';

  const reviewPrompt = `ROLE_FILE: ~/.claude/prompts/codex/reviewer.md

<TASK>
请审查以下技术方案文档：

${readFile(techDesignPath)}
${requirementContext}

请重点关注：
1. 架构设计是否合理
2. 模块划分是否清晰
3. 接口设计是否完整
4. 实施计划是否可行
5. 风险评估是否充分${requirementAnalysis ? '\n6. 需求覆盖率（Requirement Alignment）' : ''}

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

// 为每个任务补充详细信息（包含依赖分类 + 验证清单关联）
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

  // 关联验证清单（如果已生成）
  if (acceptanceChecklist) {
    task.acceptance_criteria = mapTaskToAcceptanceCriteria(task, acceptanceChecklist);
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

// 渲染任务列表（包含验收项关联）
const tasksMarkdown = tasks.map(t => `
## ${t.id}: ${t.name}
<!-- id: ${t.id}, design_ref: ${t.design_ref || 'N/A'} -->
- **阶段**: ${t.phase}
${t.file ? `- **文件**: \`${t.file}\`` : ''}
${t.leverage ? `- **复用**: \`${t.leverage}\`` : ''}
${t.design_ref ? `- **设计参考**: tech-design.md § ${t.design_ref}` : ''}
- **需求**: ${t.requirement}
${t.acceptance_criteria && t.acceptance_criteria.length > 0 ? `- **验收项**: ${t.acceptance_criteria.join(', ')}` : ''}
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
${acceptanceChecklist ? `📋 验证清单：.claude/acceptance/${sanitizedName}-checklist.md` : ''}

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
${acceptanceChecklist ? `✅ 验证清单：.claude/acceptance/${sanitizedName}-checklist.md` : ''}
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
${acceptanceChecklist ? `**验证清单**：.claude/acceptance/${sanitizedName}-checklist.md` : ''}
**任务数量**：${tasks.length}
${state.mode === 'progressive' ? `**工作模式**：渐进式（${blockedTasks.length} 个任务等待依赖）` : ''}

**文件结构**：
.claude/
├── tech-design/
│   └── ${sanitizedName}.md    ← 技术方案
${acceptanceChecklist ? `├── acceptance/
│   └── ${sanitizedName}-checklist.md  ← 验证清单` : ''}

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

/**
 * RequirementAnalysis 接口定义 (v2.1)
 *
 * 9 维度提取：变更记录、表单字段、角色权限、交互规格、业务规则、
 * 边界场景、UI 展示规则、功能流程、数据契约
 */
interface RequirementAnalysis {
  changeRecords: Array<{
    id: string;
    version: string;
    description: string;
    changedFields: string[];
    ruleChange?: string;
  }>;
  formFields: Array<{
    scene: string;          // 所属场景/表单（区分同名字段在不同表单中的规格差异）
    fieldName: string;
    type: string;           // text | textarea | image | select | switch | multi-select
    required: boolean;
    validationRules: string[];
    tooltip?: string;       // 输入框内的默认文案/placeholder
    helperText?: string;    // 常驻提示文案
    validationMessage?: string;  // 校验失败时的提示文案（保留 PRD 原文）
  }>;
  rolePermissions: Array<{
    role: string;
    permissions: string[];
    restrictions: string[];
    scenarioNotes?: string; // 场景级补充说明（数据归属、条件可见性等）
  }>;
  interactions: Array<{
    trigger: string;
    element: string;
    behavior: string;
    message?: string;
    condition?: string;     // 触发条件（所处页面/Tab/权限状态等前提）
  }>;
  businessRules: Array<{
    id: string;
    condition: string;
    expectedBehavior: string;
    relatedFields: string[];
  }>;
  edgeCases: Array<{
    scenario: string;
    expectedDisplay: string;
    fallbackBehavior?: string;
    context?: string;       // 发生在哪个页面/组件
  }>;
  uiDisplayRules: Array<{
    context: string;        // 页面/Tab/组件
    rule: string;           // 展示规则描述
    detail: string;         // 具体差异说明
  }>;
  functionalFlows: Array<{
    name: string;           // 流程名称
    steps: string[];        // 步骤序列
    conditionalPaths?: string[];  // 条件分支
    entryPoints?: string[];      // 触发该流程的入口路径
  }>;
  dataContracts: Array<{
    name: string;           // 接口/模型名称
    type: string;           // api_endpoint | data_model | field_mapping | config
    spec: string;           // 规格描述（方法+路径、字段定义、映射关系等）
    constraints?: string;   // 约束说明（必填、类型、范围等）
  }>;
}

/**
 * 从 PRD 中提取结构化需求（9 维度深度扫描）
 * 指令驱动：当前模型按维度扫描需求文档，提取结构化数据
 *
 * ⚠️ 提取原则：
 * - 宁多勿少：宁可提取冗余条目，也不能遗漏需求细节
 * - 按场景分组：同一字段在不同场景下的规则差异必须分别记录
 * - 保留原文：校验规则、提示文案、tooltips 等必须保留 PRD 原文，不可改写
 * - 穷举校验：每个场景的必填字段缺失组合及对应提示文案都要记录到 formFields.validationMessage
 */
function extractStructuredRequirements(content: string): RequirementAnalysis {
  // 当前模型执行：逐维度扫描 PRD 原文，提取结构化数据
  // 按每个维度的匹配模式逐段扫描，将匹配到的内容填入对应数组，空维度保持 []

  const analysis: RequirementAnalysis = {
    // ── 维度 1: 变更记录 ──
    // 扫描版本变更/修改历史/changelog 标记（如 "变更01" / "V2.x" / "修订"）
    changeRecords: [],

    // ── 维度 2: 表单字段（按场景分组） ──
    // 🔑 关键：同名字段在不同表单/场景下的规格可能不同（字符限制、必填规则等）
    // 扫描策略：
    //   1. 先识别所有表单/弹窗场景
    //   2. 对每个场景逐一提取字段（输入框/选择器/上传框/开关）
    //   3. 每个字段记录：scene + fieldName + type + required + validationRules + tooltip + helperText
    //   4. 特别关注：字符限制、超出行为（禁止输入 vs 可输入但保存报错）、文件格式/大小限制
    //   5. 必填规则差异：单字段必填 vs "N选一必填"
    //   6. 校验失败提示：每个字段校验失败时的 tooltip/message 记入 validationMessage
    formFields: [],

    // ── 维度 3: 角色权限 ──
    // 扫描角色权限差异（角色名 + 可见/不可见/可编辑/禁用）
    // 🔑 关键：不同角色在同一功能上的行为差异要逐一记录
    //   - 操作按钮的可见性（按角色 + 数据归属）
    //   - "仅限自己创建的" vs "所有数据" 的权限边界
    //   - 按钮不可用时是"不展示"还是"置灰"
    //   - 页面/功能的准入权限
    rolePermissions: [],

    // ── 维度 4: 交互规格 ──
    // 扫描交互规格描述（hover/tooltip/弹窗/确认/loading/错误提示）
    // 🔑 关键：
    //   1. 延迟参数（hover 延迟、防抖等）
    //   2. 条件交互（权限/状态/数据归属等前提条件）
    //   3. 弹窗层级和关闭后返回位置
    //   4. 列表排序规则（新增数据的位置、默认排序字段和方向）
    //   5. 展开/收起/折叠逻辑
    //   6. 固定/吸附/悬浮位置规则
    interactions: [],

    // ── 维度 5: 业务规则 ──
    // 扫描条件逻辑（"如果...则..." / "当...时..." / "必须" / "不允许"）
    // 🔑 关键：
    //   1. 唯一性校验范围（全局唯一 vs 某作用域内唯一）
    //   2. 联动规则（A 变更时 B 如何响应）
    //   3. 时间戳判定规则（何种操作算"更新"、何种不算）
    //   4. 删除/禁用的影响范围（是否影响已引用数据）
    //   5. 跨类目/跨分组的交叉选择规则
    //   6. 组合校验规则（多字段联合校验条件及对应提示文案）
    businessRules: [],

    // ── 维度 6: 边界场景 ──
    // 扫描边界/异常场景（未开通/无权限/为空/超出/不存在/降级）
    // 🔑 关键：同一空状态/异常在不同上下文的展示可能不同（文案、按钮、图标差异）
    edgeCases: [],

    // ── 维度 7: UI 展示规则 ──
    // 扫描 UI 展示差异（不同 Tab/页面/角色/数据类型下的列、字段、按钮差异）
    // 🔑 关键：
    //   1. 不同 Tab/分类下列表列的增减差异
    //   2. 空值/未上传时的缺省展示
    //   3. 文本截断规则（超出后省略号/换行/tooltip）
    //   4. 固定列/吸附列规则
    //   5. 时间/日期的格式规范
    //   6. 多行信息的展示格式（如姓名+账号的排列方式）
    //   7. 跨业务类型的兼容差异（同一功能在不同业务线的展示区别）
    uiDisplayRules: [],

    // ── 维度 8: 功能流程（含入口路径） ──
    // 扫描多步交互流程、条件分支路径、以及触发该流程的所有入口
    // 🔑 关键：
    //   1. 创建/添加操作的完整步骤（含前置选择）
    //   2. 成功/失败后的页面跳转或状态变化
    //   3. 编辑场景中嵌套的删除/重置流程
    //   4. 复制/克隆操作的字段继承规则（哪些带入、哪些清空）
    //   5. 上传/删除等子流程（是否有二次确认）
    //   6. entryPoints：同一功能可能从不同页面/按钮触发，关闭后返回位置也不同
    functionalFlows: [],

    // ── 维度 9: 数据契约 ──（API/后端类 PRD）
    // 扫描 API 端点、数据模型、字段映射、配置项等结构化定义
    // 🔑 关键：
    //   1. API 端点（方法 + 路径 + 请求/响应结构）
    //   2. 数据模型（表结构 / DTO / VO 的字段定义）
    //   3. 字段映射关系（前端字段名 ↔ 后端字段名）
    //   4. 枚举值/状态码定义
    //   5. 配置项及默认值
    dataContracts: [],
  };

  // 提取指令（每个维度）：
  // 1. changeRecords → { id, version, description, changedFields[], ruleChange }
  // 2. formFields → { scene, fieldName, type, required, validationRules[], tooltip, helperText, validationMessage }
  //    ⚠️ 对每个表单场景分别提取，scene 字段标识所属场景
  // 3. rolePermissions → { role, permissions[], restrictions[], scenarioNotes }
  // 4. interactions → { trigger, element, behavior, message, condition }
  // 5. businessRules → { id, condition, expectedBehavior, relatedFields[] }
  // 6. edgeCases → { scenario, expectedDisplay, fallbackBehavior, context }
  // 7. uiDisplayRules → { context, rule, detail }
  // 8. functionalFlows → { name, steps[], conditionalPaths[], entryPoints[] }
  // 9. dataContracts → { name, type, spec, constraints }

  return analysis;
}

/**
 * 将 RequirementAnalysis 渲染为 Markdown 章节（1.1-1.9）
 * 空维度不渲染，保持文档简洁
 */
function renderRequirementDetailSections(analysis: RequirementAnalysis): string {
  const sections: string[] = [];

  // 1.1 变更记录
  if (analysis.changeRecords.length > 0) {
    sections.push(`### 1.1 变更记录

| 变更 ID | 版本 | 描述 | 涉及字段 | 规则变化 |
|---------|------|------|----------|----------|
${analysis.changeRecords.map(r =>
  `| ${esc(r.id)} | ${esc(r.version)} | ${esc(r.description)} | ${esc(r.changedFields.join(', '))} | ${esc(r.ruleChange || '-')} |`
).join('\n')}`);
  }

  // 1.2 表单字段规格（按场景分组，含校验提示）
  if (analysis.formFields.length > 0) {
    const byScene = groupBy(analysis.formFields, 'scene');
    const sceneTables = Object.entries(byScene).map(([scene, fields]) =>
      `#### ${scene}

| 字段名 | 类型 | 必填 | 校验规则 | 提示文案 | 校验失败提示 |
|--------|------|------|----------|----------|-------------|
${fields.map(f =>
  `| ${esc(f.fieldName)} | ${esc(f.type)} | ${f.required ? '✅' : '-'} | ${esc(f.validationRules.join('; '))} | ${esc(f.tooltip || '-')} | ${esc(f.validationMessage || '-')} |`
).join('\n')}`
    ).join('\n\n');

    sections.push(`### 1.2 表单字段规格

${sceneTables}`);
  }

  // 1.3 角色权限矩阵
  if (analysis.rolePermissions.length > 0) {
    sections.push(`### 1.3 角色权限矩阵

| 角色 | 可执行操作 | 限制 | 场景说明 |
|------|-----------|------|----------|
${analysis.rolePermissions.map(r =>
  `| ${esc(r.role)} | ${esc(r.permissions.join(', '))} | ${esc(r.restrictions.join(', ') || '-')} | ${esc(r.scenarioNotes || '-')} |`
).join('\n')}`);
  }

  // 1.4 交互规格
  if (analysis.interactions.length > 0) {
    sections.push(`### 1.4 交互规格

| 触发方式 | 目标元素 | 行为 | 提示信息 | 触发条件 |
|----------|----------|------|----------|----------|
${analysis.interactions.map(i =>
  `| ${esc(i.trigger)} | ${esc(i.element)} | ${esc(i.behavior)} | ${esc(i.message || '-')} | ${esc(i.condition || '-')} |`
).join('\n')}`);
  }

  // 1.5 业务规则
  if (analysis.businessRules.length > 0) {
    sections.push(`### 1.5 业务规则

| 规则 ID | 条件 | 期望行为 | 关联字段 |
|---------|------|----------|----------|
${analysis.businessRules.map(r =>
  `| ${esc(r.id)} | ${esc(r.condition)} | ${esc(r.expectedBehavior)} | ${esc(r.relatedFields.join(', '))} |`
).join('\n')}`);
  }

  // 1.6 边界场景
  if (analysis.edgeCases.length > 0) {
    sections.push(`### 1.6 边界场景

| 场景 | 期望展示 | 兜底行为 | 所在上下文 |
|------|----------|----------|------------|
${analysis.edgeCases.map(e =>
  `| ${esc(e.scenario)} | ${esc(e.expectedDisplay)} | ${esc(e.fallbackBehavior || '-')} | ${esc(e.context || '-')} |`
).join('\n')}`);
  }

  // 1.7 UI 展示规则
  if (analysis.uiDisplayRules.length > 0) {
    sections.push(`### 1.7 UI 展示规则

| 上下文 | 规则 | 具体差异 |
|--------|------|----------|
${analysis.uiDisplayRules.map(u =>
  `| ${esc(u.context)} | ${esc(u.rule)} | ${esc(u.detail)} |`
).join('\n')}`);
  }

  // 1.8 功能流程（含入口路径）
  if (analysis.functionalFlows.length > 0) {
    const flowSections = analysis.functionalFlows.map(f =>
      `#### ${f.name}

${f.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
${f.conditionalPaths?.length ? `\n**条件分支**：\n${f.conditionalPaths.map(p => `- ${p}`).join('\n')}` : ''}
${f.entryPoints?.length ? `\n**入口路径**：\n${f.entryPoints.map((e, i) => `${i + 1}. ${e}`).join('\n')}` : ''}`
    ).join('\n\n');

    sections.push(`### 1.8 功能流程

${flowSections}`);
  }

  // 1.9 数据契约
  if (analysis.dataContracts.length > 0) {
    sections.push(`### 1.9 数据契约

| 名称 | 类型 | 规格 | 约束 |
|------|------|------|------|
${analysis.dataContracts.map(d =>
  `| ${esc(d.name)} | ${esc(d.type)} | ${esc(d.spec)} | ${esc(d.constraints || '-')} |`
).join('\n')}`);
  }

  return sections.length > 0
    ? `## 1.x 需求详情（结构化提取）\n\n${sections.join('\n\n')}`
    : '';
}

/**
 * 转义 Markdown 表格单元格内容（管道符 + 换行）
 */
function esc(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * 按指定字段分组
 */
function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const group = String(item[key] || '默认');
    (acc[group] = acc[group] || []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// ═══════════════════════════════════════════════════════════════
// Phase 0.6: 验证清单生成系统 (v3.3.2)
// ═══════════════════════════════════════════════════════════════

/**
 * AcceptanceChecklist 接口定义
 * 将结构化需求转换为可执行的验证清单
 */
interface AcceptanceChecklist {
  formValidations: FormValidation[];
  permissionValidations: PermissionValidation[];
  interactionValidations: InteractionValidation[];
  businessRuleValidations: BusinessRuleValidation[];
  edgeCaseValidations: EdgeCaseValidation[];
  uiDisplayValidations: UiDisplayValidation[];
  functionalFlowValidations: FunctionalFlowValidation[];
  taskChecklistMapping: TaskChecklistMapping[];
}

interface FormValidation {
  scene: string;
  sceneId: string;
  items: Array<{
    fieldName: string;
    checks: string[];
    testCases: Array<{ input: string; expected: string }>;
  }>;
}

interface PermissionValidation {
  role: string;
  roleId: string;
  items: Array<{
    scenario: string;
    checks: string[];
    testSteps: string[];
  }>;
}

interface InteractionValidation {
  category: string;
  categoryId: string;
  items: Array<{
    element: string;
    trigger: string;
    checks: string[];
    precondition: string;
  }>;
}

interface BusinessRuleValidation {
  ruleId: string;
  description: string;
  checks: string[];
  relatedFields: string;
  testScenarios: Array<{
    scenario: string;
    input: string;
    expected: string;
  }>;
}

interface EdgeCaseValidation {
  scenario: string;
  checks: string[];
  context: string;
  fallback: string;
}

interface UiDisplayValidation {
  context: string;
  contextId: string;
  items: Array<{
    rule: string;
    checks: string[];
    visualChecks: string[];
  }>;
}

interface FunctionalFlowValidation {
  flowName: string;
  steps: string[];
  conditionalPaths: Array<{
    condition: string;
    expectedBehavior: string;
  }>;
  entryPoints: Array<{
    entry: string;
    expectedResult: string;
  }>;
}

interface TaskChecklistMapping {
  taskId: string;
  taskName: string;
  acceptanceCriteria: string[];
  verificationType: string;
}

/**
 * 从 RequirementAnalysis 生成 AcceptanceChecklist
 *
 * 转换策略：
 * 1. 表单字段 → 验证项（必填、格式、长度、联动等）
 * 2. 角色权限 → 权限验证项（可见性、可操作性、数据范围等）
 * 3. 交互规格 → 交互验证项（触发条件、响应行为、提示信息等）
 * 4. 业务规则 → 业务规则验证项（条件判断、联动逻辑、唯一性等）
 * 5. 边界场景 → 边界验证项（空状态、异常处理、降级方案等）
 * 6. UI展示规则 → UI验证项（布局、样式、响应式、文本截断等）
 * 7. 功能流程 → 流程验证项（步骤完整性、分支逻辑、入口路径等）
 */
function generateAcceptanceChecklist(
  analysis: RequirementAnalysis,
  taskName: string
): AcceptanceChecklist {
  const checklist: AcceptanceChecklist = {
    formValidations: [],
    permissionValidations: [],
    interactionValidations: [],
    businessRuleValidations: [],
    edgeCaseValidations: [],
    uiDisplayValidations: [],
    functionalFlowValidations: [],
    taskChecklistMapping: []
  };

  // ── 1. 表单字段 → 验证项 ──
  const formByScene = groupBy(analysis.formFields, 'scene');
  Object.entries(formByScene).forEach(([scene, fields], sceneIndex) => {
    const items = fields.map(field => {
      const checks: string[] = [];
      const testCases: Array<{ input: string; expected: string }> = [];

      // 必填验证
      if (field.required) {
        checks.push(`${field.fieldName} 为空时，显示提示: "${field.validationMessage || '此字段为必填项'}"`);
        testCases.push({
          input: '（空值）',
          expected: `显示错误提示: ${field.validationMessage || '此字段为必填项'}`
        });
      }

      // 校验规则验证
      field.validationRules.forEach(rule => {
        if (/字符限制|长度|最多|最少/.test(rule)) {
          checks.push(`${field.fieldName} ${rule}`);
          const match = rule.match(/(\d+)/);
          if (match) {
            const limit = parseInt(match[1]);
            testCases.push({
              input: `超过 ${limit} 字符的文本`,
              expected: `禁止输入或显示错误提示`
            });
          }
        } else if (/格式|正则|pattern/.test(rule)) {
          checks.push(`${field.fieldName} 格式校验: ${rule}`);
          testCases.push({
            input: '不符合格式的输入',
            expected: `显示格式错误提示`
          });
        } else {
          checks.push(`${field.fieldName} ${rule}`);
        }
      });

      // Tooltip 验证
      if (field.tooltip) {
        checks.push(`输入框显示 placeholder: "${field.tooltip}"`);
      }

      // Helper Text 验证
      if (field.helperText) {
        checks.push(`输入框下方显示提示: "${field.helperText}"`);
      }

      // 类型特定验证
      if (field.type === 'image' || field.type === 'file') {
        checks.push(`${field.fieldName} 支持的文件格式和大小限制符合规格`);
        checks.push(`上传失败时显示明确的错误提示`);
      } else if (field.type === 'select' || field.type === 'multi-select') {
        checks.push(`${field.fieldName} 下拉选项完整且正确`);
        checks.push(`选项排序符合规格`);
      } else if (field.type === 'switch') {
        checks.push(`${field.fieldName} 开关状态切换正常`);
        checks.push(`状态变化时触发相应的联动逻辑`);
      }

      return {
        fieldName: field.fieldName,
        checks,
        testCases
      };
    });

    checklist.formValidations.push({
      scene,
      sceneId: `F${sceneIndex + 1}`,
      items
    });
  });

  // ── 2. 角色权限 → 验证项 ──
  analysis.rolePermissions.forEach((perm, index) => {
    const items: PermissionValidation['items'] = [];

    // 权限验证项
    perm.permissions.forEach(permission => {
      items.push({
        scenario: `${perm.role} - ${permission}`,
        checks: [
          `${perm.role} 可以执行 "${permission}" 操作`,
          `操作按钮/入口对 ${perm.role} 可见`,
          `执行操作后结果符合预期`
        ],
        testSteps: [
          `使用 ${perm.role} 账号登录`,
          `导航到相关功能页面`,
          `验证 "${permission}" 操作可见且可执行`,
          `执行操作并验证结果`
        ]
      });
    });

    // 限制验证项
    perm.restrictions.forEach(restriction => {
      items.push({
        scenario: `${perm.role} - ${restriction}`,
        checks: [
          `${perm.role} 不能执行 "${restriction}" 操作`,
          `相关按钮/入口对 ${perm.role} 不可见或置灰`,
          `尝试执行时显示权限不足提示`
        ],
        testSteps: [
          `使用 ${perm.role} 账号登录`,
          `导航到相关功能页面`,
          `验证 "${restriction}" 操作不可见或置灰`,
          `（如可见）尝试执行并验证被拦截`
        ]
      });
    });

    // 场景说明验证
    if (perm.scenarioNotes) {
      items.push({
        scenario: `${perm.role} - 数据范围`,
        checks: [
          `${perm.role} 只能看到符合权限范围的数据`,
          `数据归属判定逻辑正确: ${perm.scenarioNotes}`
        ],
        testSteps: [
          `使用 ${perm.role} 账号登录`,
          `查看数据列表`,
          `验证只显示符合权限范围的数据`,
          `尝试访问超出权限范围的数据，验证被拦截`
        ]
      });
    }

    checklist.permissionValidations.push({
      role: perm.role,
      roleId: `P${index + 1}`,
      items
    });
  });

  // ── 3. 交互规格 → 验证项 ──
  const interactionByCategory = new Map<string, typeof analysis.interactions>();
  analysis.interactions.forEach(interaction => {
    const category = interaction.trigger || '通用交互';
    if (!interactionByCategory.has(category)) {
      interactionByCategory.set(category, []);
    }
    interactionByCategory.get(category)!.push(interaction);
  });

  Array.from(interactionByCategory.entries()).forEach(([category, interactions], catIndex) => {
    const items = interactions.map(interaction => {
      const checks: string[] = [];

      // 触发条件验证
      if (interaction.condition) {
        checks.push(`前置条件满足: ${interaction.condition}`);
      }

      // 行为验证
      checks.push(`${interaction.trigger} ${interaction.element} 时，${interaction.behavior}`);

      // 提示信息验证
      if (interaction.message) {
        checks.push(`显示提示信息: "${interaction.message}"`);
      }

      // 延迟参数验证（如 hover 延迟）
      if (/hover|悬停/.test(interaction.trigger) && /延迟|delay/.test(interaction.behavior)) {
        checks.push(`延迟时间符合规格`);
      }

      // 弹窗验证
      if (/弹窗|modal|dialog/.test(interaction.behavior)) {
        checks.push(`弹窗层级正确，不被其他元素遮挡`);
        checks.push(`关闭弹窗后返回正确位置`);
        checks.push(`弹窗内容完整且正确`);
      }

      // Loading 验证
      if (/loading|加载/.test(interaction.behavior)) {
        checks.push(`显示 loading 状态`);
        checks.push(`loading 结束后状态更新正确`);
      }

      return {
        element: interaction.element,
        trigger: interaction.trigger,
        checks,
        precondition: interaction.condition || '无'
      };
    });

    checklist.interactionValidations.push({
      category,
      categoryId: `I${catIndex + 1}`,
      items
    });
  });

  // ── 4. 业务规则 → 验证项 ──
  analysis.businessRules.forEach(rule => {
    const checks: string[] = [];
    const testScenarios: BusinessRuleValidation['testScenarios'] = [];

    // 条件验证
    checks.push(`条件判断: ${rule.condition}`);
    checks.push(`期望行为: ${rule.expectedBehavior}`);

    // 关联字段联动验证
    if (rule.relatedFields.length > 0) {
      checks.push(`关联字段 (${rule.relatedFields.join(', ')}) 联动正确`);
    }

    // 唯一性验证
    if (/唯一|unique|不能重复/.test(rule.condition)) {
      checks.push(`唯一性校验范围正确`);
      testScenarios.push({
        scenario: '重复值测试',
        input: '输入已存在的值',
        expected: '显示唯一性校验错误提示'
      });
    }

    // 联动规则验证
    if (/联动|关联|影响/.test(rule.expectedBehavior)) {
      testScenarios.push({
        scenario: '联动测试',
        input: `触发条件: ${rule.condition}`,
        expected: `联动行为: ${rule.expectedBehavior}`
      });
    }

    // 删除/禁用影响验证
    if (/删除|禁用|disable/.test(rule.expectedBehavior)) {
      checks.push(`删除/禁用后，已引用数据的处理符合规格`);
      testScenarios.push({
        scenario: '删除影响测试',
        input: '删除被引用的数据',
        expected: rule.expectedBehavior
      });
    }

    checklist.businessRuleValidations.push({
      ruleId: rule.id,
      description: rule.condition,
      checks,
      relatedFields: rule.relatedFields.join(', '),
      testScenarios
    });
  });

  // ── 5. 边界场景 → 验证项 ──
  analysis.edgeCases.forEach(edge => {
    const checks: string[] = [];

    // 场景展示验证
    checks.push(`场景 "${edge.scenario}" 下，展示: ${edge.expectedDisplay}`);

    // 兜底行为验证
    if (edge.fallbackBehavior) {
      checks.push(`兜底行为: ${edge.fallbackBehavior}`);
    }

    // 上下文特定验证
    if (edge.context) {
      checks.push(`在 ${edge.context} 上下文中验证`);
    }

    // 空状态验证
    if (/空|无数据|empty/.test(edge.scenario)) {
      checks.push(`空状态文案、图标、按钮符合规格`);
      checks.push(`空状态下的操作引导正确`);
    }

    // 权限不足验证
    if (/权限|无权限|未开通/.test(edge.scenario)) {
      checks.push(`权限不足提示清晰明确`);
      checks.push(`提供开通/申请权限的入口（如适用）`);
    }

    // 超出限制验证
    if (/超出|超过|limit/.test(edge.scenario)) {
      checks.push(`超出限制时的提示和处理符合规格`);
    }

    checklist.edgeCaseValidations.push({
      scenario: edge.scenario,
      checks,
      context: edge.context || '全局',
      fallback: edge.fallbackBehavior || '无'
    });
  });

  // ── 6. UI展示规则 → 验证项 ──
  const uiByContext = groupBy(analysis.uiDisplayRules, 'context');
  Object.entries(uiByContext).forEach(([context, rules], ctxIndex) => {
    const items = rules.map(rule => {
      const checks: string[] = [];
      const visualChecks: string[] = [];

      // 规则验证
      checks.push(`${rule.rule}: ${rule.detail}`);

      // 列差异验证
      if (/列|column|字段/.test(rule.rule)) {
        visualChecks.push(`列的显示/隐藏符合规格`);
        visualChecks.push(`列顺序正确`);
        visualChecks.push(`列宽度合理`);
      }

      // 文本截断验证
      if (/截断|省略|ellipsis/.test(rule.detail)) {
        visualChecks.push(`文本超出时正确截断`);
        visualChecks.push(`hover 显示完整内容（如适用）`);
      }

      // 时间格式验证
      if (/时间|日期|格式/.test(rule.rule)) {
        visualChecks.push(`时间/日期格式符合规格`);
        visualChecks.push(`时区处理正确（如适用）`);
      }

      // 空值展示验证
      if (/空值|未上传|缺省/.test(rule.detail)) {
        visualChecks.push(`空值展示符合规格（占位符/默认值）`);
      }

      // 固定列验证
      if (/固定|吸附|sticky/.test(rule.detail)) {
        visualChecks.push(`固定列在滚动时保持固定`);
        visualChecks.push(`固定列样式正确`);
      }

      return {
        rule: rule.rule,
        checks,
        visualChecks
      };
    });

    checklist.uiDisplayValidations.push({
      context,
      contextId: `U${ctxIndex + 1}`,
      items
    });
  });

  // ── 7. 功能流程 → 验证项 ──
  analysis.functionalFlows.forEach(flow => {
    const conditionalPaths = (flow.conditionalPaths || []).map(path => ({
      condition: path,
      expectedBehavior: '按条件分支执行'
    }));

    const entryPoints = (flow.entryPoints || []).map(entry => ({
      entry,
      expectedResult: '流程正常启动'
    }));

    checklist.functionalFlowValidations.push({
      flowName: flow.name,
      steps: flow.steps.map((step, i) => `步骤 ${i + 1}: ${step}`),
      conditionalPaths,
      entryPoints
    });
  });

  return checklist;
}

/**
 * 渲染验证清单为 Markdown
 */
function renderAcceptanceChecklist(
  checklist: AcceptanceChecklist,
  metadata: {
    taskName: string;
    requirementSource: string;
    techDesignPath: string;
    createdAt: string;
  }
): string {
  const sections: string[] = [];

  // 计算统计数据
  const totalItems = [
    checklist.formValidations,
    checklist.permissionValidations,
    checklist.interactionValidations,
    checklist.businessRuleValidations,
    checklist.edgeCaseValidations,
    checklist.uiDisplayValidations,
    checklist.functionalFlowValidations
  ].reduce((sum, arr) => sum + arr.length, 0);

  // 头部
  sections.push(`---
version: 1
requirement_source: "${metadata.requirementSource}"
created_at: "${metadata.createdAt}"
tech_design: "${metadata.techDesignPath}"
---

# 验收清单: ${metadata.taskName}

> 本清单由需求结构化提取自动生成，用于指导任务执行和验收测试

## 📋 清单概览

- **总验收项**: ${totalItems}
- **表单验证**: ${checklist.formValidations.length} 个场景
- **权限验证**: ${checklist.permissionValidations.length} 个角色
- **交互验证**: ${checklist.interactionValidations.length} 个类别
- **业务规则验证**: ${checklist.businessRuleValidations.length} 条规则
- **边界场景验证**: ${checklist.edgeCaseValidations.length} 个场景
- **UI展示验证**: ${checklist.uiDisplayValidations.length} 个上下文
- **功能流程验证**: ${checklist.functionalFlowValidations.length} 个流程

---`);

  // 1. 表单字段验证
  if (checklist.formValidations.length > 0) {
    sections.push(`\n## 1. 表单字段验证\n`);
    checklist.formValidations.forEach((validation, vIndex) => {
      sections.push(`### 1.${vIndex + 1} ${validation.scene}\n`);
      validation.items.forEach((item, iIndex) => {
        sections.push(`#### AC-${validation.sceneId}.${iIndex + 1} ${item.fieldName}\n`);
        sections.push(`**验证项**:`);
        item.checks.forEach(check => {
          sections.push(`- [ ] ${check}`);
        });
        if (item.testCases.length > 0) {
          sections.push(`\n**测试数据**:\n`);
          sections.push(`| 输入 | 期望结果 |`);
          sections.push(`|------|----------|`);
          item.testCases.forEach(tc => {
            sections.push(`| ${esc(tc.input)} | ${esc(tc.expected)} |`);
          });
        }
        sections.push('');
      });
    });
    sections.push(`---`);
  }

  // 2. 角色权限验证
  if (checklist.permissionValidations.length > 0) {
    sections.push(`\n## 2. 角色权限验证\n`);
    checklist.permissionValidations.forEach((validation, vIndex) => {
      sections.push(`### 2.${vIndex + 1} ${validation.role}\n`);
      validation.items.forEach((item, iIndex) => {
        sections.push(`#### AC-${validation.roleId}.${iIndex + 1} ${item.scenario}\n`);
        sections.push(`**验证项**:`);
        item.checks.forEach(check => {
          sections.push(`- [ ] ${check}`);
        });
        sections.push(`\n**测试步骤**:`);
        item.testSteps.forEach((step, sIndex) => {
          sections.push(`${sIndex + 1}. ${step}`);
        });
        sections.push('');
      });
    });
    sections.push(`---`);
  }

  // 3. 交互行为验证
  if (checklist.interactionValidations.length > 0) {
    sections.push(`\n## 3. 交互行为验证\n`);
    checklist.interactionValidations.forEach((validation, vIndex) => {
      sections.push(`### 3.${vIndex + 1} ${validation.category}\n`);
      validation.items.forEach((item, iIndex) => {
        sections.push(`#### AC-${validation.categoryId}.${iIndex + 1} ${item.element} - ${item.trigger}\n`);
        sections.push(`**验证项**:`);
        item.checks.forEach(check => {
          sections.push(`- [ ] ${check}`);
        });
        sections.push(`\n**前置条件**: ${item.precondition}\n`);
      });
    });
    sections.push(`---`);
  }

  // 4. 业务规则验证
  if (checklist.businessRuleValidations.length > 0) {
    sections.push(`\n## 4. 业务规则验证\n`);
    checklist.businessRuleValidations.forEach((validation, vIndex) => {
      sections.push(`#### AC-B${vIndex + 1} ${validation.ruleId}: ${validation.description}\n`);
      sections.push(`**验证项**:`);
      validation.checks.forEach(check => {
        sections.push(`- [ ] ${check}`);
      });
      sections.push(`\n**关联字段**: ${validation.relatedFields}\n`);
      if (validation.testScenarios.length > 0) {
        sections.push(`**测试场景**:`);
        validation.testScenarios.forEach((scenario, sIndex) => {
          sections.push(`- **场景 ${sIndex + 1}**: ${scenario.scenario}`);
          sections.push(`  - 输入: ${scenario.input}`);
          sections.push(`  - 期望: ${scenario.expected}`);
        });
      }
      sections.push('');
    });
    sections.push(`---`);
  }

  // 5. 边界场景验证
  if (checklist.edgeCaseValidations.length > 0) {
    sections.push(`\n## 5. 边界场景验证\n`);
    checklist.edgeCaseValidations.forEach((validation, vIndex) => {
      sections.push(`#### AC-E${vIndex + 1} ${validation.scenario}\n`);
      sections.push(`**验证项**:`);
      validation.checks.forEach(check => {
        sections.push(`- [ ] ${check}`);
      });
      sections.push(`\n**上下文**: ${validation.context}`);
      sections.push(`**兜底行为**: ${validation.fallback}\n`);
    });
    sections.push(`---`);
  }

  // 6. UI展示规则验证
  if (checklist.uiDisplayValidations.length > 0) {
    sections.push(`\n## 6. UI展示规则验证\n`);
    checklist.uiDisplayValidations.forEach((validation, vIndex) => {
      sections.push(`### 6.${vIndex + 1} ${validation.context}\n`);
      validation.items.forEach((item, iIndex) => {
        sections.push(`#### AC-${validation.contextId}.${iIndex + 1} ${item.rule}\n`);
        sections.push(`**验证项**:`);
        item.checks.forEach(check => {
          sections.push(`- [ ] ${check}`);
        });
        if (item.visualChecks.length > 0) {
          sections.push(`\n**视觉检查点**:`);
          item.visualChecks.forEach(check => {
            sections.push(`- ${check}`);
          });
        }
        sections.push('');
      });
    });
    sections.push(`---`);
  }

  // 7. 功能流程验证
  if (checklist.functionalFlowValidations.length > 0) {
    sections.push(`\n## 7. 功能流程验证\n`);
    checklist.functionalFlowValidations.forEach((validation, vIndex) => {
      sections.push(`### 7.${vIndex + 1} ${validation.flowName}\n`);
      sections.push(`**完整流程验证**:`);
      validation.steps.forEach(step => {
        sections.push(`- [ ] ${step}`);
      });
      if (validation.conditionalPaths.length > 0) {
        sections.push(`\n**条件分支验证**:`);
        validation.conditionalPaths.forEach(path => {
          sections.push(`- [ ] ${path.condition}: ${path.expectedBehavior}`);
        });
      }
      if (validation.entryPoints.length > 0) {
        sections.push(`\n**入口路径验证**:`);
        validation.entryPoints.forEach(entry => {
          sections.push(`- [ ] 从 ${entry.entry} 触发 → ${entry.expectedResult}`);
        });
      }
      sections.push('');
    });
    sections.push(`---`);
  }

  // 8. 验收通过标准
  sections.push(`\n## 8. 验收通过标准\n`);
  sections.push(`**必须满足**:`);
  sections.push(`- 所有标记为 "必填" 的字段验证通过`);
  sections.push(`- 所有角色权限验证通过`);
  sections.push(`- 所有业务规则验证通过`);
  sections.push(`- 关键功能流程验证通过`);
  sections.push(``);
  sections.push(`**建议满足**:`);
  sections.push(`- 所有交互行为验证通过`);
  sections.push(`- 所有边界场景验证通过`);
  sections.push(`- 所有UI展示规则验证通过`);
  sections.push(``);
  sections.push(`---`);

  // 9. 验收记录
  sections.push(`\n## 9. 验收记录\n`);
  sections.push(`| 验收项 ID | 验收人 | 验收时间 | 状态 | 备注 |`);
  sections.push(`|-----------|--------|----------|------|------|`);
  sections.push(`| - | - | - | - | - |`);
  sections.push('');

  return sections.join('\n');
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

/**
 * 将任务映射到验证清单项
 * 根据任务的 phase、file、requirement 等属性，关联相关的验收项
 */
function mapTaskToAcceptanceCriteria(
  task: Task,
  checklist: AcceptanceChecklist
): string[] {
  const criteria: string[] = [];

  // 根据任务阶段和文件路径匹配验收项
  const phase = task.phase;
  const file = (task.file || '').toLowerCase();
  const requirement = (task.requirement || '').toLowerCase();

  // 表单相关任务 → 表单验证项
  if (/form|表单|input|输入/.test(requirement) || /form|modal|dialog/.test(file)) {
    checklist.formValidations.forEach(validation => {
      validation.items.forEach((item, index) => {
        if (requirement.includes(item.fieldName.toLowerCase()) ||
            requirement.includes(validation.scene.toLowerCase())) {
          criteria.push(`AC-${validation.sceneId}.${index + 1} ${item.fieldName}`);
        }
      });
    });
  }

  // 权限相关任务 → 权限验证项
  if (/权限|permission|role|auth/.test(requirement) || phase === 'infra') {
    checklist.permissionValidations.forEach(validation => {
      validation.items.forEach((item, index) => {
        if (requirement.includes(validation.role.toLowerCase()) ||
            requirement.includes(item.scenario.toLowerCase())) {
          criteria.push(`AC-${validation.roleId}.${index + 1} ${validation.role} - ${item.scenario}`);
        }
      });
    });
  }

  // 交互相关任务 → 交互验证项
  if (/交互|click|hover|弹窗|modal/.test(requirement) || phase === 'ui-form') {
    checklist.interactionValidations.forEach(validation => {
      validation.items.forEach((item, index) => {
        if (requirement.includes(item.element.toLowerCase()) ||
            requirement.includes(item.trigger.toLowerCase())) {
          criteria.push(`AC-${validation.categoryId}.${index + 1} ${item.element} - ${item.trigger}`);
        }
      });
    });
  }

  // 业务规则相关任务 → 业务规则验证项
  if (/规则|rule|校验|validation|联动/.test(requirement)) {
    checklist.businessRuleValidations.forEach((validation, index) => {
      if (requirement.includes(validation.ruleId.toLowerCase()) ||
          requirement.includes(validation.description.toLowerCase())) {
        criteria.push(`AC-B${index + 1} ${validation.ruleId}`);
      }
    });
  }

  // UI展示相关任务 → UI展示验证项
  if (phase === 'ui-display' || phase === 'ui-layout' || /展示|display|列表|table/.test(requirement)) {
    checklist.uiDisplayValidations.forEach(validation => {
      validation.items.forEach((item, index) => {
        if (requirement.includes(validation.context.toLowerCase()) ||
            requirement.includes(item.rule.toLowerCase())) {
          criteria.push(`AC-${validation.contextId}.${index + 1} ${validation.context} - ${item.rule}`);
        }
      });
    });
  }

  // 边界场景相关任务 → 边界验证项
  if (/边界|异常|error|empty|空/.test(requirement)) {
    checklist.edgeCaseValidations.forEach((validation, index) => {
      if (requirement.includes(validation.scenario.toLowerCase())) {
        criteria.push(`AC-E${index + 1} ${validation.scenario}`);
      }
    });
  }

  // 功能流程相关任务 → 流程验证项
  if (/流程|flow|步骤|创建|编辑/.test(requirement)) {
    checklist.functionalFlowValidations.forEach((validation, index) => {
      if (requirement.includes(validation.flowName.toLowerCase())) {
        criteria.push(`Flow-${index + 1} ${validation.flowName}`);
      }
    });
  }

  // 如果没有匹配到任何验收项，返回通用验收标准
  if (criteria.length === 0) {
    criteria.push('通用验收标准：功能正常、无报错、符合设计规格');
  }

  return criteria;
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
