# 深度审查问题修复方案 v2.1

> 基于 Codex 审核反馈更新，含决策评估

## 版本历史

| 版本 | 评分 | 变更 |
|------|------|------|
| v1 | 64/100 | 初版方案 |
| v2 | 83/100 | 整合 Codex 首轮反馈 |
| **v2.1** | **88/100** | 采纳精简建议 + 拒绝过度工程化建议 |

## 修复优先级与范围

| 优先级 | 问题数 | 影响 |
|--------|--------|------|
| P0 | 3 | 安全漏洞、逻辑错误 |
| P1 | 3 | 功能不一致 |
| P2-P3 | 4 | 可用性问题 |

---

## 共享工具函数（前置依赖）

### Util 1: 统一路径安全函数

**位置**: 在每个 workflow-*.md 中定义（或提取到共享模块）

```typescript
/**
 * 安全解析相对路径，确保结果在 baseDir 内
 * @param baseDir 基准目录（绝对路径）
 * @param relativePath 待解析的相对路径
 * @returns 解析后的绝对路径，如果不安全则返回 null
 */
function resolveUnder(baseDir: string, relativePath: string): string | null {
  // 1. 基础校验：禁止空值、绝对路径、路径穿越
  if (!relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath.includes('..')) {
    return null;
  }

  // 2. 字符白名单校验（允许子目录）
  // 允许：字母、数字、下划线、连字符、点、斜杠
  if (!/^[a-zA-Z0-9_\-\.\/]+$/.test(relativePath)) {
    return null;
  }

  // 3. 禁止连续斜杠和首尾斜杠
  if (/^\/|\/\/|\/\s*$/.test(relativePath)) {
    return null;
  }

  // 4. 解析并校验边界（使用分隔符防止前缀误匹配）
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir);

  // 必须严格在 baseDir 内（使用分隔符边界）
  if (resolved !== normalizedBase &&
      !resolved.startsWith(normalizedBase + path.sep)) {
    return null;
  }

  return resolved;
}

// 使用示例
const tasksPath = resolveUnder(workflowDir, state.tasks_file);
if (!tasksPath) {
  console.log(`🚨 任务文件路径不安全: ${state.tasks_file}`);
  return;
}
```

---

### Util 2: 统一状态 Emoji 处理

**位置**: 在每个 workflow-*.md 中定义（共享常量）

```typescript
/**
 * 状态 emoji 定义（使用 alternation 正确处理多码点 emoji）
 * ⏭️ = U+23ED + U+FE0F (变体选择符)
 */
const STATUS_EMOJI = {
  completed: '✅',
  in_progress: '⏳',
  failed: '❌',
  skipped: '⏭️'  // 注意：这是两个码点
};

// 匹配任意状态 emoji 的正则（用于提取）
// 使用 alternation 而非字符类，正确处理 ⏭️
const STATUS_EMOJI_REGEX = /(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u;

// 匹配并移除状态 emoji 的正则（用于替换）
const STRIP_STATUS_EMOJI_REGEX = /\s*(?:✅|⏳|❌|⏭\uFE0F?|⏭️)\s*$/u;

/**
 * 从标题末尾提取状态
 */
function extractStatusFromTitle(title: string): string | null {
  const match = title.match(STATUS_EMOJI_REGEX);
  if (!match) return null;

  const emoji = match[0].trim();
  if (emoji === '✅') return 'completed';
  if (emoji === '⏳') return 'in_progress';
  if (emoji === '❌') return 'failed';
  // ⏭️ 可能是 ⏭ 或 ⏭️（带/不带变体选择符）
  if (emoji.startsWith('⏭')) return 'skipped';
  return null;
}

/**
 * 获取状态对应的 emoji
 */
function getStatusEmoji(status: string): string {
  if (status.includes('completed')) return ' ✅';
  if (status.includes('in_progress')) return ' ⏳';
  if (status.includes('failed')) return ' ❌';
  if (status.includes('skipped')) return ' ⏭️';
  return '';
}
```

---

### Util 3: 统一去重添加函数

