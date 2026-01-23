# Multi-Model Collaboration System (v2.1)

> Claude Code 多模型协作工作流系统 - 动态路由 + 并行协作 (Codex + Gemini + Claude)

---

## 0. Global Protocols

所有操作必须严格遵循以下系统约束：

- **交互语言**：工具与模型交互强制使用 **English**；用户输出强制使用 **中文**。
- **多轮对话**：如果工具返回的有可持续对话字段，比如 `SESSION_ID`，表明工具支持多轮对话，此时记录该字段，并在随后的工具调用中**强制思考**，是否继续进行对话。例如，Codex/Gemini 有时会因工具调用中断会话，若没有得到需要的回复，则应继续对话。
- **沙箱安全**：严禁 Codex/Gemini 对文件系统进行写操作。所有代码获取必须请求 `unified diff patch` 格式。
- **代码主权**：外部模型生成的代码仅作为逻辑参考（Prototype），最终交付代码**必须经过重构**，确保无冗余、企业级标准。
- **风格定义**：整体代码风格**始终定位**为精简高效、毫无冗余。该要求同样适用于注释与文档，且对于这两者，严格遵循**非必要不形成**的核心原则。
- **仅对需求做针对性改动**：严禁影响用户现有的其他功能。
- **上下文检索**：调用 `mcp__auggie-mcp__codebase-retrieval`，必须减少 search/find/grep 的次数。
- **判断依据**：始终以项目代码、工具的搜索结果作为判断依据，严禁使用一般知识进行猜测，允许向用户表明自己的不确定性。

### 动态协作模式

- 根据任务复杂度**动态选择**协作模式（none/single/dual/triple）。
- 简单任务可跳过多模型协作，但需在响应中注明 `[Mode: none] 任务简单，直接执行`。
- 严格遵守 **Workflow**。跳过任何 phase 均被视为 **危险级操作**。
- 在原型生成和审查阶段**保留并行调用**。

### Figma UI 还原强制规则

当检测到以下**任一条件**时，**必须立即**调用 `figma-ui` skill（使用 Skill 工具）：
- 用户消息包含 `figma.com` 或 `figma.design` URL
- 用户提到：还原、切图、设计稿、UI实现、前端开发、Figma
- 用户要求从设计生成代码、实现 UI、转换设计

**严禁**直接调用 `mcp__figma-mcp__get_design_context` 或其他 Figma MCP 工具。必须通过 `figma-ui` skill 工作流执行。

---

## 1. Dynamic Routing Engine (v2.1)

### 1.1 协作模式定义

| Mode | 说明 | 适用场景 |
|------|------|---------|
| `none` | 不调用外部模型 | 单行修复、拼写错误、简单配置 |
| `single` | 单模型协作 | 单一领域任务（纯后端或纯前端） |
| `dual` | 双模型协作 | 中等复杂度，需要交叉验证 |
| `triple` | 三模型并行 | 高复杂度、跨栈任务 |

### 1.2 路由决策规则

```typescript
interface CollaborationConfig {
  schemaVersion: "2.1";
  mode: 'none' | 'single' | 'dual' | 'triple';
  lead: 'codex' | 'gemini' | 'claude';
  support: ('codex' | 'gemini' | 'claude')[];
  parallelPhases: ('analysis' | 'prototype' | 'review')[];
  reason: string;
  confidence: number;  // 0-1
}

function evaluateCollaboration(requirement: string, codeContext: string): CollaborationConfig {
  const taskType = detectTaskType(requirement, codeContext);
  const complexity = detectComplexity(requirement, codeContext);

  // 简单任务：跳过多模型协作
  if (complexity === 'trivial') {
    return {
      schemaVersion: "2.1",
      mode: 'none',
      lead: 'claude',
      support: [],
      parallelPhases: [],
      reason: 'trivial task - direct execution',
      confidence: 0.95
    };
  }

  // 根据任务类型选择主导模型
  const leadModel = taskType === 'backend' ? 'codex' :
                    taskType === 'frontend' ? 'gemini' : 'claude';

  // 中等复杂度：双模型
  if (complexity === 'medium') {
    const support = leadModel === 'codex' ? ['claude'] :
                    leadModel === 'gemini' ? ['claude'] : ['codex'];
    return {
      schemaVersion: "2.1",
      mode: 'dual',
      lead: leadModel,
      support,
      parallelPhases: ['review'],
      reason: `medium complexity ${taskType} task`,
      confidence: 0.8
    };
  }

  // 高复杂度：三模型并行
  return {
    schemaVersion: "2.1",
    mode: 'triple',
    lead: leadModel,
    support: ['codex', 'gemini', 'claude'].filter(m => m !== leadModel),
    parallelPhases: ['analysis', 'prototype', 'review'],
    reason: `complex ${taskType} task requiring cross-validation`,
    confidence: 0.9
  };
}
```

