---
description: 执行工作流下一步 - 自动识别并执行当前应完成的步骤
allowed-tools: SlashCommand(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*), Task(*), AskUserQuestion(*), mcp__codex__codex(*), TodoWrite(*)
---

# 智能工作流执行

自动读取任务记忆，识别当前步骤，执行并更新进度。

## 🔍 执行流程

### Step 1：查找并读取任务记忆

#### 1.1 生成项目唯一标识

```typescript
// 基于当前工作目录生成项目 ID
function getProjectId(): string {
  const cwd = process.cwd(); // 例如：/Users/ws/dev/super-agent-web
  const hash = crypto.createHash('md5')
    .update(cwd)
    .digest('hex')
    .substring(0, 12); // 取前12位，例如：a1b2c3d4e5f6
  return hash;
}

// 获取用户级工作流记忆路径
function getWorkflowMemoryPath(): string {
  const projectId = getProjectId();
  const workflowDir = path.join(
    os.homedir(),
    '.claude/workflows',
    projectId
  );
  return path.join(workflowDir, 'workflow-memory.json');
}

// 示例：~/.claude/workflows/a1b2c3d4e5f6/workflow-memory.json
```

#### 1.2 查找任务记忆（多种方式，智能兜底）

```typescript
const currentProjectPath = process.cwd();
let memoryPath: string | null = null;
let storageType: 'user-deterministic' | 'user-meta' | 'project' | null = null;

// 方式1：用户级路径 - 基于确定性哈希（推荐，新方案）
const deterministicPath = getWorkflowMemoryPath();
// 例如：~/.claude/workflows/064bbaef59e4/workflow-memory.json

if (fileExists(deterministicPath)) {
  memoryPath = deterministicPath;
  storageType = 'user-deterministic';
  console.log(`✅ 发现用户级工作流记忆（确定性路径）`);
  console.log(`📂 路径：${deterministicPath}\n`);
}

// 方式2：用户级路径 - 通过元数据文件搜索（兼容随机ID方案）
if (!memoryPath) {
  const workflowsDir = path.join(os.homedir(), '.claude/workflows');

  if (fs.existsSync(workflowsDir)) {
    const dirs = fs.readdirSync(workflowsDir);

    for (const dir of dirs) {
      const metaPath = path.join(workflowsDir, dir, 'project-meta.json');

      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

        // 匹配项目路径
        if (meta.project_path === currentProjectPath) {
          const candidatePath = path.join(workflowsDir, dir, 'workflow-memory.json');

          if (fs.existsSync(candidatePath)) {
            const workflowMemory = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));

            // 只使用 in_progress 状态的工作流
            if (workflowMemory.status === 'in_progress') {
              memoryPath = candidatePath;
              storageType = 'user-meta';
              console.log(`✅ 发现用户级工作流记忆（通过元数据匹配）`);
              console.log(`📂 路径：${candidatePath}`);
              console.log(`📋 项目 ID：${dir}\n`);
              break;
            }
          }
        }
      }
    }
  }
}

// 方式3：项目级路径（旧方案，向后兼容）
if (!memoryPath) {
  const projectLevelPath = '.claude/workflow-memory.json';

  if (fileExists(projectLevelPath)) {
    memoryPath = projectLevelPath;
    storageType = 'project';
    console.log(`⚠️ 发现项目级工作流记忆（旧方案）`);
    console.log(`📂 路径：${projectLevelPath}`);
    console.log(`💡 建议迁移到用户级目录以避免 Git 冲突\n`);
  }
}

// 未找到任何工作流记忆
if (!memoryPath) {
  console.log(`❌ 未发现工作流任务记忆！\n`);
  console.log(`当前项目：${currentProjectPath}`);
  console.log(`项目 ID（确定性）：${getProjectId()}`);
  console.log(`预期路径：${deterministicPath}\n`);
  console.log(`请先使用以下命令之一初始化工作流：`);
  console.log(`  /workflow-start "功能需求描述"`);
  console.log(`  /workflow-quick-dev "功能需求描述"`);
  console.log(`  /workflow-fix-bug "Bug 描述"`);
  throw new Error('工作流任务记忆不存在');
}

// 读取工作流记忆
const memory = JSON.parse(readFile(memoryPath));

// 读取项目配置（用于恢复上下文）
const projectConfigPath = '.claude/config/project-config.json';
const projectConfig = fileExists(projectConfigPath)
  ? JSON.parse(readFile(projectConfigPath))
  : null;
```

---

### Step 1.5：上下文恢复（清理后自动执行）⭐ NEW

**当检测到上下文被清理后，自动从持久化文件恢复关键信息**：

```typescript
/**
 * 恢复上下文摘要
 * 在 /clear 后执行时，输出关键信息帮助 AI 快速恢复任务理解
 */
function restoreContextSummary(memory: WorkflowMemory, config: ProjectConfig | null): void {
  console.log(`
📋 **上下文恢复**

---

## 📌 任务概要

**任务名称**：${memory.task_name}
**任务描述**：${memory.task_description}
**复杂度**：${memory.complexity}
**当前进度**：${memory.current_step_id} / ${memory.total_steps}

---

## 🎯 需求理解

**摘要**：${memory.requirements?.summary || '（未记录）'}

**验收标准**：
${(memory.requirements?.acceptanceCriteria || []).map(c => `- ${c}`).join('\n') || '（未记录）'}

**业务背景**：
${(memory.requirements?.businessContext || []).map(c => `- ${c}`).join('\n') || '（未记录）'}

---

## ⚙️ 用户偏好

**禁止使用的库**：${memory.userPreferences?.libraries?.avoid?.join(', ') || '无'}
**首选库**：${memory.userPreferences?.libraries?.prefer?.join(', ') || '无'}
**代码风格覆盖**：${Object.keys(memory.userPreferences?.codingStyleOverrides || {}).length > 0
    ? JSON.stringify(memory.userPreferences.codingStyleOverrides)
    : '无'}

---

## 📝 关键决策

${(memory.decisions || []).filter(d => d.status === 'accepted').map(d =>
  `- **${d.title}**：${d.summary}`
).join('\n') || '（无已确认决策）'}

---

## ⚠️ 待解决问题

${(memory.issues || []).filter(i => i.status === 'open').map(i =>
  `- **${i.title}**：${i.description}`
).join('\n') || '（无待解决问题）'}

---

## 📦 已生成产物

