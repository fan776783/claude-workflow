# Phase 0.2: 需求分析讨论详情

## 快速导航

- 想看何时跳过讨论：看“触发条件”
- 想看如何识别 gap / 澄清维度：看后续 gap 分析章节
- 想看对话方式与问题顺序：看后续提问协议章节
- 想看产物持久化：搜 discussion-artifact

## 何时读取

- Phase 0 分析后仍有需求模糊点时
- 需要确认 `--no-discuss`、短需求跳过与澄清协议时

## 目的

在结构化提取前，通过交互式对话发现需求文档中的模糊点、缺失项和隐含假设，确保需求理解充分再进入设计阶段。

## 执行时机

**条件执行**：Phase 0 代码分析完成后

### 触发条件

```typescript
function shouldRunDiscussion(
  requirementContent: string,
  requirementSource: string,
  flags: string[],
  analysisResult: AnalysisResult
): boolean {
  // 1. 用户显式跳过
  if (flags.includes('--no-discuss')) {
    console.log('⏭️ 跳过需求讨论（用户指定 --no-discuss）');
    return false;
  }

  // 2. 内联短需求 + 预分析无 gap：跳过
  if (requirementSource === 'inline' && requirementContent.length <= 100) {
    const gaps = analyzeRequirementGaps(requirementContent, analysisResult);
    if (gaps.length === 0) {
      console.log('⏭️ 跳过需求讨论（简短明确的内联需求，无待澄清项）');
      return false;
    }
  }

  // 3. 其他情况：执行讨论
  return true;
}
```

> **与 Phase 0 参数解析的关系**：`--no-discuss` 需在 Phase 0 的参数解析中注册。
> 参见 `phase-0-code-analysis.md` Step 1。

## 实现细节

### Step 1: 需求预分析

基于 Phase 0 的代码分析结果和需求内容，识别待澄清事项。

```typescript
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 Phase 0.2: 需求分析讨论
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 需求预分析：识别需要澄清的维度
const allGaps = analyzeRequirementGaps(requirementContent, analysisResult);

// ── 短路：无 gap 时生成最小讨论工件并继续 ──
if (allGaps.length === 0) {
  const discussionArtifact: DiscussionArtifact = {
    timestamp: new Date().toISOString(),
    requirementSource: requirementSource,
    clarifications: [],
    selectedApproach: null,
    unresolvedDependencies: []
  };

  ensureDir(workflowDir);
  const artifactPath = path.join(workflowDir, 'discussion-artifact.json');
  writeFile(artifactPath, JSON.stringify(discussionArtifact, null, 2));

  console.log('✅ 未发现需澄清项，已生成最小 discussion-artifact.json');
  return;
}

// ── 量控：按优先级排序，首轮最多 5 题 ──
const MAX_QUESTIONS_PER_ROUND = 5;
const sortedGaps = allGaps.sort((a, b) => a.priority - b.priority);
const currentRoundGaps = sortedGaps.slice(0, MAX_QUESTIONS_PER_ROUND);
const remainingCount = sortedGaps.length - currentRoundGaps.length;

console.log(`
📋 识别到 ${allGaps.length} 个待澄清项${remainingCount > 0 ? `（本轮提问 ${currentRoundGaps.length} 个，剩余 ${remainingCount} 个）` : ''}
`);
```

### Step 2: 交互式澄清循环

**核心原则**：每次只问一个问题，优先使用选择题，支持跳过当前题和结束讨论。