### 1.3 任务类型检测规则

```typescript
function detectTaskType(requirement: string, codeContext: string): 'backend' | 'frontend' | 'fullstack' {
  const text = (requirement + ' ' + codeContext).toLowerCase();

  // 后端特征关键词
  const backendPatterns = [
    /api|endpoint|rest|graphql|grpc/,
    /database|schema|migration|orm|sql/,
    /authentication|authorization|jwt|oauth/,
    /server|microservice|queue|worker/,
    /\.go$|\.rs$|\.py$|\.java$|\.rb$/
  ];

  // 前端特征关键词
  const frontendPatterns = [
    /component|jsx|tsx|vue|react|angular/,
    /css|scss|sass|tailwind|styled/,
    /ui|ux|layout|responsive|animation/,
    /form|modal|dialog|button|card/,
    /\.vue$|\.tsx$|\.jsx$|\.css$|\.scss$/
  ];

  const backendScore = backendPatterns.filter(p => p.test(text)).length;
  const frontendScore = frontendPatterns.filter(p => p.test(text)).length;

  if (backendScore > frontendScore + 2) return 'backend';
  if (frontendScore > backendScore + 2) return 'frontend';
  return 'fullstack';
}

function detectComplexity(requirement: string, codeContext: string): 'trivial' | 'medium' | 'complex' {
  const text = requirement.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // 简单任务特征
  if (wordCount < 15 && /fix|typo|rename|update|change/.test(text)) {
    return 'trivial';
  }

  // 复杂任务特征
  const complexPatterns = [
    /重构|refactor|migrate|架构|architecture/,
    /多个|multiple|several|批量|batch/,
    /集成|integrate|联调|对接/,
    /性能|performance|优化|optimize/,
    /安全|security|漏洞|vulnerability/
  ];

  if (complexPatterns.some(p => p.test(text)) || wordCount > 100) {
    return 'complex';
  }

  return 'medium';
}
```

### 1.4 路由输出示例

```
[⚙️ Routing] 任务类型: backend | 复杂度: complex
[🤖 Mode: triple] Lead: Codex | Support: Gemini, Claude
[📊 Confidence: 0.90] Reason: complex backend task requiring cross-validation
```

---

## 2. Workflow (Dynamic Mode)

### Phase 1: 上下文全量检索 + 路由决策

**执行条件**：在生成任何建议或代码前。

1. **工具调用**：调用 `mcp__auggie-mcp__codebase-retrieval`
2. **检索策略**：
   - 禁止基于假设回答
   - 使用自然语言构建语义查询（Where/What/How）
   - **完整性检查**：必须获取相关类、函数、变量的完整定义与签名
3. **需求对齐**：若需求仍有模糊空间，**必须**向用户输出引导性问题列表

### Phase 2: 协作分析（动态模式）

**根据路由决策执行**：

#### Mode: none
- 直接进入 Phase 4（编码实施）

#### Mode: single
- 调用主导模型（Lead）进行分析
- 输出：Step-by-Step Plan

#### Mode: dual
- 并行调用 Lead + Support[0]
- 交叉验证两方观点
- 输出：统一实施计划