${Object.entries(memory.artifacts || {})
  .filter(([_, v]) => v)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n') || '（暂无产物）'}

---
  `);

  // 如果有项目配置，也输出关键信息
  if (config) {
    const prefs = config.conventions?.preferences;
    if (prefs?.bannedLibraries?.length > 0 || Object.keys(prefs?.preferredLibraries || {}).length > 0) {
      console.log(`
## 🏗️ 项目级约定

**禁止库**：${prefs.bannedLibraries?.join(', ') || '无'}
**首选库**：${JSON.stringify(prefs.preferredLibraries || {})}

---
      `);
    }
  }
}

// 检测是否需要恢复上下文（首次执行或清理后）
// 通过检查 memory 中的 last_context_restored_at 字段
const needsContextRestore =
  !memory.last_context_restored_at ||
  memory.clear_context_prompted_for; // 如果刚提示过清理，说明可能已清理

if (needsContextRestore && memory.requirements?.summary) {
  restoreContextSummary(memory, projectConfig);
  memory.last_context_restored_at = new Date().toISOString();
  saveMemory(memory);
}
```

**上下文恢复时机**：

| 场景 | 行为 |
|-----|------|
| 首次执行步骤 | 输出完整上下文摘要 |
| `/clear` 后继续 | 自动恢复关键信息 |
| 同一对话连续执行 | 跳过恢复（避免重复输出） |

**存储路径说明**：

**工作流状态**（用户级，避免 Git 冲突）：
- ✅ **推荐**：`~/.claude/workflows/{project_id}/workflow-memory.json`
  - 基于当前工作目录自动生成项目ID
  - 完全避免 Git 冲突
  - 多人协作无冲突
- ⚠️ **旧方案**：`.claude/workflow-memory.json`（向后兼容）

**文档产物**（项目级，便于团队共享）：
- 上下文摘要：`.claude/context-summary-{task_name}.md`
- 验证报告：`.claude/verification-report-{task_name}.md`
- 技术方案：`.claude/tech-design/{task_name}.md`
- 操作日志：`.claude/operations-log-{task_name}.md`

**项目识别机制**：
```typescript
// 示例
当前工作目录：/Users/ws/dev/super-agent-web
项目 ID（MD5前12位）：b8e3f9a12c45
用户级路径：~/.claude/workflows/b8e3f9a12c45/workflow-memory.json
```

---

### Step 2：找到当前步骤

```typescript
// 找到第一个状态为 pending 或 in_progress 的步骤
const currentStep = memory.steps.find(step =>
  step.status === 'pending' || step.status === 'in_progress'
);

if (!currentStep) {
  // 所有步骤都已完成
  return completeWorkflow(memory);
}

// 检查依赖是否满足
if (currentStep.depends_on && currentStep.depends_on.length > 0) {
  for (const depId of currentStep.depends_on) {
    const depStep = memory.steps.find(s => s.id === depId);
    if (depStep.status !== 'completed') {
      throw new Error(`步骤 ${currentStep.id} 依赖步骤 ${depId} 未完成`);
    }
  }
}

// 检查是否是质量关卡
const isQualityGate = currentStep.quality_gate === true;
const threshold = currentStep.threshold || 80;
```

---

### Step 2.5：智能上下文清理检测 ⭐ NEW

**在执行步骤前，检测是否需要清理上下文**：

```typescript
// 获取前一个已完成的步骤
const previousStep = memory.steps
  .filter(s => s.status === 'completed')
  .sort((a, b) => b.id - a.id)[0];

// 检测是否需要清理上下文
const clearLevel = shouldClearContext(currentStep, previousStep, memory);

// 构建 memory key（包含 workflow 启动时间戳，确保不同 run 独立）
const clearPromptKey = `${memory.started_at}_${currentStep.id}`;

if (clearLevel === 'required') {
  // 强建议：检测是否已经提示过（避免重复打断）
  const alreadyPrompted = memory.clear_context_prompted_for === clearPromptKey;

  if (!alreadyPrompted) {
    // 记录已提示
    memory.clear_context_prompted_for = clearPromptKey;
    saveMemory(memory);

    // 输出清理建议并中断执行
    return showContextClearSuggestion(currentStep, previousStep, 'required');
  }
  // 如果已提示过，用户选择继续，则不再拦截
} else if (clearLevel === 'suggested') {
  // 软建议：仅提示，不中断执行
  const alreadySuggested = memory.clear_context_suggested_for === clearPromptKey;

  if (!alreadySuggested) {
    memory.clear_context_suggested_for = clearPromptKey;
    saveMemory(memory);

    // 显示软建议提示（不中断）
    showContextClearSuggestion(currentStep, previousStep, 'suggested');
    // 继续执行，不 return
  }
}

/**
 * 判断是否需要清理上下文
 *
 * 返回值：
 * - 'required': 强烈建议清理（触发 detect & halt）
 * - 'suggested': 软建议清理（仅提示，不中断）
 * - 'none': 不需要清理
 */
function shouldClearContext(
  currentStep: WorkflowStep,
  previousStep: WorkflowStep | null,
  memory: WorkflowMemory
): 'required' | 'suggested' | 'none' {
  // 1. 显式声明需要对话上下文 → 禁止清理
  if (currentStep.context_needs_chat === true) return 'none';

  // 2. 显式策略优先
  if (currentStep.context_policy === 'fresh') return 'required';
  if (currentStep.context_policy === 'inherit') return 'none';

  // 3. auto 或未设置 → 启发式判定
  const policy = currentStep.context_policy ?? 'auto';

  if (policy === 'auto') {
    const analysisPhases = ['analyze', 'design'];
    const executionPhases = ['implement', 'test', 'verify', 'deliver'];

    // Phase 变化：从分析/设计 → 实现/测试/验证（强建议）
    if (previousStep &&
        analysisPhases.includes(previousStep.phase) &&
        executionPhases.includes(currentStep.phase)) {
      return 'required';
    }

    // 长时间间隔：超过 30 分钟未执行（软建议，仅在执行类阶段）
    if (previousStep?.completed_at &&
        executionPhases.includes(currentStep.phase)) {
      const lastCompleted = new Date(previousStep.completed_at);
      const now = new Date();
      const minutesSinceLastStep = (now.getTime() - lastCompleted.getTime()) / 60000;
      if (minutesSinceLastStep > 30) {
        return 'suggested';  // 软建议，不中断执行
      }
    }
  }

  return 'none';
}

/**
 * 显示上下文清理建议
 *
 * @param level - 'required' 强建议（中断执行）, 'suggested' 软建议（不中断）
 */
function showContextClearSuggestion(
  currentStep: WorkflowStep,
  previousStep: WorkflowStep | null,
  level: 'required' | 'suggested'
): void {
  // 判断原因
  let reason: string;
  if (currentStep.context_policy === 'fresh') {
    reason = '当前步骤标记为需要干净上下文';
  } else if (previousStep) {
    const analysisPhases = ['analyze', 'design'];
    const executionPhases = ['implement', 'test', 'verify', 'deliver'];

    if (analysisPhases.includes(previousStep.phase) &&
        executionPhases.includes(currentStep.phase)) {
      reason = `从「${previousStep.phase}」阶段切换到「${currentStep.phase}」阶段`;
    } else {
      reason = `距离上次执行已超过 30 分钟`;
    }
  } else {
    reason = '当前步骤适合在干净上下文中执行';
  }

  if (level === 'required') {
    // 强建议：中断执行
    console.log(`
🧹 **建议清理上下文**

**原因**：${reason}
**当前步骤**：${currentStep.name}（${currentStep.phase} 阶段）

---

为获得最佳效果，建议执行以下操作：

1️⃣ 执行 \`/clear\` 清空当前对话上下文
2️⃣ 再次执行 \`/workflow-execute\` 继续工作流

---

💡 **说明**：
- 清理上下文可释放 token 空间，让 AI 更专注于当前任务
- 前序步骤的产出已保存到文件，不会丢失
- 如果选择不清理，再次执行 \`/workflow-execute\` 即可继续（本提示不再出现）

⚠️ 如果当前对话中有重要的未保存信息，请先手动保存后再清理。
    `);
  } else {
    // 软建议：仅提示，不中断
    console.log(`
💡 **提示**：${reason}，建议考虑执行 \`/clear\` 清理上下文。

继续执行当前步骤...
    `);
  }
}
```

**Step 定义中的新字段**：

```typescript
interface WorkflowStep {
  // ... 现有字段