```typescript
const clarifications: Clarification[] = [];
let userEndedDiscussion = false;

async function askOneQuestion(
  gap: RequirementGap,
  index: number,
  total: number
): Promise<void> {
  const question = formatQuestion(gap);

  // 统一调用：选择题和自由输入都传 options（流程控制选项）
  // 自由输入题的 options 仅包含流程控制项，用户可直接输入文本或选择控制项
  const answer = await AskUserQuestion({
    questions: [{
      question: question.text,
      header: `需求澄清 (${index}/${total})`,
      multiSelect: false,
      options: question.options
    }]
  });

  // 跳过当前题
  if (answer === '跳过此问题') {
    return;
  }

  // 结束讨论
  if (answer === '结束讨论') {
    console.log('⏭️ 用户选择结束讨论');
    userEndedDiscussion = true;
    return;
  }

  // "由我补充说明" → 追加自由输入
  if (answer === '由我补充说明') {
    const freeAnswer = await AskUserQuestion({
      questions: [{
        question: `请补充说明 — ${gap.description}：`,
        header: '自由补充'
      }]
    });
    clarifications.push({
      dimension: gap.dimension,
      question: question.text,
      answer: freeAnswer,
      impact: gap.impact
    });
    return;
  }

  clarifications.push({
    dimension: gap.dimension,
    question: question.text,
    answer: answer,
    impact: gap.impact
  });
}

// ── 分轮提问 ──
let offset = 0;
while (offset < sortedGaps.length && !userEndedDiscussion) {
  const roundGaps = sortedGaps.slice(offset, offset + MAX_QUESTIONS_PER_ROUND);
  const totalGaps = sortedGaps.length;

  for (let i = 0; i < roundGaps.length; i++) {
    if (userEndedDiscussion) break;
    await askOneQuestion(roundGaps[i], offset + i + 1, totalGaps);
  }

  offset += MAX_QUESTIONS_PER_ROUND;
  const remaining = sortedGaps.length - offset;

  // 本轮结束后，如果还有剩余且用户未主动结束，询问是否继续
  if (remaining > 0 && !userEndedDiscussion) {
    const continueChoice = await AskUserQuestion({
      questions: [{
        question: `还有 ${remaining} 个待澄清项，是否继续？`,
        header: '继续讨论',
        multiSelect: false,
        options: [
          { label: '继续提问', description: `查看剩余 ${remaining} 个问题` },
          { label: '足够了', description: '使用已有信息继续' }
        ]
      }]
    });

    if (continueChoice !== '继续提问') {
      break;
    }
  }
}
```

### Step 3: 方案探索（条件执行）

**触发条件**：仅在存在互斥实现路径或显著非功能性 tradeoff 时触发

```typescript
const needsApproachExploration = detectMultipleApproaches(
  requirementContent,
  analysisResult,
  clarifications
);

let selectedApproach: ApproachSelection | null = null;

if (needsApproachExploration) {
  const approaches = generateApproaches(requirementContent, analysisResult, clarifications);

  console.log(`
## 方案对比

${approaches.map((a, i) => `
### 方案 ${i + 1}: ${a.name} ${a.recommended ? '⭐ 推荐' : ''}

${a.description}

**优势**: ${a.pros.join('、')}
**劣势**: ${a.cons.join('、')}
**复杂度**: ${a.complexity}
`).join('\n')}
  `);

  const approachChoice = await AskUserQuestion({
    questions: [{
      question: '请选择实现方案：',
      header: '方案选择',
      multiSelect: false,
      options: [
        ...approaches.map((a, i) => ({
          label: `方案 ${i + 1}: ${a.name}`,
          description: `${a.recommended ? '⭐ 推荐 | ' : ''}${a.description.substring(0, 80)}`
        })),
        { label: '暂不选择', description: '留到技术设计阶段再决定' }
      ]
    }]
  });

  if (approachChoice !== '暂不选择') {
    const chosenIndex = approaches.findIndex((a, i) => approachChoice.startsWith(`方案 ${i + 1}`));
    const chosen = approaches[chosenIndex];
    selectedApproach = {
      id: `APR-${chosenIndex + 1}`,
      name: chosen.name,
      reason: `用户在需求讨论阶段选择`,
      rejectedAlternatives: approaches
        .filter((_, i) => i !== chosenIndex)
        .map(a => ({ name: a.name, rejectionReason: '用户未选择' }))
    };
  }
}
```

### Step 4: 持久化讨论工件 + 输出

```typescript
// ── 构建讨论工件（结构化，独立于原始需求） ──
const discussionArtifact: DiscussionArtifact = {
  timestamp: new Date().toISOString(),
  requirementSource: requirementSource,
  clarifications: clarifications,
  selectedApproach: selectedApproach,
  unresolvedDependencies: extractUnresolvedDependencies(clarifications)
};

// ── 持久化到文件（可审计） ──
ensureDir(workflowDir);  // 确保工作流目录存在（可能是首次启动）
const artifactPath = path.join(workflowDir, 'discussion-artifact.json');
writeFile(artifactPath, JSON.stringify(discussionArtifact, null, 2));

console.log(`
✅ 需求讨论完成

📋 澄清项：${clarifications.length} 个
${selectedApproach ? `🎯 选定方案：${selectedApproach.name}` : ''}
${discussionArtifact.unresolvedDependencies.length > 0
  ? `⚠️ 未就绪依赖：${discussionArtifact.unresolvedDependencies.map(d => d.type).join('、')}`
  : ''}
📄 讨论纪要：${artifactPath}