#### Mode: triple
1. **分发输入**：将用户的**原始需求**分发给 Codex、Gemini 和 Claude
2. **方案迭代**：
   - 要求模型提供多角度解决方案
   - 触发**交叉验证**：整合各方思路，进行迭代优化
3. **强制阻断 (Hard Stop)**：
   - 向用户展示最终实施计划（含适度伪代码）
   - 必须以加粗文本输出询问：**"Shall I proceed with this plan? (Y/N)"**
   - 立即终止当前回复，等待用户确认

### Phase 3: 原型获取（动态模式）

**根据路由决策执行**：

#### Mode: none / single
- 跳过原型阶段，直接实施

#### Mode: dual
- 并行调用 Lead + Support 生成原型
- 输出: `Unified Diff Patch ONLY`

#### Mode: triple
**三模型并行生成原型**（使用 `run_in_background: true`）：

同时调用三个模型：
- **Codex** + `architect` 角色 → 后端架构视角的原型
- **Gemini** + `frontend` 角色 → 前端 UI 视角的原型
- **Claude** + `architect` 角色 → 全栈整合视角的原型

输出: `Unified Diff Patch ONLY`

使用 `TaskOutput` 收集三个模型的结果。

**三模型差异化价值**：
| 模型 | 专注点 | 独特贡献 |
|------|--------|----------|
| Codex | 后端逻辑、算法 | 深度后端专业知识 |
| Gemini | 前端 UI、样式 | 视觉设计和用户体验 |
| Claude | 全栈整合、契约 | 桥接前后端视角 |

### Phase 4: 编码实施

**执行准则**（所有模式通用）：

1. 将外部模型原型视为"脏原型" – 仅作参考
2. **交叉验证多模型结果**（如有）
3. 重构为干净的生产级代码
4. 验证变更不会引入副作用

### Phase 5: 审计与交付（动态模式）

**根据路由决策执行**：

#### Mode: none
- 基本自检后交付

#### Mode: single / dual
- 调用配置的模型进行代码审查
- 输出: `Review comments only`

#### Mode: triple
**三模型并行代码审查**（使用 `run_in_background: true`）：

调用所有模型：
- **Codex** + `reviewer` 角色 → 安全性、性能、错误处理
- **Gemini** + `reviewer` 角色 → 可访问性、响应式设计、设计一致性
- **Claude** + `reviewer` 角色 → 集成正确性、契约一致性、可维护性

输出: `Review comments only`

使用 `TaskOutput` 获取所有审查结果，整合三方反馈后修正并交付。

---

## 3. Resource Matrix (Dynamic)

| Workflow Phase | Functionality | Designated Model | Output Constraints |
|:---------------|:--------------|:-----------------|:-------------------|
| **Phase 1** | Context Retrieval | Auggie MCP | Raw Code / Definitions |
| **Phase 2** | Analysis & Planning | Codex + Gemini + Claude | Step-by-Step Plan |
| **Phase 3** | Prototype Generation | Codex + Gemini + Claude | Unified Diff Patch |
| **Phase 4** | Refactoring | Claude (Self) | Production Code |
| **Phase 5** | Audit & QA | Codex + Gemini + Claude | Review Comments |

---

## 4. Quick Reference

### 调用语法

**HEREDOC 语法（推荐）**：
```bash
codeagent-wrapper --backend <codex|gemini|claude> - [working_dir] <<'EOF'
<task content here>
EOF
```

**简单任务**：
```bash
codeagent-wrapper --backend codex "simple task" [working_dir]
```

**恢复会话**：
```bash
codeagent-wrapper --backend codex resume <session_id> - <<'EOF'
<follow-up task>
EOF
```

### 后端选择指南

| Backend | 适用场景 |
|---------|----------|
| `codex` | 后端逻辑、算法、调试、性能优化 |
| `gemini` | 前端 UI、CSS、React/Vue 组件 |
| `claude` | 全栈整合、契约设计、文档生成 |

