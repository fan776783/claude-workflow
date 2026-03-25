# Phase 1: 技术方案生成详情

## 目的

在拆分任务前明确架构决策，确保实施方案的完整性和可行性。

## 执行时机

**强制执行**：每次启动工作流时必须执行

## 实现细节

### Step 1: 生成任务名称

```typescript
// 生成任务名称
const taskName = generateTaskName(requirementContent);
const sanitizedName = sanitize(taskName);

// 技术方案路径
const techDesignPath = `.claude/tech-design/${sanitizedName}.md`;
ensureDir('.claude/tech-design');
```

### Step 2: 检查文件冲突

```typescript
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
```

### Step 3: 生成技术方案文档

```typescript
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

  // 预渲染需求澄清摘要章节（Phase 0.2 产物）
  const discussionSummarySection = discussionArtifact
    ? renderDiscussionSummarySection(discussionArtifact)
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
      discussion_summary_section: discussionSummarySection,
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
    techDesignContent = generateInlineTechDesign({
      taskName,
      requirementSource,
      requirementContent,
      requirementDetailSections,
      discussionSummarySection,
      relatedFilesTable,
      patternsContent,
      constraintsContent
    });
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
}
```

## 技术方案文档结构

### 前置元数据（YAML Front Matter）

```yaml
---
version: 2
requirement_source: "docs/prd.md"
created_at: "2026-02-24T10:00:00Z"
status: draft
---
```

### 1. 需求摘要

原始需求内容（前 500 字符）

### 1.x 需求详情（结构化提取）

如果执行了 Phase 0.5，此章节包含 9 维度的结构化需求：
- 1.1 变更记录
- 1.2 表单字段规格（按场景分组）
- 1.3 角色权限矩阵
- 1.4 交互规格
- 1.5 业务规则
- 1.6 边界场景
- 1.7 UI 展示规则
- 1.8 功能流程（含入口路径）
- 1.9 数据契约

### 2. 代码分析结果

#### 2.1 相关现有代码

| 文件 | 用途 | 复用方式 |
|------|------|----------|
| `src/services/UserService.ts` | 用户服务 | 继承 |
| `src/models/BaseModel.ts` | 基础模型 | 继承 |

#### 2.2 现有架构模式

- **Repository Pattern**: 数据访问层抽象
- **Service Layer**: 业务逻辑封装

#### 2.3 技术约束

- 使用 TypeScript 4.9+
- 遵循 ESLint 规范
- 数据库：PostgreSQL 14

### 3. 架构设计

#### 3.1 模块划分

```
src/
├── models/
│   └── User.ts
├── services/
│   └── AuthService.ts
├── controllers/
│   └── AuthController.ts
└── middleware/
    └── authMiddleware.ts
```

#### 3.2 数据模型

```typescript
interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### 3.3 接口设计

```typescript
// POST /api/auth/login
interface LoginRequest {
  username: string;
  password: string;
}

interface LoginResponse {
  token: string;
  user: User;
}
```

### 4. 实施计划

| 序号 | 任务 | 文件 | 依赖 |
|------|------|------|------|
| 1 | 创建用户模型 | `src/models/User.ts` | - |
| 2 | 实现认证服务 | `src/services/AuthService.ts` | 1 |
| 3 | 实现认证控制器 | `src/controllers/AuthController.ts` | 2 |
| 4 | 添加认证中间件 | `src/middleware/authMiddleware.ts` | 2 |
| 5 | 编写单元测试 | `tests/auth.test.ts` | 1-4 |

### 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 密码存储安全 | 高 | 使用 bcrypt 加密 |
| Token 过期处理 | 中 | 实现 refresh token 机制 |

### 6. 验收标准

- [ ] 用户可以使用用户名和密码登录
- [ ] 登录成功后返回有效的 JWT token
- [ ] Token 验证中间件正常工作
- [ ] 所有单元测试通过

### 7. 子 Agent 审查记录（可选）

如果用户选择子 agent 审查，此章节包含平台对应的审查结果：Claude Code / Cursor 使用 `Task` reviewer，Codex 使用 `spawn_agent` reviewer。

## 辅助函数

### generateTaskName

从需求内容生成简洁的任务名称。

```typescript
function generateTaskName(content: string): string {
  // 提取需求的核心关键词
  // 生成简洁的任务名称（如 "实现用户认证功能"）
}
```

### sanitize

将任务名称转换为文件名安全的格式。

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
```

### loadTemplate

加载技术方案模板文件。

```typescript
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
  return '';
}
```

### replaceVars

简单变量替换（仅支持 `{{variable}}`）。

```typescript
function replaceVars(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    data[key] !== undefined ? data[key] : ''
  );
}
```

### renderRequirementDetailSections

将 RequirementAnalysis 渲染为 Markdown 章节（1.1-1.9）。

详见 `phase-0.5-requirement-extraction.md`。

### renderDiscussionSummarySection

将 DiscussionArtifact 渲染为 Markdown 章节。

```typescript
function renderDiscussionSummarySection(artifact: DiscussionArtifact): string {
  if (!artifact || artifact.clarifications.length === 0) return '';

  let section = `## 1.x 需求澄清摘要\n\n`;
  section += `> 来源：Phase 0.2 需求讨论（${artifact.timestamp}）\n\n`;

  // 按维度分组展示澄清结果
  const grouped = groupBy(artifact.clarifications, 'dimension');
  for (const [dimension, items] of Object.entries(grouped)) {
    section += `### ${dimension}\n\n`;
    for (const item of items) {
      section += `- **Q**: ${item.question}\n  **A**: ${item.answer}\n\n`;
    }
  }

  // 选定方案
  if (artifact.selectedApproach) {
    section += `### 选定方案\n\n`;
    section += `**${artifact.selectedApproach.name}**: ${artifact.selectedApproach.reason}\n\n`;
    if (artifact.selectedApproach.rejectedAlternatives.length > 0) {
      section += `排除方案：${artifact.selectedApproach.rejectedAlternatives.map(a => a.name).join('、')}\n\n`;
    }
  }

  // 未就绪依赖
  if (artifact.unresolvedDependencies.length > 0) {
    section += `### 未就绪依赖\n\n`;
    for (const dep of artifact.unresolvedDependencies) {
      section += `- **${dep.type}**: ${dep.description}（状态：${dep.status}）\n`;
    }
    section += '\n';
  }

  return section;
}
```

### generateInlineTechDesign

模板缺失时使用的内联生成函数。

```typescript
function generateInlineTechDesign(params: {
  taskName: string;
  requirementSource: string;
  requirementContent: string;
  requirementDetailSections: string;
  discussionSummarySection: string;
  relatedFilesTable: string;
  patternsContent: string;
  constraintsContent: string;
}): string {
  return `---
version: 2
requirement_source: "${params.requirementSource}"
created_at: "${new Date().toISOString()}"
status: draft
---

# 技术方案: ${params.taskName}

## 1. 需求摘要

${params.requirementContent}

${params.requirementDetailSections}

${params.discussionSummarySection}

## 2. 代码分析结果

### 2.1 相关现有代码

| 文件 | 用途 | 复用方式 |
|------|------|----------|
${params.relatedFilesTable}

### 2.2 现有架构模式

${params.patternsContent}

### 2.3 技术约束

${params.constraintsContent}

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
```

## 输出

技术方案文档将用于：
- Hard Stop 1: 用户审查和确认
- 子 agent 审查（可选）
- Phase 2: 任务生成（提取实施计划）
- 执行阶段：任务实现的参考文档