### 关键澄清结果
${clarifications.slice(0, 5).map(c =>
  `- **${c.dimension}**: ${c.answer}`
).join('\n')}
`);
```


### Step 4.5: 技术决策反写 project-config.json

**目的**：将讨论过程中确认的技术选型（如 Tauri、React 等）反写到 `project-config.json` 的 `tech` 字段。

```typescript
// 
// Step 4.5: 技术决策反写 project-config.json
// 
const techDecisions = extractTechDecisions(clarifications);

if (techDecisions.length > 0) {
  const configPath = '.claude/config/project-config.json';
  if (fileExists(configPath)) {
    const config = JSON.parse(readFile(configPath));

    // 仅在 tech 字段存在 unknown/missing 时补充（不覆盖 scan 的完整检测结果）
    // 框架字段做并集补充；其他字段仅补 unknown/missing
    const needsBackfill = config.tech.buildTool === 'unknown'
      || config.tech.packageManager === 'unknown'
      || config._scanMode === 'auto-healed';

    if (needsBackfill) {
      for (const decision of techDecisions) {
        if (decision.type === 'framework') {
          config.tech.frameworks = [...new Set([...config.tech.frameworks, decision.value])];
        }
        if (decision.type === 'packageManager' && config.tech.packageManager === 'unknown') {
          config.tech.packageManager = decision.value;
        }
        if (decision.type === 'buildTool' && config.tech.buildTool === 'unknown') {
          config.tech.buildTool = decision.value;
        }
      }
      config._scanMode = 'discussion-enriched';
      writeFile(configPath, JSON.stringify(config, null, 2));
      console.log(` 技术决策已反写: ${techDecisions.map(d => d.value).join(', ')}`);
    } else {
      // scan/full 模式：框架做并集补充，其他字段冲突时告警不覆盖
      let hasConflict = false;
      for (const decision of techDecisions) {
        if (decision.type === 'framework') {
          config.tech.frameworks = [...new Set([...config.tech.frameworks, decision.value])];
        } else {
          const currentValue = config.tech[decision.type];
          if (currentValue && currentValue !== 'unknown' && currentValue !== decision.value) {
            console.warn(`⚠️ 技术决策冲突: 讨论选择 ${decision.type}=${decision.value}，但 scan 检测到 ${currentValue}。保留 scan 结果。`);
            hasConflict = true;
          }
        }
      }
      if (!hasConflict) {
        writeFile(configPath, JSON.stringify(config, null, 2));
      }
    }
  }
}

// 技术关键词映射
function extractTechDecisions(clarifications: Clarification[]): TechDecision[] {
  const decisions: TechDecision[] = [];
  const keywords: Record<string, { type: string; value: string }> = {
    'tauri': { type: 'framework', value: 'tauri' },
    'react': { type: 'framework', value: 'react' },
    'vue': { type: 'framework', value: 'vue' },
    'next': { type: 'framework', value: 'nextjs' },
    'vite': { type: 'buildTool', value: 'vite' },
    'pnpm': { type: 'packageManager', value: 'pnpm' },
    'npm': { type: 'packageManager', value: 'npm' },
  };
  for (const c of clarifications) {
    const answer = c.answer.toLowerCase();
    for (const [kw, decision] of Object.entries(keywords)) {
      if (answer.includes(kw)) decisions.push(decision);
    }
  }
  return decisions;
}
```

## 数据结构

```typescript
// ── 核心数据 ──

interface Clarification {
  dimension: string;       // scope | behavior | edge-case | constraint | dependency | permission | nfr
  question: string;
  answer: string;
  impact: string;
}

interface ApproachSelection {
  id: string;              // APR-1, APR-2, ...
  name: string;
  reason: string;
  rejectedAlternatives: Array<{
    name: string;
    rejectionReason: string;
  }>;
}

interface UnresolvedDependency {
  type: 'api_spec' | 'external';  // 仅保留 api_spec 和 external，设计稿通过 /figma-ui 处理
  status: 'mock' | 'not_started';
  description: string;
}

// ── 讨论工件（独立于原始需求，结构化 side-channel） ──

interface DiscussionArtifact {
  timestamp: string;
  requirementSource: string;
  clarifications: Clarification[];
  selectedApproach: ApproachSelection | null;
  unresolvedDependencies: UnresolvedDependency[];
}

// ── Gap 检测 ──

interface RequirementGap {
  dimension: string;
  description: string;
  priority: number;        // 1=高，2=中，3=低
  impact: string;
  suggestedQuestion: string;
  responseType: 'single_select' | 'free_text';
  options?: string[];      // responseType === 'single_select' 时必填
}
```

