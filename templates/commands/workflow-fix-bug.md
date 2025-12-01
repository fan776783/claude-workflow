---
description: Bug 修复工作流 - 标准化 Bug 定位、修复和验证流程
argument-hint: "<Bug 描述或工单号>"
allowed-tools: SlashCommand(*), Task(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*), mcp__mcp-router__sequentialthinking(*), mcp__codex__codex(*), mcp__mcp-router__get_issue(*), mcp__mcp-router__transition_issue(*), mcp__mcp-router__update_issue(*), AskUserQuestion(*)
examples:
  - /workflow-fix-bug "[p313_2377] 微前端路由同步异常"
  - /workflow-fix-bug "p328_600"
  - /workflow-fix-bug "用户头像上传失败"
  - /workflow-fix-bug "表单提交后数据未更新"
---

# Bug 修复工作流

专门针对 Bug 修复的标准化工作流，强制包含回归测试，防止二次引入问题。

**适用场景**:
- ✅ 已知 Bug 需要定位和修复
- ✅ 需要根因分析和验证
- ✅ 需要确保修复不影响其他功能

**不适用场景**:
- ❌ 新功能开发（使用 `/workflow-start` 或 `/workflow-quick-dev`）
- ❌ 代码重构（使用 `/analyze "重构方案"`）
- ❌ 性能优化（使用 `/analyze "性能瓶颈"`）

**核心原则**（CLAUDE.md 0.2.2）:
- ✅ **Codex 优先**：Bug 定位和根因分析优先使用 Codex（擅长逻辑运算和 Bug 定位）
- ✅ **降级策略**：Codex 不可用时自动降级为直接分析
- ✅ **只读模式**：Codex 仅用于分析，严禁直接修改代码

**配置依赖**: `.claude/config/project-config.json`（自动读取项目配置）

**工作目录**: 从配置自动读取（`project.rootDir`）

---

## 🔧 准备: 项目初始化检查与路径解析

### 步骤 -2: 项目初始化检查（自动）⭐ NEW

**目标**: 确保项目已初始化 Claude Workflow 配置，如果未初始化则自动引导初始化

**执行逻辑**: 与 `/workflow-start` 相同（详见 `~/.claude/utils/auto-init-check.md`）

```typescript
console.log(`🔍 检查项目配置...\n`);

const cwd = process.cwd();
const configPath = path.join(cwd, '.claude/config/project-config.json');

if (!fs.existsSync(configPath)) {
  // 询问是否自动初始化（与 workflow-start Step -1 相同）
  // 选项：自动初始化（推荐）/ 手动配置 / 取消
  // 自动初始化：检测项目信息并生成配置文件
} else {
  console.log(`✅ 项目配置已存在\n`);
}
```

**时间**: 10-30 秒（仅在未初始化时执行）

**说明**:
- ✅ **零配置体验**: 直接执行 `/workflow-fix-bug` 即可，无需预先初始化
- ✅ **自动检测**: 自动识别项目类型、包管理器、框架
- ✅ **用户可控**: 提供自动/手动/取消三个选项
- ✅ **向后兼容**: 已初始化的项目直接跳过

---

### 步骤 -1.1: 计算项目唯一标识

基于当前工作目录（cwd）计算项目唯一标识：

```typescript
/**
 * 获取当前项目的唯一标识
 * 基于当前工作目录（cwd）计算 MD5 hash
 */
function getProjectId(): string {
  const cwd = process.cwd(); // 例如：/Users/ws/dev/skymediafrontend
  const hash = crypto.createHash('md5')
    .update(cwd)
    .digest('hex')
    .substring(0, 12); // 取前 12 位，例如：a1b2c3d4e5f6

  return hash;
}
```

**优点**：
- ✅ 唯一性强 - 不同路径产生不同 hash
- ✅ 固定长度 - 始终 12 个字符
- ✅ 无特殊字符 - 可安全用作目录名
- ✅ 可重现 - 相同路径产生相同 hash

### 步骤 -1.2: 获取工作流记忆文件路径

```typescript
/**
 * 获取当前项目的工作流记忆文件路径
 * 自动处理目录创建和元数据维护
 */
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
    const meta = {
      path: process.cwd(),
      name: path.basename(process.cwd()),
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(workflowDir, '.project-meta.json'),
      JSON.stringify(meta, null, 2)
    );

    console.log(`