  /**
   * 上下文策略（可选）
   * - 'inherit': 继承当前上下文（默认）
   * - 'fresh': 建议在干净上下文中执行
   * - 'auto': 自动检测（基于 phase 变化等）
   */
  context_policy?: 'inherit' | 'fresh' | 'auto';

  /**
   * 是否需要对话历史（可选）
   * - true: 该步骤强依赖之前的对话内容，禁止建议清理
   * - false/undefined: 可以考虑清理
   */
  context_needs_chat?: boolean;
}
```

---

### Step 3：显示当前进度

```markdown
📍 **工作流进度**：{{current_step_id}} / {{total_steps}}（{{percentage}}）

**当前步骤**：{{currentStep.name}}
**所属阶段**：{{currentStep.phase}}
**预计耗时**：{{currentStep.estimated_time}}
**描述**：{{currentStep.description}}

{{if isQualityGate}}
⚠️ **这是质量关卡**：此步骤评分需 ≥ {{threshold}}，否则无法继续
{{endif}}

---
```

---

### Step 4：根据 action 类型执行

```typescript
// 标记步骤为 in_progress
currentStep.status = 'in_progress';
currentStep.started_at = new Date().toISOString();
saveMemory(memory);

// 根据 action 类型执行相应操作
switch (currentStep.action) {
  case 'context_load':
    await executeContextLoad(memory, currentStep);
    break;

  case 'analyze_requirements':
    await executeAnalyzeRequirements(memory, currentStep);
    break;

  case 'ask_user':
    await executeAskUser(memory, currentStep);
    break;

  case 'explore_code':
    await executeExploreCode(memory, currentStep);
    break;

  case 'architect_review':
    await executeArchitectReview(memory, currentStep);
    break;

  case 'specialized_analysis':
    await executeSpecializedAnalysis(memory, currentStep);
    break;

  case 'write_tech_design':
    await writeTechDesign(memory, currentStep);
    break;

  case 'codex_review_design':
    await codexReviewDesign(memory, currentStep);
    break;

  case 'optimize_design':
    await optimizeDesign(memory, currentStep);
    break;

  case 'code':
    await executeCode(memory, currentStep);
    break;

  case 'write_tests':
    await executeWriteTests(memory, currentStep);
    break;

  case 'run_tests':
    await executeRunTests(memory, currentStep);
    break;

  case 'codex_review_code':
    await codexReviewCode(memory, currentStep);
    break;

  case 'specialized_review':
    await executeSpecializedReview(memory, currentStep);
    break;

  case 'analyze_performance':
    await executeAnalyzePerformance(memory, currentStep);
    break;

  case 'write_verification_report':
    await writeVerificationReport(memory, currentStep);
    break;

  case 'write_docs':
  case 'write_api_docs':
  case 'write_usage_docs':
  case 'update_tech_design':
    await executeWriteDocs(memory, currentStep);
    break;

  case 'commit':
    await executeCommit(memory, currentStep);
    break;

  case 'write_summary':
    await writeWorkflowSummary(memory, currentStep);
    break;

  // ========== 后端工作流专用 Action ==========

  case 'backend_generate_xq':
    await backendGenerateXq(memory, currentStep);
    break;

  case 'backend_review_xq':
    await backendReviewXq(memory, currentStep);
    break;

  case 'backend_generate_fasj':
    await backendGenerateFasj(memory, currentStep);
    break;

  case 'backend_refine_fasj':
    await backendRefineFasj(memory, currentStep);
    break;

  case 'backend_plan_implementation':
    await backendPlanImplementation(memory, currentStep);
    break;

  case 'backend_self_verify':
    await backendSelfVerify(memory, currentStep);
    break;

  default:
    throw new Error(`未知的 action 类型：${currentStep.action}`);
}
```

---

### Step 5：处理质量关卡

```typescript
if (isQualityGate) {
  const score = currentStep.actual_score;

  if (score === undefined || score === null) {
    throw new Error('质量关卡步骤必须设置 actual_score');
  }

  if (score < threshold) {
    // 质量关卡未通过
    currentStep.status = 'failed';
    currentStep.failed_at = new Date().toISOString();
    currentStep.failure_reason = `评分 ${score} 低于阈值 ${threshold}`;
    saveMemory(memory);

    return showQualityGateFailure(memory, currentStep, score, threshold);
  }

  // 质量关卡通过
  const gateKey = Object.keys(memory.quality_gates).find(
    key => memory.quality_gates[key].step_id === currentStep.id
  );
  if (gateKey) {
    memory.quality_gates[gateKey].actual_score = score;
    memory.quality_gates[gateKey].passed = true;
  }
}
```

---

### Step 6：更新步骤状态

```typescript
currentStep.status = 'completed';
currentStep.completed_at = new Date().toISOString();