## 需求预分析函数

### analyzeRequirementGaps

从需求文档中识别模糊、缺失和假设性内容。

```typescript
function analyzeRequirementGaps(
  requirement: string,
  analysisResult: AnalysisResult
): RequirementGap[] {
  const gaps: RequirementGap[] = [];

  // ── 1. 范围边界检查 ──
  // 检测"等"、"之类的"、"相关"等模糊范围词
  if (/等(功能|模块|操作|页面)|之类的|相关功能|以及其他/.test(requirement)) {
    gaps.push({
      dimension: 'scope',
      description: '需求中包含模糊范围描述',
      priority: 1,
      impact: '可能导致实现范围不明确',
      suggestedQuestion: '需求中提到模糊范围词，请确认具体包含哪些功能/模块？',
      responseType: 'free_text'
    });
  }

  // ── 2. 行为未定义检查 ──
  const actionPatterns = [
    { pattern: /导[出入]/, dimension: '导入导出', questions: ['格式（CSV/Excel/PDF）', '数据范围', '权限要求'] },
    { pattern: /通知|提醒/, dimension: '通知', questions: ['通知渠道（邮件/站内信/短信）', '触发条件', '频率控制'] },
    { pattern: /审[批核]/, dimension: '审批', questions: ['审批层级', '驳回后流程', '超时处理'] },
    { pattern: /搜索|检索|筛选/, dimension: '搜索', questions: ['搜索字段范围', '模糊匹配规则', '结果排序'] },
  ];

  for (const { pattern, dimension, questions } of actionPatterns) {
    if (pattern.test(requirement)) {
      gaps.push({
        dimension: 'behavior',
        description: `${dimension}功能缺少细节定义`,
        priority: 2,
        impact: `${questions.join('、')}未明确`,
        suggestedQuestion: `关于${dimension}，以下哪些细节需要确认？`,
        responseType: 'single_select',
        options: [...questions, '都已在需求中明确', '由我补充说明']
      });
    }
  }

  // ── 3. 边界场景检查 ──
  const edgeCaseChecks = [
    { keyword: /列表|表格/, check: '空状态', question: '数据为空时如何展示？',
      options: ['空状态插图+文案', '"暂无数据"文本', '隐藏整个模块', '由我补充说明'] },
    { keyword: /删除|移除/, check: '删除策略', question: '删除操作的策略？',
      options: ['二次确认+软删除', '二次确认+硬删除', '无需确认', '由我补充说明'] },
    { keyword: /上传|导入/, check: '失败处理', question: '上传/导入失败时如何处理？',
      options: ['提示错误+允许重试', '部分成功+展示失败明细', '全部回滚', '由我补充说明'] },
  ];

  for (const { keyword, check, question, options } of edgeCaseChecks) {
    if (keyword.test(requirement)) {
      gaps.push({
        dimension: 'edge-case',
        description: `缺少${check}描述`,
        priority: 2,
        impact: `${check}行为未定义`,
        suggestedQuestion: question,
        responseType: 'single_select',
        options: options
      });
    }
  }

  // ── 4. 权限与角色检查 ──
  if (/角色|权限|管理员|普通用户|审批人/.test(requirement)) {
    gaps.push({
      dimension: 'permission',
      description: '需求涉及角色权限但未明确矩阵',
      priority: 1,
      impact: '不同角色的操作边界不清晰',
      suggestedQuestion: '涉及哪些角色？各角色的操作权限边界是什么？',
      responseType: 'free_text'
    });
  }

  // ── 5. 非功能性需求检查 ──
  if (/大量数据|高并发|性能|实时|海量/.test(requirement)) {
    gaps.push({
      dimension: 'nfr',
      description: '存在性能/规模相关描述但缺少量化指标',
      priority: 2,
      impact: '无法确定技术选型和优化策略',
      suggestedQuestion: '请确认性能要求：预期数据量级、并发量、响应时间要求？',
      responseType: 'free_text'
    });
  }

  // ── 6. 技术约束冲突检查 ──
  if (analysisResult.constraints.length > 0) {
    for (const constraint of analysisResult.constraints) {
      const conflicts = detectConflict(requirement, constraint);
      if (conflicts) {
        gaps.push({
          dimension: 'constraint',
          description: `需求可能与现有约束冲突：${constraint}`,
          priority: 1,
          impact: '实现方式需要与现有架构协调',
          suggestedQuestion: `现有项目约束"${constraint}"，需求中的做法是否需要调整？`,
          responseType: 'single_select',
          options: ['遵循现有约束', '需求优先，调整架构', '由我补充说明']
        });
      }
    }
  }

  // ── 7. 外部依赖检查 ──
  // 仅检查 API 和第三方服务；设计稿依赖通过 /figma-ui 处理
  const dependencyPatterns = [
    { pattern: /接口|API|后端/, dep: 'api_spec' as const,
      question: '后端接口是否已就绪？',
      options: ['已就绪，有文档', '开发中，可先用 Mock', '未开始，需要协调', '由我补充说明'] },
    { pattern: /第三方|SDK|外部服务/, dep: 'external' as const,
      question: '第三方服务的接入文档和凭证是否已准备？',
      options: ['已准备', '部分准备', '未开始', '由我补充说明'] },
  ];

  for (const { pattern, dep, question, options } of dependencyPatterns) {
    if (pattern.test(requirement)) {
      gaps.push({
        dimension: 'dependency',
        description: `检测到外部依赖：${dep}`,
        priority: 1,
        impact: '缺少依赖可能阻塞实现',
        suggestedQuestion: question,
        responseType: 'single_select',
        options: options
      });
    }
  }

  // ── 8. UX 导航结构检查 ──
  if (/页面|界面|UI|前端|dashboard|面板|窗口|桌面/.test(requirement)) {
    // 检查是否有导航/路由描述
    if (!/导航|路由|标签页|tab|侧边栏|sidebar/i.test(requirement)) {
      gaps.push({
        dimension: 'ux-navigation',
        description: '需求涉及多个页面/面板但未描述导航结构',
        priority: 1,
        impact: '可能导致所有功能堆砌在单一页面',
        suggestedQuestion: '多个功能模块如何组织？',
        responseType: 'single_select',
        options: [
          '侧边栏 + 路由切换',
          '标签页切换',
          '单页面多面板',
          '由我补充说明'
        ]
      });
    }

    // 检查是否有首次使用描述
    if (!/首次|初始化|引导|onboarding|配置向导/i.test(requirement)) {
      gaps.push({
        dimension: 'ux-onboarding',
        description: '需求未描述用户首次使用的引导流程',
        priority: 2,
        impact: '新用户可能不知道第一步做什么',
        suggestedQuestion: '首次打开应用时如何引导用户？',
        responseType: 'single_select',
        options: [
          '配置向导（Step by Step）',
          '空状态引导 + 默认配置',
          '自动探测并推荐配置',
          '无需引导，直接使用',
          '由我补充说明'
        ]
      });
    }
  }

  // ── 去重：同维度只保留最高优先级 ──
  const deduped = deduplicateByDimension(gaps);

  return deduped;
}
```