✅ 已创建用户级工作流目录

**项目 ID**: ${projectId}
**项目路径**: ${process.cwd()}
**工作流目录**: ${workflowDir}
    `);
  } else {
    // 更新最后使用时间
    const metaPath = path.join(workflowDir, '.project-meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.lastUsed = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
  }

  return path.join(workflowDir, 'workflow-memory.json');
}
```

### 步骤 -1.3: 检查旧版项目级状态（向后兼容）

```typescript
/**
 * 检查项目目录中是否存在旧版工作流状态文件
 * 如果存在，提示用户迁移到用户级目录
 */
function checkLegacyWorkflowState(): void {
  const cwd = process.cwd();
  const projectLevelPath = path.join(cwd, '.claude/workflow-memory.json');

  // 检查项目级状态（旧方案）
  if (fs.existsSync(projectLevelPath)) {
    console.log(`
⚠️ 检测到项目级工作流状态（旧方案）

📍 位置：${projectLevelPath}

🔄 建议迁移到用户级目录：
  - 优点：完全避免 Git 冲突
  - 优点：多人协作无冲突
  - 优点：用户完全自主管理

💡 迁移方式：
1. 手动复制：cp ${projectLevelPath} ${getWorkflowMemoryPath()}
2. 或使用命令：/workflow-migrate-to-user

⏭️ 继续使用新的用户级工作流存储...
    `);
  }
}

// 执行检查
checkLegacyWorkflowState();

// 获取工作流记忆文件路径
const workflowMemoryPath = getWorkflowMemoryPath();

console.log(`
📋 工作流记忆文件路径: ${workflowMemoryPath}
🔒 用户级存储，完全避免 Git 冲突
`);
```

**说明**：
- **工作流状态**：`~/.claude/workflows/{projectId}/workflow-memory.json`（用户级，避免 Git 冲突）
- **文档产物**：`.claude/`（项目级，便于团队共享）
  - Bug 报告：`.claude/bug-reports/`
  - 验证报告：`.claude/verification-report-{task_name}.md`
- 每个项目自动隔离，多人协作无冲突
- 支持向后兼容，自动检测旧版项目级状态

---

## 🚀 6 步标准化流程

### 第 0 步: 缺陷信息获取（可选，BK-MCP）⭐

**目标**: 从蓝鲸工作项系统自动获取缺陷详细信息并流转状态

#### 0.1 识别缺陷编号

**自动识别规则**:
```typescript
// 正则匹配缺陷编号: p 开头 + 数字_数字
const issueNumberPattern = /p\d+_\d+/i;
const match = userInput.match(issueNumberPattern);

if (match) {
  const issueNumber = match[0]; // 例如: "p328_600"
}
```

**触发条件**（满足任一即触发）:
- ✅ 用户输入包含 `p328_600` 格式的缺陷编号
- ✅ 用户输入仅为缺陷编号（如 `/workflow-fix-bug "p328_600"`）
- ✅ 用户确认有缺陷编号（主动询问）

#### 0.2 主动询问缺陷编号（未识别到时）

如果用户输入中未识别到缺陷编号，使用 AskUserQuestion 主动询问:

```typescript
AskUserQuestion({
  questions: [{
    question: "此 Bug 是否关联蓝鲸工作项？",
    header: "工作项关联",
    multiSelect: false,
    options: [
      {
        label: "有工作项编号",
        description: "输入工作项编号（如 p328_600）"
      },
      {
        label: "无工作项",
        description: "跳过蓝鲸工作项集成"
      }
    ]
  }]
})
```

**处理逻辑**:
- 用户选择"有工作项编号" → 继续执行步骤 0.3
- 用户选择"无工作项" → 跳过步骤 0，直接进入步骤 1
- 用户输入"Other"并提供编号 → 解析编号，继续执行步骤 0.3

#### 0.3 获取缺陷详细信息

```typescript
try {
  // 调用 bk-mcp 获取缺陷详细信息
  const issueDetail = await mcp__mcp-router__get_issue({
    issue_number: issueNumber,
    include_all_fields: true  // 获取所有字段定义和当前值
  });

  // 提取关键信息
  const bugInfo = {
    title: issueDetail.title,
    description: issueDetail.description,
    priority: issueDetail.priority,
    status: issueDetail.status,
    assignee: issueDetail.assignee,
    reporter: issueDetail.reporter,
    created_at: issueDetail.created_at,
    attachments: issueDetail.attachments,
    custom_fields: issueDetail.custom_fields
  };

  console.log(`