// 更新任务记忆
memory.current_step_id = currentStep.id + 1;
memory.updated_at = new Date().toISOString();

saveMemory(memory);
```

---

### Step 7：显示完成信息并提示下一步

```markdown
✅ **步骤完成**：{{currentStep.name}}

{{if currentStep.output_artifacts}}
📦 **产出物**：
{{for artifact in currentStep.output_artifacts}}
- {{artifact}}
{{endfor}}
{{endif}}

{{if isQualityGate}}
🎯 **质量评分**：{{score}} / 100（阈值：{{threshold}}）
✅ 质量关卡通过！
{{endif}}

---

## 📊 总体进度

{{progressBar}}

**已完成**：{{completed_count}} / {{total_steps}}
**剩余步骤**：{{remaining_count}}
**预计剩余时间**：{{estimated_remaining_time}}

---

{{if hasNextStep}}
## 🚀 下一步

**步骤 {{nextStep.id}}**：{{nextStep.name}}
**阶段**：{{nextStep.phase}}
**预计耗时**：{{nextStep.estimated_time}}

{{if shouldSwitchDialog}}
💡 **建议**：下一步是关键步骤，建议在新对话窗口中执行，避免上下文消耗。

在新对话中执行：
\```bash
/workflow-execute
\```
{{else}}
继续执行：
\```bash
/workflow-execute
\```
{{endif}}

{{else}}
## 🎉 工作流已完成！

**任务名称**：{{memory.task_name}}
**总耗时**：{{total_time}}
**最终评分**：{{final_score}} / 100

📦 **交付产物**：
{{for artifact in memory.artifacts}}
- {{artifact.name}}：{{artifact.path}}
{{endfor}}

查看工作流总结：
\```bash
cat {{memory.artifacts.workflow_summary}}
\```
{{endif}}
```

---

## 🧰 Memory 更新 Helper Functions ⭐ NEW

**用途**: 在关键步骤中保持 workflow-memory.json 的关键字段同步更新,确保上下文恢复时信息完整。

### 核心 Helpers

```typescript
/**
 * 更新需求理解
 * 调用时机: analyze_requirements, ask_user
 */
function updateRequirements(
  memory: WorkflowMemory,
  updates: Partial<{
    summary: string;
    acceptanceCriteria: string[];
    nonFunctional: string[];
    businessContext: string[];
    openQuestions: string[];
  }>
): void {
  memory.requirements = {
    ...memory.requirements,
    ...updates
  };
  memory.meta.lastUpdatedAt = new Date().toISOString();
  saveMemory(memory);
}

/**
 * 添加关键决策
 * 调用时机: ask_user, codex_review_design, optimize_design
 */
function addDecision(
  memory: WorkflowMemory,
  decision: {
    title: string;
    summary: string;
    rationale?: string[];
    status?: 'proposed' | 'accepted' | 'rejected';
    madeAtStep: string;
  }
): void {
  const id = `D-${String(memory.decisions.length + 1).padStart(3, '0')}`;

  memory.decisions.push({
    id,
    ...decision,
    status: decision.status || 'accepted',
    timestamp: new Date().toISOString()
  });

  memory.meta.lastUpdatedAt = new Date().toISOString();
  saveMemory(memory);
}

/**
 * 添加发现的问题
 * 调用时机: explore_code, codex_review_design, codex_review_code
 */
function addIssue(
  memory: WorkflowMemory,
  issue: {
    title: string;
    description: string;
    impact: '高' | '中' | '低';
    status?: 'open' | 'resolved' | 'ignored';
    workaround?: string;
    foundAtStep: string;
  }
): void {
  const id = `I-${String(memory.issues.length + 1).padStart(3, '0')}`;

  memory.issues.push({
    id,
    ...issue,
    status: issue.status || 'open',
    workaround: issue.workaround || '',
    timestamp: new Date().toISOString()
  });

  memory.meta.lastUpdatedAt = new Date().toISOString();
  saveMemory(memory);
}

/**
 * 更新用户偏好
 * 调用时机: ask_user, explore_code
 */
function updateUserPreferences(
  memory: WorkflowMemory,
  updates: {
    avoidLibraries?: string[];
    preferLibraries?: string[];
    codingStyleOverrides?: Record<string, any>;
  }
): void {
  if (updates.avoidLibraries) {
    memory.userPreferences.libraries.avoid = [
      ...new Set([...memory.userPreferences.libraries.avoid, ...updates.avoidLibraries])
    ];
  }

  if (updates.preferLibraries) {
    memory.userPreferences.libraries.prefer = [
      ...new Set([...memory.userPreferences.libraries.prefer, ...updates.preferLibraries])
    ];
  }

  if (updates.codingStyleOverrides) {
    memory.userPreferences.codingStyleOverrides = {
      ...memory.userPreferences.codingStyleOverrides,
      ...updates.codingStyleOverrides
    };
  }

  memory.meta.lastUpdatedAt = new Date().toISOString();
  saveMemory(memory);
}

/**
 * 更新领域上下文
 * 调用时机: analyze_requirements, explore_code
 */
function updateDomainContext(
  memory: WorkflowMemory,
  updates: {
    businessGoals?: string[];
    glossary?: Array<{ term: string; definition: string }>;
    constraints?: string[];
  }
): void {
  if (updates.businessGoals) {
    memory.domainContext.businessGoals = [
      ...memory.domainContext.businessGoals,
      ...updates.businessGoals
    ];
  }

  if (updates.glossary) {
    memory.domainContext.glossary = [
      ...memory.domainContext.glossary,
      ...updates.glossary
    ];
  }

  if (updates.constraints) {
    memory.domainContext.constraints = [
      ...memory.domainContext.constraints,
      ...updates.constraints
    ];
  }

  memory.meta.lastUpdatedAt = new Date().toISOString();
  saveMemory(memory);
}

/**
 * 解决已记录的问题
 * 调用时机: optimize_design, executeCode
 */
function resolveIssue(
  memory: WorkflowMemory,
  issueId: string,
  resolution: {
    status: 'resolved' | 'ignored';
    workaround?: string;
  }
): void {
  const issue = memory.issues.find(i => i.id === issueId);

  if (issue) {
    issue.status = resolution.status;
    if (resolution.workaround) {
      issue.workaround = resolution.workaround;
    }

    memory.meta.lastUpdatedAt = new Date().toISOString();
    saveMemory(memory);
  }
}
```

