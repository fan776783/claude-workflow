# workflow archive - 归档工作流 (v3.0)

归档已完成的工作流，将 `changes/` 目录移动到 `archive/`。

## 使用方法

```bash
/workflow archive              # 归档当前工作流
/workflow archive --summary    # 归档并生成变更摘要报告
```

---

## 🎯 执行流程

### Step 1：状态检查

```typescript
const configPath = '.claude/config/project-config.json';

if (!fileExists(configPath)) {
  console.log(`
🚨 项目配置不存在

请先执行：/scan
  `);
  return;
}

const projectConfig = JSON.parse(readFile(configPath));
const projectId = projectConfig.project?.id;

// 路径安全校验
if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
  console.log(`🚨 项目 ID 包含非法字符: ${projectId}`);
  return;
}

const workflowDir = path.join(os.homedir(), '.claude/workflows', projectId);
const statePath = path.join(workflowDir, 'workflow-state.json');

if (!fileExists(statePath)) {
  console.log(`
⚠️ 无活动工作流

当前项目没有可归档的工作流。
  `);
  return;
}

const state = JSON.parse(readFile(statePath));

// 验证状态
if (state.status !== 'completed') {
  console.log(`
⚠️ 工作流未完成

当前状态：${state.status}
只有状态为 completed 的工作流可以归档。

如需强制归档，请先执行：
  /workflow status
  `);
  return;
}
```

---

### Step 2：归档执行

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 工作流归档
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

const changesDir = path.join(workflowDir, 'changes');
const archiveDir = path.join(workflowDir, 'archive');
const archiveTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

// 检查 changes 目录是否存在
if (!fileExists(changesDir)) {
  console.log(`
❌ 无法归档

未找到活动变更目录：${changesDir}
当前工作流状态不完整，请先检查 Intent / Delta 产物是否存在。
  `);
  return;
}

// 确保 archive 目录存在
ensureDir(archiveDir);

// 获取所有变更目录
const changeIds = listDir(changesDir).filter(d => d.startsWith('CHG-'));

if (changeIds.length === 0) {
  console.log(`
❌ 无法归档

changes 目录为空，没有可移动到 archive/ 的变更记录。
  `);
  return;
}

// 移动每个变更到归档目录
for (const changeId of changeIds) {
  const srcPath = path.join(changesDir, changeId);
  const destPath = path.join(archiveDir, changeId);

  await Bash({ command: `mv "${srcPath}" "${destPath}"` });

  console.log(`✅ 已归档: ${changeId}`);
}

console.log(`
📊 归档完成

- 归档变更数: ${changeIds.length}
- 归档目录: ${archiveDir}
`);
```

---

### Step 3：生成摘要（可选）

```typescript
const args = $ARGUMENTS.join(' ');
const generateSummary = args.includes('--summary');

if (generateSummary) {
  console.log(`
📝 生成变更摘要...
  `);

  const summaryPath = path.join(archiveDir, `archive-summary-${archiveTimestamp}.md`);

  // 读取所有归档的 delta.json
  const archivedChanges = listDir(archiveDir)
    .filter(d => d.startsWith('CHG-'))
    .sort();

  let summaryContent = `# 工作流归档摘要

**任务名称**: ${state.task_name}
**归档时间**: ${new Date().toISOString()}
**技术方案**: ${state.tech_design}

## 变更历史

| Change ID | 类型 | 摘要 | 状态 |
|-----------|------|------|------|
`;

  for (const changeId of archivedChanges) {
    const deltaPath = path.join(archiveDir, changeId, 'delta.json');
    if (fileExists(deltaPath)) {
      const delta = JSON.parse(readFile(deltaPath));
      summaryContent += `| ${delta.id} | ${delta.trigger.type} | ${delta.trigger.description.substring(0, 50)}... | ${delta.status} |\n`;
    }
  }

  summaryContent += `

## 任务统计

- **总任务数**: ${state.progress.completed.length + state.progress.skipped.length + state.progress.failed.length}
- **已完成**: ${state.progress.completed.length}
- **已跳过**: ${state.progress.skipped.length}
- **失败**: ${state.progress.failed.length}

## 质量关卡

`;

  for (const [gateName, gate] of Object.entries(state.quality_gates || {})) {
    summaryContent += `- **${gateName}**: ${gate.overall_passed ? '✅ 通过' : '❌ 未通过'} (Stage 1: ${gate.stage1.attempts} attempts${gate.stage2 ? ', Stage 2: ' + gate.stage2.assessment : ''})\n`;
  }

  writeFile(summaryPath, summaryContent);

  console.log(`
✅ 摘要已生成: ${summaryPath}
  `);
}
```

---

### Step 4：更新状态

```typescript
// 更新状态为 archived
state.status = 'archived';
state.archived_at = new Date().toISOString();
state.updated_at = new Date().toISOString();

// 清空 delta_tracking 的当前活动变更指针
if (state.delta_tracking) {
  state.delta_tracking.current_change = null;
}

writeFile(statePath, JSON.stringify(state, null, 2));

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 归档完成！

**任务名称**: ${state.task_name}
**状态**: archived
**归档时间**: ${state.archived_at}

**文件结构**:
~/.claude/workflows/${projectId}/
├── workflow-state.json        ← 状态已更新为 archived
├── tasks-*.md
└── archive/                   ← 归档目录
    └── CHG-*/
        ├── delta.json
        ├── intent.md
        └── review-status.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 工作流已归档，可以开始新的任务了！

\`\`\`bash
/workflow start "新功能描述"
\`\`\`
`);
```

---

## 📦 辅助函数

```typescript
/**
 * 列出目录内容
 */
function listDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}
```