✅ 成功获取缺陷信息

**工作项编号**: ${issueNumber}
**标题**: ${bugInfo.title}
**优先级**: ${bugInfo.priority}
**当前状态**: ${bugInfo.status}
**经办人**: ${bugInfo.assignee}

**描述**:
${bugInfo.description}
  `);

} catch (error) {
  // bk-mcp 不可用或调用失败
  console.log(`
⚠️ 无法获取蓝鲸工作项信息（${error.message}）

**降级方案**: 跳过蓝鲸工作项集成，使用用户提供的 Bug 描述继续执行。
  `);

  // 跳过此步骤，使用用户输入的描述
}
```

#### 0.4 流转状态到"处理中"

```typescript
try {
  // 先查询可流转的状态列表
  const statesInfo = await mcp__mcp-router__transition_issue({
    issue_number: issueNumber,
    list_states: true  // 仅查询可流转状态
  });

  // 检查是否可以流转到"处理中"
  const canTransition = statesInfo.available_states.includes("处理中");

  if (canTransition) {
    // 流转状态
    await mcp__mcp-router__transition_issue({
      issue_number: issueNumber,
      target_state: "处理中",
      comment: `开始修复 Bug（通过 Claude Code 工作流自动流转）`,
      operators: [currentUser]  // 当前用户
    });

    console.log(`✅ 已将工作项 ${issueNumber} 流转到"处理中"状态`);
  } else {
    console.log(`⚠️ 当前状态无法流转到"处理中"，跳过状态流转`);
  }

} catch (error) {
  console.log(`⚠️ 状态流转失败（${error.message}），继续执行修复流程`);
}
```

**时间**: 1-2 分钟

**容错规则**:
- ✅ bk-mcp 不可用 → 跳过此步骤，使用用户输入继续
- ✅ 缺陷编号不存在 → 提示错误，询问是否继续
- ✅ 无法流转状态 → 记录警告，继续执行修复流程

---

### 第 1 步: Bug 重现与信息收集（必须）

**目标**: 完整记录 Bug 信息，为定位和修复提供依据

#### 1.1 收集 Bug 信息

使用 sequential-thinking 整理以下信息:

```typescript
mcp__mcp-router__sequentialthinking({
  thought: "收集 Bug 的完整信息",
  // 分析维度:
  // 1. Bug 现象（具体表现）
  // 2. 复现步骤（如何触发）
  // 3. 预期行为 vs 实际行为
  // 4. 影响范围（哪些功能受影响）
  // 5. 环境信息（浏览器、版本、环境）
  // 6. 错误日志（控制台、Sentry、网络请求）
  // 7. Bug 优先级（严重程度）
})
```

#### 1.2 创建 Bug 记录文档（可选）

**文件路径**: `.claude/bug-reports/bug-[工单号或简短描述].md`

```markdown
# Bug 报告: [Bug 标题]

**工单号**: [devops_no]
**发现时间**: 2025-01-20
**优先级**: 高/中/低
**影响范围**: [描述]

## Bug 现象

[详细描述]

## 复现步骤

1. [步骤1]
2. [步骤2]
3. [步骤3]

## 预期行为

[描述]

## 实际行为

[描述]

## 环境信息

- 浏览器: Chrome 120
- 环境: 测试环境（sa.wondershare.cn）
- 用户角色: [如有]

## 错误日志

\```
[控制台错误、Sentry 错误、网络请求错误]
\```

## 截图/录屏

[如有]
```

**时间**: 5-10 分钟

---

### 第 2 步: 快速定位（/analyze 轻量级）

#### 2.1 使用 /analyze 快速定位

**目的**：快速缩小范围，找到相关文件和代码位置，为 Codex 深度分析提供精准上下文。

```bash
/analyze "修复 [Bug 描述] - 定位相关代码"
```

**或直接搜索**：

```typescript
// 搜索错误信息
Grep({ pattern: "错误信息关键词", output_mode: "content" })

// 搜索相关函数/组件
Glob({ pattern: "**/*相关功能*" })
```

#### 2.2 收集定位结果

**输出**（供第 3 步使用）：
- 问题文件路径和行号
- 相关文件列表
- 初步问题描述