### 使用约定

| Action | 应调用的 Helpers | 说明 |
|--------|----------------|------|
| `analyze_requirements` | `updateRequirements()`, `updateDomainContext()` | 分析用户需求时更新需求理解和领域上下文 |
| `ask_user` | `updateRequirements()`, `addDecision()`, `updateUserPreferences()` | 用户回答问题后记录决策和偏好 |
| `explore_code` | `updateDomainContext()`, `addIssue()` | 探索代码时发现的领域知识和潜在问题 |
| `codex_review_design` | `addIssue()`, `addDecision()` | Codex 审查方案时发现的问题和建议的改进决策 |
| `optimize_design` | `addDecision()`, `resolveIssue()` | 优化方案时的决策和问题解决 |
| `codex_review_code` | `addIssue()` | Codex 代码审查时发现的问题 |

**注意**: 这些 helpers 是**可选的辅助工具**,不是强制要求。在实施步骤时:
- ✅ 有明确信息需要保存时调用
- ❌ 不要为了调用而调用
- ✅ 保持 memory 数据的准确性和相关性

---

## 🔧 Action 执行细节

### context_load

```typescript
async function executeContextLoad(memory, step) {
  // 调用 /context-load
  const result = await executeCommand(`/context-load "${memory.task_description}"`);

  // 上下文摘要存储在项目目录中
  const summaryPath = `.claude/context-summary-${sanitize(memory.task_name)}.md`;

  // 更新产出物
  step.output_artifacts = [summaryPath];
  memory.artifacts.context_summary = summaryPath;
}
```

**说明**：产出文档存储在项目目录 `.claude/` 中，便于团队共享和版本控制。

### analyze_requirements

```typescript
async function executeAnalyzeRequirements(memory, step) {
  // 调用 /analyze-requirements
  await executeCommand('/analyze-requirements');

  // ⭐ Memory 更新指南：
  // 在需求分析过程中,应根据实际情况调用以下 helpers:

  // 1. 补充或完善需求理解
  if (发现了新的验收标准或非功能需求) {
    updateRequirements(memory, {
      acceptanceCriteria: ['新发现的验收标准'],
      nonFunctional: ['性能要求', '安全要求等'],
      businessContext: ['业务背景补充']
    });
  }

  // 2. 记录领域知识
  if (识别到业务目标或术语) {
    updateDomainContext(memory, {
      businessGoals: ['具体的业务目标'],
      glossary: [
        { term: '专业术语', definition: '定义' }
      ],
      constraints: ['技术或业务约束']
    });
  }

  // 示例：
  // updateRequirements(memory, {
  //   acceptanceCriteria: [
  //     '用户只能访问所属租户的数据',
  //     '超级管理员可以跨租户管理'
  //   ],
  //   nonFunctional: ['权限检查响应时间 < 50ms']
  // });
  //
  // updateDomainContext(memory, {
  //   glossary: [
  //     { term: 'Tenant', definition: '租户,代表一个独立的组织或企业客户' },
  //     { term: 'RBAC', definition: 'Role-Based Access Control,基于角色的访问控制' }
  //   ]
  // });
}
```

### ask_user

```typescript
async function executeAskUser(memory, step) {
  // 检查是否有歧义
  const hasAmbiguity = checkAmbiguity(memory);

  if (!hasAmbiguity) {
    // 跳过此步骤
    step.status = 'skipped';
    step.skipped_reason = '无歧义，无需用户确认';
    return;
  }

  // 使用 AskUserQuestion 工具确认
  const questions = prepareQuestions(memory);
  const answers = await AskUserQuestion({ questions });

  // ⭐ Memory 更新指南：
  // 根据用户回答的内容,应该调用相应的 helpers:

  // 1. 记录用户的关键决策
  if (用户做出了架构或实现方案的选择) {
    addDecision(memory, {
      title: '决策标题',
      summary: '用户选择了 XXX 方案',
      rationale: ['选择理由1', '选择理由2'],
      madeAtStep: step.phase
    });
  }

  // 2. 更新用户偏好(如库选择、代码风格等)
  if (用户表达了库或工具偏好) {
    updateUserPreferences(memory, {
      avoidLibraries: ['用户不想用的库'],
      preferLibraries: ['用户偏好的库']
    });
  }

  // 3. 补充需求细节
  if (用户澄清了需求细节) {
    updateRequirements(memory, {
      acceptanceCriteria: ['补充的验收标准'],
      openQuestions: [] // 清空已回答的问题
    });
  }

  // 示例：
  // 假设用户选择了使用 JWT 认证
  // addDecision(memory, {
  //   title: '使用 JWT 进行身份认证',
  //   summary: '用户确认使用 JWT token 而不是 session',
  //   rationale: ['无状态,易于扩展', '前后端分离友好'],
  //   madeAtStep: 'design'
  // });
  //
  // 假设用户表示不想使用某个库
  // updateUserPreferences(memory, {
  //   avoidLibraries: ['passport.js'],
  //   preferLibraries: ['jsonwebtoken']
  // });
}
```

### explore_code

```typescript
async function executeExploreCode(memory, step) {
  // 调用 /explore-code
  const topic = extractExploreTopic(memory);
  await executeCommand(`/explore-code 探索 ${topic} 的实现模式`);

  // ⭐ Memory 更新指南：
  // 在探索代码库的过程中,应根据发现记录相关信息:

  // 1. 记录发现的问题或风险
  if (发现了潜在问题或技术债务) {
    addIssue(memory, {
      title: '问题标题',
      description: '详细描述',
      impact: '高' | '中' | '低',
      foundAtStep: step.phase
    });
  }

  // 2. 更新领域知识(架构模式、专业术语等)
  if (识别到架构约束或领域术语) {
    updateDomainContext(memory, {
      constraints: ['发现的架构约束'],
      glossary: [
        { term: '领域术语', definition: '在代码中的含义' }
      ]
    });
  }

  // 示例：
  // 发现现有认证系统使用了自定义中间件
  // updateDomainContext(memory, {
  //   constraints: ['现有认证使用 custom-auth 中间件,需保持兼容'],
  //   glossary: [
  //     { term: 'AuthContext', definition: '全局认证上下文,通过 middleware 注入' }
  //   ]
  // });
  //
  // 发现了一个潜在问题
  // addIssue(memory, {
  //   title: '现有 User 表缺少 tenant_id 字段',
  //   description: '需要添加数据库迁移脚本',
  //   impact: '中',
  //   foundAtStep: 'analyze'
  // });
}
```