### detectMultipleApproaches

仅在存在互斥实现路径或显著非功能性 tradeoff 时触发。

```typescript
function detectMultipleApproaches(
  requirement: string,
  analysisResult: AnalysisResult,
  clarifications: Clarification[]
): boolean {
  let score = 0;

  // 1. 存在互斥的架构模式（如 REST vs GraphQL、SSR vs CSR）
  const mutuallyExclusivePatterns = detectMutuallyExclusivePatterns(analysisResult.patterns);
  if (mutuallyExclusivePatterns) score += 2;

  // 2. 需求显式涉及技术选型对比（精确匹配技术决策语义，避免自然语言"或者"误触发）
  if (/方案[AB12]|技术选型|vs\b|VS\b|\.{3}还是\.{3}|对比.*方案/.test(requirement)) score += 2;

  // 3. 涉及状态管理、通信方式等有明显 tradeoff 的决策
  if (/状态管理|缓存策略|实时.*轮询|WebSocket.*SSE/.test(requirement)) score += 1;

  // 4. 澄清过程中发现约束冲突
  const constraintClarifications = clarifications.filter(c => c.dimension === 'constraint');
  if (constraintClarifications.length > 0) score += 1;

  // 阈值：score >= 2 时触发
  return score >= 2;
}
```

### formatQuestion

将 Gap 转换为用户友好的提问格式。