```typescript
const localizationResult = {
  problemFile: "src/components/AvatarUpload.tsx",
  problemLine: 45,
  relatedFiles: ["packages/api/src/user.ts", "packages/store/src/user.ts"],
  initialAnalysis: "上传成功后未刷新用户状态"
};
```

**时间**: 2-5 分钟

---

### 第 3 步: 深度分析（Codex 重量级）⭐

**基于第 2 步的定位结果**，使用 Codex 进行深度根因分析。

#### 3.1 使用 Codex 深度分析（优先）

```typescript
let rootCauseAnalysis = null;
let codexAvailable = true;

try {
  // 基于第 2 步的定位结果，使用 Codex 深度分析
  rootCauseAnalysis = await mcp__codex__codex({
    PROMPT: `请基于以下定位结果，深度分析 Bug 的根本原因:

**Bug 描述**: ${bugDescription}

## 第 2 步定位结果（已缩小范围）
- **问题文件**: ${localizationResult.problemFile}:${localizationResult.problemLine}
- **相关文件**: ${localizationResult.relatedFiles.join(', ')}
- **初步分析**: ${localizationResult.initialAnalysis}

**错误日志**: ${errorLogs || '无'}
**复现步骤**: ${reproSteps || '无'}

请基于以上定位结果，深度分析:
1. Bug 的根本原因是什么
2. 为什么会出现这个问题（代码逻辑、数据流、异步、环境等）
3. 可能的修复方案（至少 2 个）
4. 每个方案的优缺点
5. 推荐使用哪个方案及理由
6. 修复后可能的副作用
7. 需要注意的边界条件

以 Markdown 格式输出分析报告。`,
    cd: process.cwd(),
    sandbox: "read-only"
  });

  console.log(`✅ Codex 深度分析完成`);

} catch (error) {
  codexAvailable = false;
  console.log(`⚠️ Codex 不可用（${error.message}），降级为 Sequential Thinking 分析`);
}
```

#### 3.2 降级方案: Sequential Thinking 分析

**仅当 Codex 不可用时执行**:

```typescript
mcp__mcp-router__sequentialthinking({
  thought: `基于定位结果分析 Bug 根因:
    - 问题文件: ${localizationResult.problemFile}
    - 初步分析: ${localizationResult.initialAnalysis}`,
  // 分析维度:
  // 1. 代码逻辑问题（条件判断、边界条件）
  // 2. 数据流问题（状态管理、数据传递）
  // 3. 异步问题（竞态条件、Promise 处理）
  // 4. 环境问题（配置、依赖版本）
  // 5. 集成问题（API 调用、第三方库）
  thoughtNumber: 1,
  totalThoughts: 5,
  nextThoughtNeeded: true
})
```

**输出**: 根因分析报告（记录到 Bug 报告文档）

**时间**: 3-8 分钟（Codex，有精准上下文）/ 10-20 分钟（降级）

---

### 第 4 步: 修复实现（核心）

#### 4.1 选择修复方案

基于根因分析，选择最优修复方案:

**选择原则**:
- ✅ **最小化改动**: 优先局部修复，避免大范围重构
- ✅ **安全优先**: 避免引入新的 Bug
- ✅ **可维护性**: 代码清晰易懂
- ✅ **性能影响**: 确认修复不会引入性能问题

#### 4.2 实施修复

**修复要点**:
- ✅ 复用现有组件和工具函数
- ✅ 遵循项目代码规范
- ✅ 添加必要的注释（说明修复原因）
- ✅ 处理边界条件
- ✅ 保持代码风格一致

**修复注释模板**:

```typescript
// Bug 修复: [工单号] [Bug 简短描述]
// 问题: [根本原因]
// 方案: [修复方案]
// 影响范围: [受影响的功能]
const fixedFunction = () => {
  // 修复代码
};
```

#### 4.3 直接编写修复代码

**基于第 3 步的根因分析结果**，直接编写修复代码：

```typescript
// 读取目标文件
Read({ file_path: localizationResult.problemFile });

// 基于根因分析结果编写修复代码
// 重点:
// 1. 遵循推荐的修复方案
// 2. 适配项目代码风格
// 3. 添加修复注释（工单号、原因、方案）
// 4. 处理边界条件

Edit({ file_path: localizationResult.problemFile, old_string: ..., new_string: ... });
```