### codex_review_design

```typescript
async function codexReviewDesign(memory, step) {
  const techDesignPath = memory.artifacts.tech_design;

  if (!techDesignPath || !fileExists(techDesignPath)) {
    throw new Error('技术方案文档不存在，无法进行 Codex 审查');
  }

  const result = await mcp__codex__codex({
    PROMPT: `请审查技术方案文档：${techDesignPath}

请重点关注：
1. 需求拆解是否完整
2. 架构设计是否合理
3. 实施计划是否可行
4. 风险评估是否充分
5. 验收标准是否明确
6. 可复用组件的选择是否恰当

请提供：
- 综合评分（0-100分）
- 优点和不足
- 改进建议
- 是否建议开始实施

以 Markdown 格式输出审查意见。`,
    cd: process.cwd(),  // 自动使用当前工作目录
    sandbox: "read-only"
  });

  // 提取评分
  const score = extractScore(result);
  step.actual_score = score;

  // 保存 SESSION_ID 供后续使用
  memory.codex_session_id = result.session_id;

  // 将审查意见追加到技术方案文档
  appendToFile(techDesignPath, `\n\n## Codex 审查意见\n\n${result.output}`);

  // ⭐ Memory 更新指南：
  // 根据 Codex 审查结果记录问题和建议:

  // 1. 记录 Codex 发现的问题
  if (score < 80 && result.output.includes('问题') || result.output.includes('不足')) {
    // 从审查意见中提取问题
    const issues = extractIssuesFromReview(result.output);
    issues.forEach(issue => {
      addIssue(memory, {
        title: issue.title,
        description: issue.description,
        impact: '中',
        foundAtStep: 'design'
      });
    });
  }

  // 2. 如果 Codex 建议优化方案,记录为决策
  if (result.output.includes('建议') && score >= 70) {
    const suggestions = extractSuggestions(result);
    if (suggestions.length > 0) {
      addDecision(memory, {
        title: 'Codex 审查优化建议',
        summary: suggestions.join('; '),
        status: 'proposed',
        madeAtStep: 'design'
      });
    }
  }

  // 示例：
  // addIssue(memory, {
  //   title: '缺少租户切换的权限验证',
  //   description: 'Codex 指出超级管理员切换租户时缺少权限验证逻辑',
  //   impact: '中',
  //   foundAtStep: 'design'
  // });
  //
  // addDecision(memory, {
  //   title: '补充性能测试计划',
  //   summary: 'Codex 建议明确权限检查的性能测试指标',
  //   status: 'proposed',
  //   madeAtStep: 'design'
  // });

  // 如果评分低，给出建议
  if (score < 80) {
    step.suggestions = extractSuggestions(result);
  }
}
```

### codex_review_code

```typescript
async function codexReviewCode(memory, step) {
  const techDesignPath = memory.artifacts.tech_design;
  const modifiedFiles = memory.implementation?.files_modified || [];

  const result = await mcp__codex__codex({
    PROMPT: `请审查代码实现：

**技术方案**：${techDesignPath}
**修改的文件**：
${modifiedFiles.join('\n')}

请重点关注：
1. 代码实现是否符合技术方案
2. 是否正确使用可复用组件
3. 错误处理是否完善
4. 代码质量（可读性、可维护性）
5. 是否遵循项目代码规范
6. 是否存在潜在的 bug 或安全隐患
7. 测试覆盖是否充分

请提供：
- 代码质量评分（0-100分）
- 发现的问题和改进建议`,
    cd: process.cwd(),  // 自动使用当前工作目录
    sandbox: "read-only",
    SESSION_ID: memory.codex_session_id  // 复用会话
  });

  const score = extractScore(result);
  step.actual_score = score;

  // 生成验证报告（存储在项目目录）
  const reportPath = `.claude/verification-report-${sanitize(memory.task_name)}.md`;
  writeFile(reportPath, `# Codex 代码审查\n\n${result.output}`);
  memory.artifacts.verification_report = reportPath;

  // ⭐ Memory 更新指南：
  // 根据代码审查结果记录发现的问题:

  // 1. 记录代码质量问题
  if (score < 80) {
    // 从审查意见中提取问题
    const codeIssues = extractIssuesFromReview(result.output);
    codeIssues.forEach(issue => {
      addIssue(memory, {
        title: issue.title,
        description: issue.description,
        impact: issue.severity === 'critical' ? '高' : '中',
        foundAtStep: 'verify'
      });
    });
  }

  // 示例：
  // 如果 Codex 发现了安全漏洞
  // addIssue(memory, {
  //   title: '权限检查存在绕过风险',
  //   description: 'Codex 发现 checkPermission 函数在某些边界条件下可能被绕过',
  //   impact: '高',
  //   foundAtStep: 'verify'
  // });
  //
  // 如果发现代码风格问题
  // addIssue(memory, {
  //   title: '缺少错误处理',
  //   description: '数据库查询未包裹 try-catch,可能导致未捕获的异常',
  //   impact: '中',
  //   foundAtStep: 'verify'
  // });
}
```

### executeCode

```typescript
async function executeCode(memory, step) {
  // 读取技术方案，提取实施计划
  const techDesign = readFile(memory.artifacts.tech_design);
  const implementationPlan = extractImplementationPlan(techDesign);

  // 创建 TODO 清单
  TodoWrite({
    todos: implementationPlan.map(task => ({
      content: task.description,
      status: 'pending',
      activeForm: `实施${task.description}中`
    }))
  });

  // 提示用户按技术方案实施
  console.log(`
请按照技术方案的实施计划进行开发：

${implementationPlan.map((task, i) => `${i + 1}. ${task.description}`).join('\n')}

**开发原则**：
- 严格按照技术方案执行
- 复用识别的组件和工具
- 遵循项目代码规范
- 保持小步提交
- 实时更新 TODO 清单

完成后，记录修改的文件列表到 workflow-memory.json 的 implementation 字段。
`);

  // 等待用户确认完成
  // 这一步需要用户手动编码，执行完成后再次调用 /workflow-execute
}
```

---

## 🎯 质量关卡处理

### 质量关卡失败

```markdown
❌ **质量关卡未通过**