```typescript
/**
 * 去重添加元素到数组
 */
function addUnique<T>(arr: T[], item: T): void {
  if (!arr.includes(item)) {
    arr.push(item);
  }
}
```

---

### Util 4: 正则转义函数

```typescript
/**
 * 转义正则元字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

---

## P0 问题修复

### Fix 1: 路径穿越风险 - 校验前读取 tasks_file

**文件**: `templates/commands/workflow-execute.md`

**问题**:
1. Line 116 在 Step 2 校验前读取 `state.tasks_file`
2. `startsWith` 校验不严谨（前缀问题）
3. `state.tech_design` 未校验

**修复方案**:

```typescript
// ═══════════════════════════════════════════════════════════════
// Step 1：读取工作流状态（只读 state，不访问其他文件）
// ═══════════════════════════════════════════════════════════════

const state = JSON.parse(readFile(statePath));

// 状态预检查：如果处于失败状态，提示用户
if (state.status === 'failed') {
  console.log(`
📂 工作流目录：${workflowDir}
📄 任务清单：${state.tasks_file}
📍 当前任务：${state.current_task}

⚠️ 当前工作流处于失败状态

失败任务：${state.current_task}
失败原因：${state.failure_reason || '未知'}

💡 修复后执行：/workflow-retry-step
  `);
  return;
}

// ═══════════════════════════════════════════════════════════════
// Step 2：路径安全校验（必须在读取文件前完成）
// ═══════════════════════════════════════════════════════════════

// 2.1 校验 tasks_file
const tasksPath = resolveUnder(workflowDir, state.tasks_file);
if (!tasksPath) {
  console.log(`🚨 任务文件路径不安全: ${state.tasks_file}`);
  return;
}

if (!fileExists(tasksPath)) {
  console.log(`
❌ 任务清单不存在：${tasksPath}

💡 请先启动工作流：/workflow-start "功能需求描述"
  `);
  return;
}