**修复要点**:
- ✅ 基于第 3 步分析的推荐方案实施
- ✅ 遵循项目代码规范
- ✅ 添加清晰的修复注释
- ✅ 处理分析中提到的边界条件

**时间**: 主要开发时间（视复杂度而定）

---

### 第 5 步: 回归测试与质量验证（强制）⭐

**这一步是 Bug 修复工作流的强制质量关卡，不能跳过。**

#### 5.1 编写回归测试（必须）

```bash
/write-tests
为 [修复的功能] 编写回归测试，覆盖原 Bug 场景
```

**测试覆盖要求**:
- ✅ **Bug 场景**: 必须覆盖原 Bug 的触发场景
- ✅ **边界条件**: 覆盖相关边界条件
- ✅ **正常流程**: 确认修复后正常流程仍然工作
- ✅ **相关功能**: 验证修复不影响相关功能

**测试示例**:

```typescript
describe('Bug 修复: [工单号] [描述]', () => {
  test('应该修复原 Bug 场景', () => {
    // 复现原 Bug 的场景
    // 验证修复后行为正确
  });

  test('应该处理边界条件', () => {
    // 测试边界条件
  });

  test('应该不影响正常流程', () => {
    // 验证正常流程仍然工作
  });
});
```

**时间**: 15-30 分钟

#### 5.2 手动验证（推荐）

**验证清单**:
- [ ] Bug 场景已修复
- [ ] 正常流程仍然工作
- [ ] 相关功能未受影响
- [ ] 没有引入新的错误（检查控制台）
- [ ] 性能无明显下降

#### 5.3 代码审查（根据复杂度决定）

**判断是否需要审查**：

```typescript
// 评估改动复杂度
const changeComplexity = {
  filesChanged: modifiedFiles.length,
  linesChanged: totalLinesChanged,
  hasLogicChange: true,  // 是否涉及逻辑变更
  hasApiChange: false,   // 是否涉及 API 变更
  hasStateChange: true   // 是否涉及状态管理变更
};

// 复杂度判断规则
const needsReview =
  changeComplexity.filesChanged > 1 ||      // 多文件改动
  changeComplexity.linesChanged > 20 ||     // 改动超过 20 行
  changeComplexity.hasApiChange ||          // 涉及 API 变更
  changeComplexity.hasStateChange;          // 涉及状态管理
```

**如需审查，使用 `/diff-review`**：

```bash
# 审查已暂存的修复代码
/diff-review --staged

# 或审查所有未提交的改动
/diff-review --all
```

**跳过审查的条件**（简单改动）：
- ✅ 单文件改动且少于 10 行
- ✅ 仅修改配置或常量
- ✅ 纯样式调整（无逻辑变更）
- ✅ 添加/修改注释

#### 5.4 运行测试和构建（必须）

```bash
# 运行新增的回归测试
pnpm test [测试文件]

# 运行类型检查
pnpm type-check

# 运行 lint
pnpm lint

# 运行构建（确认修复后可以构建）
pnpm build
```

**时间**: 5-10 分钟

---

### 第 6 步: 更新缺陷状态（可选，BK-MCP）⭐

**目标**: 将蓝鲸工作项状态流转到"已修复"或"待验证"

**触发条件**: 第 0 步成功获取了缺陷信息

#### 6.1 查询可流转状态

```typescript
try {
  // 查询当前可流转的状态
  const statesInfo = await mcp__mcp-router__transition_issue({
    issue_number: issueNumber,
    list_states: true
  });

  console.log(`
📊 当前可流转状态:
${statesInfo.available_states.join(', ')}
  `);

} catch (error) {
  console.log(`⚠️ 无法查询可流转状态（${error.message}），跳过状态更新`);
}
```

#### 6.2 流转到"已修复"或"待验证"

```typescript
try {
  // 优先流转到"待验证"（等待测试验证）
  const targetState = statesInfo.available_states.includes("待验证")
    ? "待验证"
    : "已修复";

  if (!statesInfo.available_states.includes(targetState)) {
    console.log(`⚠️ 无法流转到"${targetState}"状态，跳过状态更新`);
    return;
  }

  // 流转状态
  await mcp__mcp-router__transition_issue({
    issue_number: issueNumber,
    target_state: targetState,
    comment: `
Bug 修复完成（通过 Claude Code 工作流自动流转）

**修复说明**:
${fixSummary}

**修复文件**:
${modifiedFiles.join('\n')}