**步骤**：{{step.name}}
**评分**：{{score}} / 100
**阈值**：{{threshold}}
**差距**：{{threshold - score}} 分

---

## 📋 Codex 建议

{{step.suggestions}}

---

## 🔧 下一步操作

1. 根据 Codex 建议优化{{phase}}
2. 手动修改相关文件
3. 重新执行质量检查：
   \```bash
   /workflow-retry-step
   \```

或者，如果认为当前评分已足够，可以：
1. 手动编辑 `.claude/workflow-memory.json`
2. 修改步骤 {{step.id}} 的 `actual_score` 为 {{threshold}} 以上
3. 继续执行：`/workflow-execute`

⚠️ **警告**：降低质量标准可能导致后续问题，请谨慎操作。
```

---

## 💡 执行示例

### 示例1：执行上下文加载

```
📍 工作流进度：1 / 13（8%）

**当前步骤**：加载项目上下文
**所属阶段**：analyze
**预计耗时**：5分钟
**描述**：快速了解相关代码结构，识别技术栈和架构约束

---

[执行 /context-load "多租户权限管理系统"]

---

✅ 步骤完成：加载项目上下文

📦 产出物：
- .claude/context-summary-multi-tenant-permission.md

---

## 📊 总体进度

[████░░░░░░░░] 1 / 13

**已完成**：1 / 13
**剩余步骤**：12
**预计剩余时间**：约 1.5 天

---

## 🚀 下一步

**步骤 2**：深度需求分析
**阶段**：analyze
**预计耗时**：10分钟

继续执行：
\```bash
/workflow-execute
\```
```

### 示例2：Codex 方案审查（质量关卡）

```
📍 工作流进度：8 / 13（62%）

**当前步骤**：Codex 方案审查
**所属阶段**：design
**预计耗时**：10分钟
**描述**：使用 Codex 审查技术方案的完整性、合理性和可行性

⚠️ **这是质量关卡**：此步骤评分需 ≥ 80，否则无法继续

---

[调用 mcp__codex__codex 审查技术方案]

Codex 审查结果：

## Codex 审查意见

**审查时间**：2025-01-19 11:30:00
**综合评分**：85/100

### 优点
- ✅ 架构设计清晰，使用中间件模式注入租户上下文
- ✅ 可复用组件选择恰当
- ✅ 风险评估较为充分

### 不足与建议
- ⚠️ 缺少租户切换的权限验证
- ⚠️ 性能测试计划不够具体

### 实施建议
1. 补充租户切换的权限验证逻辑
2. 完善性能测试计划

**建议开始实施**：是（优化后）

---

✅ 步骤完成：Codex 方案审查

🎯 质量评分：85 / 100（阈值：80）
✅ 质量关卡通过！

📦 产出物：
- Codex 审查意见已追加到 .claude/tech-design/multi-tenant-permission.md

---

## 📊 总体进度

[████████░░░░] 8 / 13

**已完成**：8 / 13
**剩余步骤**：5
**预计剩余时间**：约 4 小时

---

## 🚀 下一步

**步骤 9**：实现核心功能模块
**阶段**：implement
**预计耗时**：2 小时

💡 建议：下一步是开发实施阶段，建议在新对话窗口中执行。

在新对话中执行：
\```bash
/workflow-execute
\```
```

### 示例3：质量关卡失败

```
📍 工作流进度：8 / 13（62%）

**当前步骤**：Codex 方案审查
**所属阶段**：design
**预计耗时**：10分钟

⚠️ **这是质量关卡**：此步骤评分需 ≥ 80

---

[调用 Codex 审查]

---

❌ 质量关卡未通过

**步骤**：Codex 方案审查
**评分**：72 / 100
**阈值**：80
**差距**：8 分

---

## 📋 Codex 建议

### 主要问题
1. 缺少数据迁移方案
2. 权限验证逻辑不完整
3. 性能影响未充分评估

### 改进建议
1. 补充现有数据如何迁移到多租户架构的详细方案
2. 完善权限验证中间件的实现细节
3. 增加性能测试计划和预期指标

---

## 🔧 下一步操作

1. 根据 Codex 建议优化技术方案文档
2. 重新执行质量检查：
   \```bash
   /workflow-retry-step
   \```

或者手动调整评分（不推荐）：
1. 编辑 `.claude/workflow-memory.json`
2. 修改步骤 8 的 `actual_score` 为 80 以上
3. 继续执行：`/workflow-execute`
```

---

## 🔄 相关命令

```bash
# 重试当前步骤
/workflow-retry-step

# 跳过当前步骤（慎用）
/workflow-skip-step

# 查看状态
/workflow-status

# 查看任务记忆（新路径）
# 工作流状态存储在：~/.claude/workflows/[project_id]/workflow-memory.json
# 文档产物存储在：.claude/（上下文摘要、验证报告等）
# 可以使用 /workflow-status 命令查看
```

---

## 🔧 后端工作流 Action 执行细节

### backend_generate_xq

**已在 `/workflow-backend-start` 中完成**。此 action 通常不会在 `/workflow-execute` 中触发。

### backend_review_xq

```typescript
async function backendReviewXq(memory, step) {
  const xqPath = memory.source_docs?.xq || memory.artifacts?.requirement_analysis;

  if (!xqPath || !fileExists(xqPath)) {
    throw new Error(`需求分析文档不存在：${xqPath}`);
  }

  console.log(`
📄 需求分析文档审查

**文档路径**：${xqPath}

请完成以下审查工作：