// 2.2 校验 tech_design（新增）
let techDesignPath: string | null = null;
if (state.tech_design) {
  // tech_design 可能是项目相对路径（如 .claude/tech-design/xxx.md）
  // 需要相对于项目根目录校验
  const cwd = process.cwd();
  techDesignPath = resolveUnder(cwd, state.tech_design);
  if (!techDesignPath) {
    console.log(`🚨 技术方案路径不安全: ${state.tech_design}`);
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// Step 3：安全读取文件并计算执行参数
// ═══════════════════════════════════════════════════════════════

const tasksContent = readFile(tasksPath);
const totalTaskCount = countTasks(tasksContent);

// 确定执行模式
const executionMode = executionModeOverride || state.execution_mode || 'step';
const pauseBeforeCommit = state.pause_before_commit !== false;

// 确定 subagent 模式
const autoSubagent = totalTaskCount > 5;
const useSubagent = useSubagentOverride ?? state.use_subagent ?? autoSubagent;

console.log(`
📂 工作流目录：${workflowDir}
📄 任务清单：${state.tasks_file}
📍 当前任务：${state.current_task}
⚡ 执行模式：${executionMode}${useSubagent ? ' (subagent)' : ''}
${useSubagent && autoSubagent && useSubagentOverride === null ? '💡 已自动启用 subagent 模式（任务数 > 5）' : ''}
`);
```

**影响文件**:
- `templates/commands/workflow-execute.md` - 主要修改
- `templates/commands/workflow-retry-step.md` - 同步添加 tech_design 校验
- `templates/commands/workflow-skip-step.md` - 同步添加 tech_design 校验
- `templates/commands/workflow-status.md` - 同步添加 tech_design 校验

---

### Fix 2: 标题状态兜底逻辑不生效

**文件**:
- `templates/commands/workflow-execute.md`
- `templates/commands/workflow-status.md`
- `templates/commands/workflow-retry-step.md`
- `templates/commands/workflow-skip-step.md`

**问题**:
1. 正则 `([^\\n✅⏳]+)[✅⏳]?` 把 emoji 排除在捕获组外
2. `workflow-status.md` 的 `parseTasksFromMarkdown` 同样有问题
3. 字符类无法正确处理多码点 emoji

**修复方案**:

```typescript
// ═══════════════════════════════════════════════════════════════
// 任务解析函数（统一修复）
// ═══════════════════════════════════════════════════════════════

function extractCurrentTask(content: string, taskId: string): Task | null {
  if (!taskId || !/^T\d+$/.test(taskId)) {
    return null;
  }

  const escapedId = escapeRegExp(taskId);

  // 新正则：捕获完整标题（包含可能的 emoji）
  // 不再使用排除字符类，而是捕获整行后再处理
  const regex = new RegExp(
    `##+ ${escapedId}:\\s*(.+?)\\s*\\n` +           // 标题（捕获完整内容）
    `(?:\\s*<!-- id: ${escapedId}[^>]*-->\\s*\\n)?` + // 可选 ID 注释
    `([\\s\\S]*?)` +                                  // 内容
    `(?=\\n##+ T\\d+:|$)`,                            // 下一个任务或结束
    'm'
  );

  const match = content.match(regex);
  if (!match) {
    return null;
  }

  // 从标题中提取状态 emoji 和纯标题
  const rawTitle = match[1].trim();
  const titleStatus = extractStatusFromTitle(rawTitle);
  const name = rawTitle.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();

  const body = match[2];

  return {
    id: taskId,
    name: name,
    phase: extractField(body, '阶段'),
    file: extractField(body, '文件'),
    leverage: extractField(body, '复用'),
    design_ref: extractField(body, '设计参考'),
    requirement: extractField(body, '需求') || extractField(body, '内容'),
    actions: extractField(body, 'actions'),
    depends: extractField(body, '依赖'),
    quality_gate: parseQualityGate(body),
    threshold: parseInt(extractField(body, '阈值') || '80'),
    // 优先使用标题状态，其次使用字段状态
    status: titleStatus || extractField(body, '状态') || 'pending'
  };
}

// ═══════════════════════════════════════════════════════════════
// workflow-status.md 的全局解析函数（同步修复）
// ═══════════════════════════════════════════════════════════════

function parseTasksFromMarkdown(content: string): Task[] {
  const tasks: Task[] = [];

  // 新正则：不使用排除字符类
  const regex = /##+ (T\d+):\s*(.+?)\s*\n(?:\s*<!--\s*id:\s*T\d+[^>]*-->\s*\n)?([\s\S]*?)(?=\n##+ T\d+:|$)/gm;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const [, id, rawTitle, body] = match;

    // 从标题提取状态
    const titleStatus = extractStatusFromTitle(rawTitle);
    const name = rawTitle.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();

    tasks.push({
      id,
      name,
      phase: extractField(body, '阶段'),
      file: extractField(body, '文件'),
      leverage: extractField(body, '复用'),
      design_ref: extractField(body, '设计参考'),
      requirement: extractField(body, '需求') || extractField(body, '内容'),
      actions: extractField(body, 'actions'),
      depends: extractField(body, '依赖'),
      quality_gate: parseQualityGate(body),
      threshold: parseInt(extractField(body, '阈值') || '80'),
      status: titleStatus || extractField(body, '状态') || 'pending'
    });
  }

  return tasks;
}
```

---

### Fix 3: Subagent 分支缺少失败处理

**文件**: `templates/commands/workflow-execute.md`

**问题**:
1. Subagent 路径没有 try/catch
2. 回退逻辑 `!失败词 || 成功词` 可能误判成功
3. 未做 schema 校验

**修复方案**: 采用 fail-closed 策略

```typescript
// ═══════════════════════════════════════════════════════════════
// Subagent 模式：委托给独立 subagent 执行
// ═══════════════════════════════════════════════════════════════

if (useSubagent) {
  console.log(`🤖 **Subagent 模式**：委托任务 ${currentTask.id} 执行...\n`);

  try {
    const subagentResult = await Task({
      subagent_type: 'general-purpose',
      description: `执行 ${currentTask.id}: ${currentTask.name}`,
      prompt: `
你是工作流任务执行器。请执行以下任务：

## 任务信息
- **ID**: ${currentTask.id}
- **名称**: ${currentTask.name}
- **阶段**: ${currentTask.phase}
- **文件**: ${currentTask.file || '无指定'}
- **需求**: ${currentTask.requirement}
- **动作**: ${currentTask.actions}

## 上下文
- 项目根目录: ${cwd}
- 技术方案: ${techDesignPath || '无'}

## 设计参考
${currentTask.design_ref ? `参见技术方案中的 "${currentTask.design_ref}" 章节` : '无'}

## 约束
${extractConstraints(tasksContent).map(c => '- ' + c).join('\n')}

## 执行要求
1. 先用 mcp__auggie-mcp__codebase-retrieval 获取相关代码上下文
2. 根据 actions 执行操作（create_file/edit_file/run_tests/codex_review）
3. 遵循多模型协作流程（如适用）

## 输出格式要求（必须遵守）
完成后请在响应末尾输出 JSON 格式的结果：
\`\`\`json
{
  "success": true,
  "changed_files": ["file1.ts", "file2.ts"],
  "summary": "简要说明执行结果"
}
\`\`\`

如果执行失败，输出：
\`\`\`json
{
  "success": false,
  "error": "失败原因说明"
}
\`\`\`
`
    });

    // ═══════════════════════════════════════════════════════════
    // 解析结构化结果 - Fail-Closed 策略
    // 宁可误报失败也不要误报成功
    // ═══════════════════════════════════════════════════════════

    const resultStr = String(subagentResult);  // 确保是字符串

    // 宽容匹配：支持 json/JSON/无标注，大小写不敏感
    const jsonMatch = resultStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

    let parseError: string | null = null;
    let isSuccess = false;

    if (!jsonMatch) {
      parseError = 'Subagent 未返回 JSON 格式结果';
    } else {
      try {
        const parsed = JSON.parse(jsonMatch[1]);

        // 严格 schema 校验
        if (typeof parsed.success !== 'boolean') {
          parseError = 'Invalid schema: success 必须是 boolean 类型';
        } else if (parsed.success === true) {
          isSuccess = true;
          console.log(`✅ Subagent 完成: ${currentTask.id}`);
          if (parsed.changed_files?.length > 0) {
            console.log(`   修改文件: ${parsed.changed_files.join(', ')}`);
          }
          if (parsed.summary) {
            console.log(`   摘要: ${parsed.summary}`);
          }
        } else {
          // success === false - 容错处理 error 字段
          parseError = parsed.error ? String(parsed.error) : 'Subagent 报告失败（无详细原因）';
        }
      } catch (e) {
        parseError = `JSON 解析错误: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (!isSuccess) {
      throw new Error(parseError || 'Unknown subagent error');
    }

    // 成功：继续进入 Step 6 更新状态

  } catch (error) {
    // ═══════════════════════════════════════════════════════════
    // 与直执行路径一致的失败处理
    // ═══════════════════════════════════════════════════════════

    const errorMessage = (error instanceof Error ? error.message : String(error))
      .replace(/[\r\n]+/g, ' ')
      .substring(0, 200);

    addUnique(state.progress.failed, currentTask.id);
    state.status = 'failed';
    state.failure_reason = errorMessage;
    state.updated_at = new Date().toISOString();
    writeFile(statePath, JSON.stringify(state, null, 2));
    updateTaskStatusInMarkdown(tasksPath, currentTask.id, `❌ failed (${errorMessage.substring(0, 50)})`);

    console.log(`
🛑 **Subagent 执行失败**

任务：${currentTask.id} - ${currentTask.name}
原因：${errorMessage}

💡 修复后执行：/workflow-retry-step
    `);
    return;
  }
}
```

---

## P1 问题修复

### Fix 4: `phase` 模式定义不一致

**文件**: `templates/commands/workflow-execute.md`

**修复方案**: 统一使用 design/implement/test/verify/deliver，移除 P0/P1/P2

```typescript
// 更新文档表格说明
| 阶段 | `--phase` | 按阶段连续执行 | 阶段变化时暂停 (design→implement→verify→deliver) |

// 修改 extractPhaseFromTask 函数
function extractPhaseFromTask(task: Task): string {
  // 优先使用任务的 phase 字段
  if (task.phase) return task.phase;

  // 从任务名称推断阶段（兜底，扩展同义词）
  const name = task.name.toLowerCase();

  // 设计阶段
  if (/设计|design|interface|接口|架构|architecture/.test(name)) return 'design';

  // 测试阶段
  if (/测试|test|单元|unit|集成|integration/.test(name)) return 'test';

  // 验证阶段
  if (/审查|review|验证|verify|验收|qa|确认|check/.test(name)) return 'verify';

  // 交付阶段
  if (/提交|commit|发布|release|部署|deploy|文档|doc/.test(name)) return 'deliver';

  // 默认实现阶段
  return 'implement';
}
```

---

### Fix 5: `quality_gate` 判定过宽

**文件**: 所有 workflow-*.md

**修复方案**: 明确解析布尔值

```typescript
/**
 * 解析 quality_gate 字段
 * 只有明确为 true 时才返回 true
 */
function parseQualityGate(body: string): boolean {
  // 匹配 **质量关卡**: true 或 **质量关卡**: false
  const match = body.match(/\*\*质量关卡\*\*:\s*(true|false)/i);
  if (!match) return false;

  return match[1].toLowerCase() === 'true';
}
```

---

### Fix 6: 状态 emoji 集合不一致

**文件**: 所有 `updateTaskStatusInMarkdown` 函数

**修复方案**: 使用共享的 emoji 处理函数

```typescript
function updateTaskStatusInMarkdown(
  filePath: string,
  taskId: string,
  newStatus: string
): void {
  let content = readFile(filePath);
  const escapedId = escapeRegExp(taskId);

  // 兼容 ## 和 ### 格式
  const taskRegex = new RegExp(
    `(##+ ${escapedId}:[\\s\\S]*?)(?=\\n##+ T\\d+:|$)`,
    'm'
  );
  const taskMatch = content.match(taskRegex);

  if (!taskMatch) {
    console.log(`⚠️ 未找到任务 ${taskId}`);
    return;
  }

  const taskBlock = taskMatch[1];
  let updatedBlock = taskBlock;

  // 尝试方式1: 更新 `- **状态**:` 字段
  const statusFieldRegex = /(- \*\*状态\*\*:\s*)([^\n]+)/;
  if (statusFieldRegex.test(taskBlock)) {
    updatedBlock = taskBlock.replace(statusFieldRegex, (_, prefix) => prefix + newStatus);
  }
  // 尝试方式2: 更新标题中的状态符号
  else {
    // 使用 escapedId 而非写死 T\\d+
    const titleLineRegex = new RegExp(
      `(##+ ${escapedId}:\\s*)(.+?)(\\s*\\n)`,
      'm'
    );

    const statusEmoji = getStatusEmoji(newStatus);

    updatedBlock = taskBlock.replace(titleLineRegex, (_, prefix, title, suffix) => {
      // 移除旧的状态 emoji（使用共享正则）
      const cleanTitle = title.replace(STRIP_STATUS_EMOJI_REGEX, '').trim();
      return `${prefix}${cleanTitle}${statusEmoji}${suffix}`;
    });
  }

  content = content.replace(taskBlock, updatedBlock);
  writeFile(filePath, content);
}
```

---

## P2-P3 问题修复

### Fix 7: 所有 `failed.push` 改用 `addUnique`

**影响位置**:
1. `handleQualityGateFailure` 函数
2. "缺少 actions" 错误路径
3. 其他任何 `state.progress.failed.push(...)` 的地方

**修复**: 全局搜索替换
```bash
# 搜索所有 failed.push 调用
grep -rn "progress\.failed\.push" templates/commands/

# 替换为 addUnique
# state.progress.failed.push(taskId)  →  addUnique(state.progress.failed, taskId)
```

---

### Fix 8: `workflow-helpers.sh` jq 失败处理

```bash
# 旧逻辑
local completed_count=$(jq -r '.progress.completed | length' "$state_file" 2>/dev/null)

# 新逻辑 - 处理 null、空值、jq 失败
local completed_count
completed_count=$(jq -r '(.progress.completed // []) | length // 0' "$state_file" 2>/dev/null) || completed_count=0
[ -z "$completed_count" ] && completed_count=0
[ "$completed_count" = "null" ] && completed_count=0
```

---

### Fix 9: `workflow-start` 提示信息

```typescript
// 旧
console.log(`⚠️ --backend 模式但文件不存在：${requirement}`);

// 新
console.log(`⚠️ 指定的文件不存在：${requirement}
💡 用法：/workflow-start --file "docs/prd.md"`);
```

---

### Fix 10: 处理 untracked 文件

**决策**: 将 `docs/workflow-command-review.md` 和 `docs/fix-plan.md` 纳入提交（设计/审查产物）

---

## 遗漏项修复

### Fix 11: `extractSection` 正则注入

**文件**: `templates/commands/workflow-execute.md`

**问题**: `design_ref` 未转义正则元字符

```typescript
// 旧逻辑
function extractSection(content: string, sectionRef: string): string {
  const regex = new RegExp(`## ${sectionRef.replace('.', '\\.')}[\\s\\S]*?(?=\\n## |$)`);
  // ...
}

// 新逻辑 - 完整转义
function extractSection(content: string, sectionRef: string): string {
  const escapedRef = escapeRegExp(sectionRef);
  const regex = new RegExp(`## ${escapedRef}[\\s\\S]*?(?=\\n## |$)`);
  // ...
}
```

---

## 回归测试用例清单

### 标题解析测试用例

| # | 输入标题 | 期望 name | 期望 status |
|---|----------|-----------|-------------|
| 1 | `## T1: 创建用户模块` | `创建用户模块` | `pending` |
| 2 | `## T2: 实现登录功能 ✅` | `实现登录功能` | `completed` |
| 3 | `### T3: 编写测试 ⏳` | `编写测试` | `in_progress` |
| 4 | `## T4: 代码审查 ❌` | `代码审查` | `failed` |
| 5 | `## T5: 跳过的任务 ⏭️` | `跳过的任务` | `skipped` |
| 6 | `## T6: 跳过任务 ⏭` | `跳过任务` | `skipped` |
| 7 | `## T7: 带 emoji 🎉 的任务` | `带 emoji 🎉 的任务` | `pending` |
| 8 | `## T8: 标题末尾有空格  ✅  ` | `标题末尾有空格` | `completed` |
| 9 | `## T9: 包含 ✅ 在中间的任务` | `包含 ✅ 在中间的任务` | `pending` |

### 状态更新测试用例

| # | 原标题 | 新状态 | 期望结果 |
|---|--------|--------|----------|
| 1 | `## T1: 任务` | `completed` | `## T1: 任务 ✅` |
| 2 | `## T2: 任务 ⏳` | `completed` | `## T2: 任务 ✅` |
| 3 | `## T3: 任务 ❌` | `in_progress` | `## T3: 任务 ⏳` |
| 4 | `## T4: 任务 ⏭️` | `completed` | `## T4: 任务 ✅` |
| 5 | `## T5: 任务 ✅` | `pending` | `## T5: 任务` (移除 emoji) |

### Subagent JSON 解析测试用例

| # | 输入 | 期望结果 |
|---|------|----------|
| 1 | ` ```json {"success": true} ``` ` | ✅ 成功 |
| 2 | ` ```JSON {"success": true} ``` ` | ✅ 成功（大小写兼容） |
| 3 | ` ``` {"success": true} ``` ` | ✅ 成功（无标注） |
| 4 | `无 code fence` | ❌ 失败 |
| 5 | ` ```json {"success": "true"} ``` ` | ❌ 失败（schema 错误） |
| 6 | ` ```json {"success": false} ``` ` | ❌ 失败（无 error 字段） |
| 7 | ` ```json {"success": false, "error": 123} ``` ` | ❌ 失败，原因 `"123"`（容错转换） |

### 路径安全测试用例

| # | 输入路径 | 期望结果 |
|---|----------|----------|
| 1 | `tasks.md` | ✅ 通过 |
| 2 | `tasks/sub.md` | ✅ 通过 |
| 3 | `../etc/passwd` | ❌ 拒绝 |
| 4 | `/etc/passwd` | ❌ 拒绝 |
| 5 | `tasks/../../../etc/passwd` | ❌ 拒绝 |
| 6 | `tasks//double.md` | ❌ 拒绝 |
| 7 | `/tasks.md` | ❌ 拒绝 |

---

## 实施顺序（更新）

### 第一轮：基础设施 + P0
1. **添加共享工具函数** (Util 1-4) → 所有文件
2. **Fix 1**: 路径穿越 + tech_design 校验 → `workflow-execute.md`
3. **Fix 2**: 正则捕获修复 → 4 个文件
4. **Fix 3**: Subagent 失败处理 → `workflow-execute.md`

### 第二轮：P1 问题
5. **Fix 4**: phase 定义统一
6. **Fix 5**: quality_gate 解析
7. **Fix 6**: emoji 集合统一

### 第三轮：P2-P3 + 遗漏项
8. **Fix 7**: 所有 failed.push 去重
9. **Fix 8**: jq 失败处理
10. **Fix 9**: 提示信息更新
11. **Fix 10**: untracked 文件处理
12. **Fix 11**: extractSection 正则注入

### 第四轮：验证
13. 按回归测试用例验证所有修复

---

## 预估改动（更新）

| 文件 | 改动行数 |
|------|----------|
| `templates/commands/workflow-execute.md` | ~120 行 |
| `templates/commands/workflow-status.md` | ~40 行 |
| `templates/commands/workflow-retry-step.md` | ~35 行 |
| `templates/commands/workflow-skip-step.md` | ~35 行 |
| `templates/commands/workflow-start.md` | ~10 行 |
| `templates/utils/workflow-helpers.sh` | ~10 行 |
| **总计** | ~250 行 |

---

## 决策记录

### 已采纳的 Codex 建议

| 建议 | 修改 |
|------|------|
| JSON fence 大小写兼容 | `/```(?:json)?\s*/i` 替代 `/```json/` |
| error 字段容错 | `String(parsed.error)` 替代直接使用 |
| 补充测试用例 | 新增状态更新回退用例 + 7 个 Subagent 用例 |

### 已拒绝的 Codex 建议

| 建议 | 拒绝理由 |
|------|----------|
| symlink 防护 (realpath) | 威胁模型不匹配。`~/.claude/workflows/` 是用户自己的目录，不是多租户服务。添加 I/O 操作增加复杂度，收益极低。 |
| `includes('..')` 改为 segment 检查 | 理论问题。没有合理业务场景使用 `a..b.md` 作为文件名。简单规则优于复杂规则。 |
| 取最后一个 code fence | 增加歧义。如果 Subagent 输出多个 fence，应修复 prompt 而非在解析端容错。 |
| `<!-- id: ... -->` 匹配改进 | 低优先级。ID 注释是可选的，解析失败只是回退到无注释模式，不影响核心功能。 |
| `./tasks.md` 拒绝 | 过于严格。`./` 是合法相对路径前缀。 |
| symlink 越界测试用例 | 测试复杂度高，需要创建实际 symlink，收益低。 |

### 威胁模型声明

本项目的安全假设：
1. **用户可信**：这是用户自己安装的本地 CLI 工具，不是公开服务
2. **目录可信**：`~/.claude/workflows/` 目录由系统创建和管理，不假设存在恶意符号链接
3. **输入源可信**：`workflow-state.json` 由本工具生成，不假设被恶意篡改

基于以上假设，我们只防护常见的编程错误（如路径穿越字符串），不防护需要本地 root 权限的攻击。