**测试覆盖**:
- 回归测试已编写
- 手动验证已通过
- 自动化测试已通过

**验证要点**:
1. 验证原 Bug 场景已修复
2. 验证正常流程仍然工作
3. 验证相关功能未受影响
    `,
    operators: [currentUser]
  });

  console.log(`✅ 已将工作项 ${issueNumber} 流转到"${targetState}"状态`);

} catch (error) {
  console.log(`⚠️ 状态流转失败（${error.message}），请手动更新工作项状态`);
}
```

#### 6.3 添加修复备注（可选）

```typescript
try {
  // 使用 update_issue 添加修复相关信息
  await mcp__mcp-router__update_issue({
    issue_number: issueNumber,
    fields: {
      "修复分支": currentBranch,
      "修复提交": latestCommitHash,
      "测试文件": testFilePaths.join(', ')
    }
  });

  console.log(`✅ 已更新工作项修复信息`);

} catch (error) {
  console.log(`⚠️ 更新工作项信息失败（${error.message}）`);
}
```

**时间**: 1-2 分钟

**容错规则**:
- ✅ bk-mcp 不可用 → 跳过此步骤，提示手动更新
- ✅ 无法流转状态 → 记录警告，提示手动更新
- ✅ 字段更新失败 → 记录警告，不影响主流程

---

## 📋 完整示例: 修复用户头像上传失败（含 BK-MCP 集成）

> **注意**：以下示例中的文件路径（如 `apps/skymedia-app/...`）仅作为演示，实际路径请根据您的项目结构调整。

### Step 0: 缺陷信息获取

**用户输入**: `/workflow-fix-bug "p328_600"`

**识别缺陷编号**:
```
✅ 识别到缺陷编号: p328_600
```

**获取缺陷详细信息**:
```typescript
const issueDetail = await mcp__mcp-router__get_issue({
  issue_number: "p328_600",
  include_all_fields: true
});
```

**返回**:
```
✅ 成功获取缺陷信息

**工作项编号**: p328_600
**标题**: 用户头像上传失败
**优先级**: 高
**当前状态**: 待处理
**经办人**: zhangsan

**描述**:
用户点击上传头像后，进度条显示 100%，但头像未更新。
复现步骤:
1. 登录系统
2. 进入用户设置页面
3. 点击上传头像按钮
4. 选择图片文件

预期: 头像更新为新图片
实际: 进度条完成，但头像未变化，控制台无报错
```

**流转状态到"处理中"**:
```
✅ 已将工作项 p328_600 流转到"处理中"状态
```

### Step 1: Bug 重现与信息收集

**基于 BK-MCP 获取的信息**，已经包含:
- **Bug 现象**: 用户点击上传头像后，进度条显示 100%，但头像未更新
- **复现步骤**: 1) 登录 → 2) 进入用户设置 → 3) 点击上传头像 → 4) 选择图片
- **预期**: 头像更新为新图片
- **实际**: 进度条完成，但头像未变化，控制台无报错
- **环境**: Chrome 120，测试环境
- **错误日志**: 无明显错误

### Step 2: 快速定位（/analyze 轻量级）

```bash
/analyze "用户头像上传失败 - 定位相关代码"
```

**定位结果**:
- 问题文件: `apps/skymedia-app/src/components/UserSettings/AvatarUpload.tsx:45`
- 相关文件: `packages/api/src/user.ts`, `packages/store/src/user.ts`
- 初步分析: `updateUserAvatar` 调用后未刷新用户状态

### Step 3: 深度分析（Codex 重量级）

```typescript
// 基于第 2 步定位结果，使用 Codex 深度分析
const analysis = await mcp__codex__codex({
  PROMPT: `基于定位结果深度分析:
    - 问题文件: AvatarUpload.tsx:45
    - 初步分析: updateUserAvatar 调用后未刷新用户状态
    请分析根因和修复方案...`,
  cd: process.cwd(),
  sandbox: "read-only"
});
```

**Codex 深度分析结果**:

```
根本原因: 上传成功后，未更新 Pinia store 中的用户信息

分析过程:
1. 上传成功，API 返回正常
2. 检查 updateUserAvatar 调用 → 成功返回新 URL
3. 检查用户状态更新 → 未发现刷新逻辑 ❌
4. UI 绑定的是 store 中的 userInfo.avatar
5. store 未更新，导致 UI 未刷新

修复方案:
方案1: 调用 userStore.refreshUserInfo()（推荐）
方案2: 直接更新 store 中的 avatar 字段

推荐方案1，因为可以同步其他可能变更的用户信息
```