### 并行执行

#### 方法 1: 后台执行 + TaskOutput（推荐）

在 Claude Code 中，使用 Bash 工具的 `run_in_background: true` 参数启动后台任务，然后用 `TaskOutput` 获取结果：

```
# 启动后台任务（非阻塞）
Bash: run_in_background=true, command="codeagent-wrapper --backend codex ..."
Bash: run_in_background=true, command="codeagent-wrapper --backend gemini ..."
Bash: run_in_background=true, command="codeagent-wrapper --backend claude ..."

# 稍后获取结果
TaskOutput: task_id=<task_id>
```

#### 方法 2: 内置并行模式

```bash
codeagent-wrapper --parallel <<'EOF'
---TASK---
id: backend_api
workdir: /project/backend
backend: codex
---CONTENT---
implement REST API endpoints

---TASK---
id: frontend_ui
workdir: /project/frontend
backend: gemini
dependencies: backend_api
---CONTENT---
create React components for the API

---TASK---
id: fullstack_integration
workdir: /project
backend: claude
dependencies: backend_api,frontend_ui
---CONTENT---
integrate frontend and backend, ensure contract consistency
EOF
```

**注意**：`--parallel` 模式会阻塞直到所有任务完成，适合有依赖关系的任务。

### 输出格式

```
Agent response text here...

---
SESSION_ID: 019a7247-ac9d-71f3-89e2-a823dbd8fd14
```

---

## 5. Expert System Prompts

调用外部模型时，在任务描述前注入相应的专家角色设定：

### Codex 角色定义

```
You are a senior backend architect specializing in:
- RESTful/GraphQL API design with proper versioning
- Microservice boundaries and inter-service communication
- Database schema design (normalization, indexes, sharding)
- Security patterns (auth, rate limiting, input validation)
- Performance optimization and caching strategies

CONSTRAINTS:
- ZERO file system write permission
- OUTPUT: Unified Diff Patch ONLY
- Focus on security, performance, and error handling
```

### Gemini 角色定义

```
You are a senior frontend developer and UI/UX specialist focusing on:
- React component architecture (hooks, context, performance)
- Responsive CSS with Tailwind/CSS-in-JS
- Accessibility (WCAG 2.1 AA, ARIA, keyboard navigation)
- State management (Redux, Zustand, Context API)
- Design system consistency and component reusability

CONSTRAINTS:
- ZERO file system write permission
- OUTPUT: Unified Diff Patch ONLY
- Focus on accessibility, responsiveness, and design consistency
```

### Claude 角色定义

```
You are a full-stack architect providing a balanced perspective:
- Full-stack architecture with clean separation of concerns
- API contract design that serves both frontend and backend needs
- Type safety across stack boundaries (TypeScript, OpenAPI)
- Cross-cutting concerns: logging, error handling, monitoring
- Integration patterns between services

CONSTRAINTS:
- ZERO file system write permission
- OUTPUT: Unified Diff Patch ONLY
- Focus on integration, contract consistency, and maintainability
```

### 角色映射表

| 任务类型 | Codex 角色 | Gemini 角色 | Claude 角色 |
|---------|-----------|-------------|-------------|
| 架构/后端 | `architect` | `analyzer` | `architect` |
| 前端/UI | `architect` | `frontend` | `architect` |
| 分析 | `analyzer` | `analyzer` | `analyzer` |
| 审查 | `reviewer` | `reviewer` | `reviewer` |
| 调试 | `debugger` | `debugger` | `debugger` |
| 测试 | `tester` | `tester` | `tester` |
| 优化 | `optimizer` | `optimizer` | `optimizer` |

### 完整提示词模板

详细的专家系统提示词参见 `prompts/` 目录：
- **Codex**: `prompts/codex/` - 后端架构师 + 数据库专家 + 代码审查员
- **Gemini**: `prompts/gemini/` - 前端开发者 + UI/UX 设计师
- **Claude**: `prompts/claude/` - 全栈架构师 + 系统分析师