1. **阅读文档**：
   \`\`\`bash
   cat ${xqPath}
   \`\`\`

2. **检查清单**：
   - [ ] 所有 PRD 功能点都有对应的 FR
   - [ ] In Scope 和 Out of Scope 边界清晰
   - [ ] 核心用例路径完整
   - [ ] 非功能需求有具体指标
   - [ ] 验收标准可测试

3. **如需修改**：
   - 直接编辑 ${xqPath}
   - 补充遗漏的需求点
   - 修正不准确的理解

4. **审查完成后**：
   执行 \`/workflow-execute\` 继续
  `);

  // 标记为等待用户确认
  step.awaiting_user_confirmation = true;

  // 如果启用了 Codex 审查
  const config = loadProjectConfig();
  if (config.backend?.enableCodexReview) {
    const codexResult = await mcp__codex__codex({
      PROMPT: `请审查这份后端需求分析文档，检查：
1. 需求是否完整覆盖 PRD
2. 边界是否清晰
3. 用例是否完整
4. 是否有遗漏的风险点

文档内容：
${readFile(xqPath)}

请指出问题并给出改进建议。`,
      cd: process.cwd(),
      sandbox: "read-only",
      SESSION_ID: memory.codex_session_id
    });

    // 追加 Codex 审查意见到文档
    appendToXqDocument(xqPath, codexResult.agent_messages);
  }
}
```

### backend_generate_fasj

```typescript
async function backendGenerateFasj(memory, step) {
  const config = loadProjectConfig();
  const xqPath = memory.source_docs?.xq;
  const fasjSpecPath = config.backend?.fasjSpecPath;

  if (!xqPath || !fileExists(xqPath)) {
    throw new Error(`需求分析文档不存在：${xqPath}`);
  }

  if (!fasjSpecPath || !fileExists(fasjSpecPath)) {
    throw new Error(`方案设计规范不存在：${fasjSpecPath}`);
  }

  const xqContent = readFile(xqPath);
  const specContent = readFile(fasjSpecPath);
  const baseName = extractBaseName(memory.source_docs?.prd);
  const fasjPath = `${config.backend?.docDir || '.claude/docs'}/${baseName}-fasj.md`;

  // 与 Codex 协作生成方案
  const codexResult = await mcp__codex__codex({
    PROMPT: `请根据以下需求分析文档和方案设计规范，生成后端技术方案文档。

## 需求分析文档（xq.md）
${xqContent}

## 方案设计规范
${specContent}

请严格按照规范结构生成技术方案，重点关注：
1. 数据模型设计（实体、表结构、索引）
2. 接口设计（API 契约、请求响应结构）
3. 非功能设计（性能、安全、可观测性）
4. 实施计划（具体任务、依赖、里程碑）

输出完整的 Markdown 格式技术方案文档。`,
    cd: process.cwd(),
    sandbox: "read-only",
    SESSION_ID: memory.codex_session_id
  });

  // 保存 fasj.md
  ensureDir(path.dirname(fasjPath));
  writeFile(fasjPath, codexResult.agent_messages);

  // 更新 memory
  memory.source_docs.fasj = fasjPath;
  memory.artifacts.tech_design = fasjPath;
  step.output_artifacts = [fasjPath];

  console.log(`
✅ 方案设计文档已生成：${fasjPath}

📋 文档结构：
  - 设计目标与原则
  - 架构与边界
  - 模块与职责划分
  - 数据模型设计
  - 接口设计（API 契约）
  - 非功能设计
  - 实施计划

⏸️ **工作流已暂停** - 请审查方案设计文档

审查完成后执行：\`/workflow-execute\`
  `);
}
```

### backend_refine_fasj

```typescript
async function backendRefineFasj(memory, step) {
  const fasjPath = memory.source_docs?.fasj || memory.artifacts?.tech_design;

  if (!fasjPath || !fileExists(fasjPath)) {
    throw new Error(`方案设计文档不存在：${fasjPath}`);
  }

  console.log(`
📄 方案设计文档修订

**文档路径**：${fasjPath}

请根据 Codex 审查意见完成修订：

1. **查看审查意见**：
   文档末尾的"Codex 审查记录"部分

2. **重点修订项**：
   - 数据模型设计是否合理
   - 接口设计是否完整
   - 非功能设计是否到位
   - 实施计划是否可行

3. **修订完成后**：
   执行 \`/workflow-execute\` 继续
  `);
}
```

### backend_plan_implementation

```typescript
async function backendPlanImplementation(memory, step) {
  const fasjPath = memory.source_docs?.fasj || memory.artifacts?.tech_design;

  if (!fasjPath || !fileExists(fasjPath)) {
    throw new Error(`方案设计文档不存在：${fasjPath}`);
  }

  const fasjContent = readFile(fasjPath);

  // 从 fasj.md 提取实施计划
  const implementationPlan = extractImplementationPlan(fasjContent);

  // 创建 TODO 清单
  TodoWrite({
    todos: implementationPlan.map(task => ({
      content: task.name,
      status: 'pending',
      activeForm: `实施 ${task.name}`
    }))
  });

  // 更新 memory
  memory.implementation = {
    plan: implementationPlan,
    files_modified: []
  };

  console.log(`
✅ 实施计划已生成

📋 **任务清单**（共 ${implementationPlan.length} 项）：

${implementationPlan.map((task, i) =>
  `${i + 1}. ${task.name}\n   依赖：${task.depends || '无'}\n   预计：${task.estimate || '待定'}`
).join('\n\n')}

---

**开发原则**：
- 严格按照技术方案执行
- 复用已识别的组件和工具
- 遵循项目代码规范
- 保持小步提交
- 实时更新 TODO 清单

🚀 执行 \`/workflow-execute\` 开始开发
  `);
}
```

### backend_self_verify

```typescript
async function backendSelfVerify(memory, step) {
  const fasjPath = memory.source_docs?.fasj || memory.artifacts?.tech_design;
  const modifiedFiles = memory.implementation?.files_modified || [];
  const baseName = extractBaseName(memory.source_docs?.prd);

  console.log(`
🔍 后端自测与验证

**技术方案**：${fasjPath}
**修改文件**：${modifiedFiles.length} 个

请完成以下验证工作：

1. **单元测试**：
   \`\`\`bash
   npm run test
   \`\`\`

2. **类型检查**：
   \`\`\`bash
   npm run type-check
   \`\`\`

3. **接口测试**：
   根据 fasj.md 中的接口设计进行测试

4. **验收场景**：
   对照 xq.md 中的验收标准逐项验证

---
  `);

  // 生成验证报告
  const reportPath = `.claude/verification-report-${baseName}.md`;
  const reportContent = `# 验证报告 - ${baseName}

## 生成时间
${new Date().toISOString()}

## 修改文件
${modifiedFiles.map(f => `- ${f}`).join('\n') || '（待补充）'}

## 测试结果
（待补充）

## 验收状态
（待补充）
`;

  writeFile(reportPath, reportContent);
  memory.artifacts.verification_report = reportPath;
  step.output_artifacts = [reportPath];

  console.log(`
📄 验证报告模板已创建：${reportPath}

请补充测试结果和验收状态，然后执行 \`/workflow-execute\` 继续
  `);
}
```