### Step 4: 修复实现

**修复代码**:

```typescript
// apps/skymedia-app/src/components/UserSettings/AvatarUpload.tsx

import { useUserStore } from '@repo/store';

export const AvatarUpload = () => {
  const userStore = useUserStore();

  const handleUpload = async (file: File) => {
    // 验证和上传逻辑...
    const url = await uploadToServer(file);

    // 更新用户头像
    await updateUserAvatar({ avatarUrl: url });

    // Bug 修复: [p313_2377] 上传成功后刷新用户状态
    // 问题: 上传成功后 Pinia store 中的用户信息未更新，导致 UI 未刷新
    // 方案: 调用 refreshUserInfo 刷新用户信息
    // 影响范围: 仅影响用户头像上传功能
    await userStore.refreshUserInfo();
  };

  // ...
};
```

### Step 5: 回归测试与质量验证

**编写回归测试**:

```bash
/write-tests
为 AvatarUpload 组件编写回归测试，覆盖上传成功后状态更新
```

**生成的测试**:

```typescript
// apps/skymedia-app/tests/components/AvatarUpload.test.ts

describe('Bug 修复: [p313_2377] 用户头像上传失败', () => {
  test('应该在上传成功后刷新用户状态', async () => {
    const userStore = useUserStore();
    vi.spyOn(userStore, 'refreshUserInfo');

    // 模拟上传
    await handleUpload(mockFile);

    // 验证调用了 refreshUserInfo
    expect(userStore.refreshUserInfo).toHaveBeenCalled();
  });

  test('应该处理上传失败场景', async () => {
    // 测试上传失败时不调用 refreshUserInfo
  });
});
```

**手动验证**:
- [x] Bug 场景已修复（上传后头像正确更新）
- [x] 正常流程仍然工作
- [x] 相关功能未受影响
- [x] 无控制台错误
- [x] 性能无下降

**代码审查**（涉及状态管理，需要审查）:

```bash
/diff-review --staged
```

**审查结果**:

```markdown
# Review Report

## Summary
| Field | Value |
|-------|-------|
| Verdict | ✅ CORRECT |
| Confidence | 0.92 |

**Explanation**: 修复正确解决了根本问题，改动最小化。

## Findings

### [P2] 考虑添加错误处理

| Field | Value |
|-------|-------|
| File | `apps/skymedia-app/src/components/UserSettings/AvatarUpload.tsx` |
| Lines | 73-73 |
| Confidence | 0.75 |

如果 `refreshUserInfo` 失败，用户不会收到任何反馈。建议添加 try-catch 处理。
```

**运行测试**:

```bash
pnpm test apps/skymedia-app/tests/components/AvatarUpload.test.ts
pnpm type-check
pnpm lint
```

### Step 6: 更新缺陷状态

**流转到"待验证"**:
```typescript
await mcp__mcp-router__transition_issue({
  issue_number: "p328_600",
  target_state: "待验证",
  comment: `
Bug 修复完成（通过 Claude Code 工作流自动流转）

**修复说明**:
上传成功后未刷新用户状态，导致 UI 未更新。修复方案：调用 refreshUserInfo 刷新状态。

**修复文件**:
- apps/skymedia-app/src/components/UserSettings/AvatarUpload.tsx

**测试覆盖**:
- 回归测试已编写
- 手动验证已通过
- 自动化测试已通过

**验证要点**:
1. 验证上传头像后 UI 正确更新
2. 验证正常流程仍然工作
3. 验证相关功能未受影响
  `
});
```

**返回**:
```
✅ 已将工作项 p328_600 流转到"待验证"状态
```

**总耗时**: 约 35-45 分钟（含 BK-MCP 集成）

---

## 🎯 质量保证清单（必须全部通过）

### 技术验证
- [ ] **Bug 已复现**: 能够稳定复现原 Bug
- [ ] **根因已明确**: 清楚 Bug 的根本原因
- [ ] **修复已验证**: 手动验证 Bug 已修复
- [ ] **回归测试已编写**: 覆盖原 Bug 场景和边界条件
- [ ] **测试已通过**: 所有测试用例通过
- [ ] **类型检查通过**: `pnpm type-check` 无错误
- [ ] **Lint 检查通过**: `pnpm lint` 无错误
- [ ] **构建成功**: `pnpm build` 成功
- [ ] **无副作用**: 修复未影响其他功能

