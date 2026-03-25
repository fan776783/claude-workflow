# Phase 1: 技术设计生成详情

## 目的

在生成用户可审查的 `spec.md` 之前，先明确架构决策、系统边界、关键风险和技术约束，形成稳定的设计底稿。

> `tech-design.md` 的职责是**设计**，不再直接承担任务拆解与实施计划编译输入职责。

## 执行时机

**强制执行**：每次启动工作流时必须执行，位于 Phase 0.7 之后、Phase 1.2 之前。

## 实现细节

### Step 1: 生成任务名称

```typescript
const taskName = generateTaskName(requirementContent);
const sanitizedName = sanitize(taskName);

const techDesignPath = `.claude/tech-design/${sanitizedName}.md`;
ensureDir('.claude/tech-design');
```

### Step 2: 检查文件冲突

```typescript
let existingChoice = null;
if (fileExists(techDesignPath)) {
  if (forceOverwrite) {
    existingChoice = '重新生成';
    console.log(`⚡ 强制覆盖：${techDesignPath}`);
  } else {
    existingChoice = await AskUserQuestion({
      questions: [{
        question: `技术设计已存在：${techDesignPath}，如何处理？`,
        header: '文件冲突',
        multiSelect: false,
        options: [
          { label: '使用现有设计', description: '跳过生成，直接使用已有技术设计' },
          { label: '重新生成', description: '覆盖现有设计（原文件将丢失）' },
          { label: '取消', description: '停止工作流启动' }
        ]
      }]
    });

    if (existingChoice === '取消') {
      console.log('✅ 操作已取消');
      return;
    }

    if (existingChoice === '使用现有设计') {
      console.log(`✅ 使用现有技术设计：${techDesignPath}`);
    }
  }
}
```

### Step 3: 生成技术设计文档

```typescript
if (!fileExists(techDesignPath) || existingChoice === '重新生成') {
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

  const requirementDetailSections = requirementAnalysis
    ? renderRequirementDetailSections(requirementAnalysis)
    : '';

  const discussionSummarySection = discussionArtifact
    ? renderDiscussionSummarySection(discussionArtifact)
    : '';

  const techDesignTemplate = loadTemplate('tech-design-template.md');

  let techDesignContent: string;

  if (techDesignTemplate) {
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
      architecture_decisions: '（请根据需求补充架构设计）',
      module_structure: '（请根据需求补充模块结构）',
      data_models: '（请根据需求补充数据模型）',
      interface_design: '（请根据需求补充接口设计）',
      risks: '| （待评估） | - | - |'
    });
  } else {
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
✅ 技术设计草稿已生成

📄 文件路径：${techDesignPath}

⚠️ 请重点完善以下章节：
  - 3.1 架构决策
  - 3.2 模块划分
  - 3.3 数据模型
  - 3.4 接口设计
  - 4. 风险与缓解
  `);
}
```

## 技术设计文档结构

### 前置元数据（YAML Front Matter）

```yaml
---
version: 3
requirement_source: "docs/prd.md"
created_at: "2026-03-24T10:00:00Z"
status: draft
role: design-foundation
next_stage: spec-review
---
```

### 1. 需求摘要

原始需求内容（前 500 字符）。

### 1.x 需求详情（结构化提取）

如果执行了 Phase 0.5，此章节包含 9 维度的结构化需求。

### 1.y 需求澄清摘要

如果执行了 Phase 0.2，此章节记录澄清结论、方案选择和未就绪依赖。

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

#### 3.1 架构决策

记录关键 trade-off、选型原因与不采用方案。

#### 3.2 模块划分

```text
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

#### 3.3 数据模型

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

#### 3.4 接口设计

```typescript
interface LoginRequest {
  username: string;
  password: string;
}

interface LoginResponse {
  token: string;
  user: User;
}
```

### 4. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 密码存储安全 | 高 | 使用 bcrypt 加密 |
| Token 过期处理 | 中 | 设计 refresh token 机制 |

### 5. Spec Readiness Checklist

- [ ] 范围边界明确
- [ ] 模块划分可落到文件结构
- [ ] 用户行为已覆盖主路径与异常路径
- [ ] 验收来源已对齐 acceptance checklist
- [ ] 无明显 YAGNI 设计扩张

> 此清单用于 Phase 1.2 Spec Review，不用于直接生成任务。

## 从本阶段移出的职责

以下职责已迁移到新阶段：

- **实施计划** → `Phase 2: Plan Generation`
- **用户可读规范文档** → `Phase 1.3: Spec Generation`
- **任务清单生成** → `Phase 3: Task Compilation`

## 辅助函数

### generateTaskName

从需求内容生成简洁任务名称。

```typescript
function generateTaskName(content: string): string {
  // 提取需求的核心关键词
}
```

### sanitize

将任务名称转换为文件名安全的格式。

```typescript
function sanitize(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u4e00-\u9fa5]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) || 'workflow';
}
```

### loadTemplate

加载技术设计模板文件。

```typescript
function loadTemplate(templateName: string): string {
  const userPath = path.join(os.homedir(), '.claude/docs', templateName);
  if (fileExists(userPath)) return readFile(userPath);

  const repoPath = path.join(process.cwd(), 'templates/docs', templateName);
  if (fileExists(repoPath)) return readFile(repoPath);

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

将 RequirementAnalysis 渲染为 Markdown 章节，详见 `phase-0.5-requirement-extraction.md`。

### renderDiscussionSummarySection

将 DiscussionArtifact 渲染为 Markdown 章节，详见 `phase-0.2-requirement-discussion.md`。

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
version: 3
requirement_source: "${params.requirementSource}"
created_at: "${new Date().toISOString()}"
status: draft
role: design-foundation
next_stage: spec-review
---

# 技术设计: ${params.taskName}

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

### 3.1 架构决策

（请补充关键 trade-off 与设计选择）

### 3.2 模块划分

\`\`\`
（请根据需求补充模块结构）
\`\`\`

### 3.3 数据模型

\`\`\`typescript
（请补充数据模型）
\`\`\`

### 3.4 接口设计

\`\`\`typescript
（请补充接口设计）
\`\`\`

## 4. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| （待评估） | - | - |

## 5. Spec Readiness Checklist

- [ ] 范围边界明确
- [ ] 模块划分可落到文件结构
- [ ] 用户行为已覆盖主路径与异常路径
- [ ] 验收来源已对齐 acceptance checklist
- [ ] 无明显 YAGNI 设计扩张
`;
}
```