```typescript
interface FormattedQuestion {
  text: string;
  responseType: 'single_select' | 'free_text';
  options?: Array<{ label: string; description?: string }>;
}

function formatQuestion(gap: RequirementGap): FormattedQuestion {
  const text = gap.suggestedQuestion;

  // 流程控制选项（所有题型通用）
  const controlOptions = [
    { label: '跳过此问题', description: '跳过当前问题，继续下一个' },
    { label: '结束讨论', description: '结束讨论，使用已有信息继续' }
  ];

  if (gap.responseType === 'free_text') {
    // 开放问题：仅展示流程控制选项
    // 用户可直接输入文本回答，或选择控制选项
    return {
      text: text + '\n（请直接输入回答，或选择下方选项）',
      responseType: 'free_text',
      options: controlOptions
    };
  }

  // 选择题：业务选项 + 流程控制选项
  return {
    text,
    responseType: 'single_select',
    options: [
      ...gap.options.map(opt => ({ label: opt })),
      ...controlOptions
    ]
  };
}
```

### extractUnresolvedDependencies

从澄清结果中提取未就绪的外部依赖，映射到 workflow 状态机可消费的格式。

```typescript
function extractUnresolvedDependencies(
  clarifications: Clarification[]
): UnresolvedDependency[] {
  const deps: UnresolvedDependency[] = [];

  for (const c of clarifications) {
    if (c.dimension !== 'dependency') continue;

    // 选择题路径：基于选项语义判定（"已就绪"/"已准备" → 不阻塞，其余 → 阻塞）
    const depType: 'api_spec' | 'external' =
      (c.question.includes('接口') || c.question.includes('API')) ? 'api_spec' : 'external';

    if (c.answer.includes('已就绪') || c.answer.includes('已准备')) {
      // 明确就绪，不阻塞
      continue;
    }

    if (c.answer.includes('Mock') || c.answer.includes('开发中') || c.answer.includes('部分准备')) {
      deps.push({ type: depType, status: 'mock', description: c.answer });
    } else {
      // 保守策略：无法识别的回答（包括自由输入）默认归为 not_started
      deps.push({ type: depType, status: 'not_started', description: c.answer });
    }
  }

  return deps;
}
```

### deduplicateByDimension

同维度去重，保留最高优先级的 gap。

```typescript
function deduplicateByDimension(gaps: RequirementGap[]): RequirementGap[] {
  const seen = new Map<string, RequirementGap>();

  for (const gap of gaps) {
    const key = `${gap.dimension}:${gap.description}`;
    const existing = seen.get(key);
    if (!existing || gap.priority < existing.priority) {
      seen.set(key, gap);
    }
  }

  return Array.from(seen.values());
}
```

## 与后续阶段的衔接

讨论结果通过 **结构化 side-channel** 传递，**不修改原始需求内容**：

```typescript
// ── 原始需求保持不变 ──
// requirementContent 不被修改，Phase 1 的 Spec 生成不受影响

// ── 讨论工件作为独立输入传递 ──
// Phase 1:  Spec 生成时，显式消费 discussionArtifact
//   → spec 中新增"需求澄清摘要"章节
//   → 若有 selectedApproach，直接作为架构设计的起点
//   → unresolvedDependencies 映射到 Scope 中的 blocked 需求
```

### Phase 1 Spec 生成适配

Spec 生成函数签名为 `generateSpec(requirementContent, analysisResult, discussionArtifact?)`。
详见 `phase-1-spec-generation.md`。

### 状态机适配

`workflow-state.json` 已新增 `discussion` 字段。
详见 `../../../../specs/workflow-runtime/state-machine.md`。

## 输出

讨论工件持久化为 `~/.claude/workflows/{projectId}/discussion-artifact.json`，用于：
- Phase 1: Spec 生成（澄清结果 + 方案选择 + 未就绪依赖）
- 审计追溯：讨论过程可回溯

> 若 Phase 0.2 被整体跳过（如 `--no-discuss` 或简短明确的内联需求），允许不存在讨论工件；但只要进入 Phase 0.2 执行路径，即使未发现 gap，也必须落盘最小 `discussion-artifact.json`。

### ⚠️ 持久化强制要求

讨论结束后（无论用户主动结束还是所有问题澄清完毕），**必须执行 Step 4 的持久化操作**：

1. 构建 `DiscussionArtifact` JSON 对象（含 `clarifications`、`selectedApproach`、`unresolvedDependencies`）
2. 写入 `~/.claude/workflows/{projectId}/discussion-artifact.json`
3. 输出确认：`✅ 讨论纪要已保存至 discussion-artifact.json`

> ⚠️ **不得仅依赖对话上下文记忆**。即使讨论内容简短（如只澄清了 1 个问题），也必须生成结构化工件并写入文件。Phase 1 Spec 生成会读取此文件。