### 文档与流程（可选）
- [ ] **Bug 报告已更新**: 记录修复方案到 Bug 报告文档
- [ ] **工作项已流转**: BK-MCP 状态已更新到"待验证"或"已修复"
- [ ] **修复备注已添加**: 记录修复分支、提交哈希、测试文件等信息

---

## 🔄 与手动组合模式的关系

**手动组合模式**:
```bash
1. /analyze "修复微前端路由同步异常的上下文"
2. /analyze "路由同步异常的根因"
3. /write-tests 编写回归测试
```

**`/workflow-fix-bug`（自动化工作流）**:
- ✅ Codex 优先：自动调用 Codex 进行定位和分析
- ✅ 降级策略：Codex 不可用时自动降级
- ✅ 标准化流程：确保不遗漏关键步骤
- ✅ 强制回归测试：防止二次引入
- ✅ BK-MCP 集成：自动同步工作项状态

**推荐**: 优先使用 `/workflow-fix-bug`，充分利用 Codex 的 Bug 定位能力

---

## 💡 最佳实践

### 1. 优先重现 Bug

**不要在未重现 Bug 的情况下开始修复**，否则可能:
- 修复了错误的问题
- 无法验证修复是否有效
- 引入新的问题

### 2. 最小化改动

**优先局部修复**，避免:
- 大范围重构
- 修改无关代码
- 引入不必要的依赖

### 3. 强制回归测试

**每个 Bug 修复都必须包含回归测试**，确保:
- 原 Bug 不会再次出现
- 修复不影响其他功能
- 代码库质量持续提升

### 4. 记录修复过程

**在代码注释中记录**:
- Bug 工单号
- 根本原因
- 修复方案
- 影响范围

**好处**:
- 方便后续维护
- 知识传承
- Code Review 更高效

### 5. 考虑多环境同步

**修复后检查是否需要**:
- 同步到其他分支（如 release 分支）
- 同步到其他环境（如生产环境）
- 通知相关团队

---

## ⚡ 高级选项

### 多个 Bug 同时修复

如果需要同时修复多个相关 Bug:

```bash
# 方案1: 分别修复（推荐）
/workflow-fix-bug "[p313_2377] Bug 1"
/workflow-fix-bug "[p313_2378] Bug 2"

# 方案2: 合并修复（仅当 Bug 强相关时）
/workflow-fix-bug "[p313_2377][p313_2378] 相关 Bug 批量修复"
```

### 紧急 Bug 快速修复

**适用场景**: 线上严重 Bug，需要极速修复

**简化流程**:
1. 快速定位（跳过详细根因分析）
2. 最小化修复
3. 手动验证（跳过自动化测试）
4. 立即上线
5. **事后补充**: 根因分析文档 + 回归测试

**风险**: 可能遗漏隐藏问题，需要后续补充完整验证

### 使用 Git Bisect 定位引入 Bug 的提交

```bash
# 二分查找引入 Bug 的提交
git bisect start
git bisect bad  # 当前版本有 Bug
git bisect good <commit-hash>  # 已知正常的提交

# 测试当前提交
# 如果 Bug 存在: git bisect bad
# 如果 Bug 不存在: git bisect good

# 找到引入 Bug 的提交后
git bisect reset
```

---

## 📊 Bug 修复统计（可选）

**定期统计 Bug 修复数据**，用于改进开发流程:

```bash
# 查看所有 Bug 修复提交
git log --grep="^fix:" --oneline

# 统计 Bug 类型分布
# 分析常见 Bug 模式
# 改进编码规范和测试策略
```

---

## 🔗 相关工作流

- `/workflow-start` - 智能工作流（功能开发）
- `/workflow-quick-dev` - 快速功能开发
- `/workflow-ui-restore` - UI 还原工作流
- `/analyze "描述"` - 智能分析（上下文加载、代码探索、深度分析）
- `/diff-review` - 代码变更审查
- `/write-tests` - 编写测试

---

## 📖 参考文档

```bash
# 查看所有可用命令
cat .claude/commands/agents.md

# 查看项目开发规范
cat CLAUDE.md

# 查看代码质量标准
cat ~/.claude/CLAUDE.md
```
