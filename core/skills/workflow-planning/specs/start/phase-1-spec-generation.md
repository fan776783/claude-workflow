# Phase 1: Spec Generation 详情

## 快速导航

- 想看 Spec 的输入来源：看"输入"
- 想看 PRD 原文回溯扫描：看 Step 3 与 Self-Review
- 想看模板与输出路径：看 Step 2 与输出章节

## 何时读取

- Phase 0 / 0.2 / 0.3 完成后，需要正式生成 `spec.md` 时

## 目的

生成统一的 `spec.md`，在单一文档中完成需求范围判定、关键约束提取、架构设计、用户行为描述和验收标准定义。

> spec.md 是后续 plan.md 的**唯一权威上游**。

## 执行时机

**强制执行**：Phase 0（代码分析）完成后执行；若 Phase 0.2（需求讨论）被触发则必须先完成，若 Phase 0.3（UX 设计审批）被触发则必须先审批通过。

## 输入

- `requirementContent`（原始需求或 PRD 内容）
- `analysisResult`（Phase 0 代码分析结果）
- `discussion-artifact.json`（如有，Phase 0.2 讨论结果）
- `ux-design-artifact.json`（如有，Phase 0.3 UX 设计工件）
- `projectConfig`（项目配置）

## 输出

- `.claude/specs/{task-name}.md`
- `prd-spec-coverage.json`（PRD 覆盖率报告，供 Phase 1.1 User Review 展示）

## 实现细节

### Step 1: 生成路径与检查冲突

```typescript
const specPath = `.claude/specs/${sanitizedName}.md`;
ensureDir('.claude/specs');

if (fileExists(specPath) && !forceOverwrite) {
  // 询问用户使用现有 / 重新生成 / 取消
}
```

### Step 2: 渲染 Spec 文档

使用 `spec-template.md` 模板渲染。模板已移除 Requirement Baseline 相关章节（§1.3 / §2.4 / §3.1 / §9.1），Spec 直接从 PRD 原文提取结构化内容。

```typescript
const specTemplate = loadTemplate('spec-template.md');
const specContent = renderTemplate(specTemplate, {
  task_name: taskName,
  requirement_source: requirementSource,
  created_at: new Date().toISOString(),
  context_summary: `- 原始需求来源: ${requirementSource}\n- 需求摘要: ${summary}`,
  scope_summary: deriveScopeFromPRD(requirementContent),
  out_of_scope_summary: '- 未在原始需求中明确提出的扩展项不纳入本次范围',
  blocked_summary: '- 无',
  critical_constraints: deriveConstraintsFromPRD(requirementContent, discussionArtifact),
  user_facing_behavior: deriveUserBehaviorFromPRD(requirementContent, uxDesignArtifact),
  architecture_summary: deriveArchitecture(analysisResult, requirementContent),
  file_structure: deriveFileStructure(analysisResult),
  acceptance_criteria: deriveAcceptanceCriteria(requirementContent),
  implementation_slices: deriveSlices(requirementContent),
});

writeFile(specPath, specContent);
```

### Step 3: PRD 原文回溯扫描

> 核心机制：直接将 PRD 原文与生成的 Spec 内容比对，确保需求不被概括压缩丢失。

```typescript
// ── PRD 原文回溯扫描 ──

// Step 3.1: 将 PRD 原文按标题层级 + 列表项拆为语义段落
const prdSegments = segmentPRD(requirementContent);

// Step 3.2: 逐段检查 spec 覆盖
const coverageResults: PRDCoverageResult[] = [];

for (const segment of prdSegments) {
  const result = checkSegmentCoverage(segment, specContent);
  coverageResults.push(result);

  if (result.status === 'uncovered') {
    console.warn(`❌ PRD 未覆盖：[${segment.id}] ${segment.excerpt.substring(0, 80)}...`);
    // 自动补充到 spec 的对应章节
    appendToSpecSection(specPath, specContent, segment);
  } else if (result.status === 'partial') {
    console.warn(`⚠️ PRD 部分覆盖（缺少细节）：[${segment.id}] ${segment.excerpt.substring(0, 80)}...`);
    console.warn(`   缺失细节：${result.missingDetails.join('、')}`);
  }
}

// Step 3.3: 计算覆盖率
const totalSegments = prdSegments.length;
const coveredCount = coverageResults.filter(r => r.status === 'covered').length;
const partialCount = coverageResults.filter(r => r.status === 'partial').length;
const uncoveredCount = coverageResults.filter(r => r.status === 'uncovered').length;
const coverageRate = (coveredCount + partialCount * 0.5) / totalSegments;

console.log(`\n📊 PRD 覆盖率：${(coverageRate * 100).toFixed(1)}% (${coveredCount} 覆盖 / ${partialCount} 部分 / ${uncoveredCount} 未覆盖)`);

// Step 3.4: 覆盖率阈值检查（90%）
if (coverageRate < 0.9) {
  console.error(`❌ PRD 覆盖率 ${(coverageRate * 100).toFixed(1)}% 低于 90% 阈值，需补充后重新生成`);
  for (const r of coverageResults.filter(r => r.status !== 'covered')) {
    const seg = prdSegments.find(s => s.id === r.segmentId)!;
    console.log(`  ${r.status === 'uncovered' ? '❌' : '⚠️'} [${seg.id}] ${seg.excerpt.substring(0, 100)}`);
    if (r.missingDetails.length > 0) {
      console.log(`    缺失：${r.missingDetails.join('、')}`);
    }
  }
  // 自动修复后重新扫描
}

// Step 3.5: 持久化覆盖率报告（供 Phase 1.1 User Review 展示）
const coverageReport: PRDCoverageReport = {
  generatedAt: new Date().toISOString(),
  totalSegments,
  covered: coveredCount,
  partial: partialCount,
  uncovered: uncoveredCount,
  coverageRate,
  segments: coverageResults.map(r => {
    const seg = prdSegments.find(s => s.id === r.segmentId)!;
    return {
      ...r,
      excerpt: seg.excerpt,
      type: seg.type,
      flags: {
        hasQuantitative: seg.hasQuantitative,
        hasNegation: seg.hasNegation,
        hasLinkage: seg.hasLinkage,
        hasRefactoring: seg.hasRefactoring
      }
    };
  })
};

const reportPath = path.join(workflowDir, 'prd-spec-coverage.json');
writeFile(reportPath, JSON.stringify(coverageReport, null, 2));
console.log(`📄 覆盖率报告已保存：${reportPath}`);
```

## PRD 分段数据结构

### segmentPRD 函数

按**标题层级 + 列表项**拆分 PRD 原文为语义段落。每个段落标注高风险特征。

```typescript
interface PRDSegment {
  id: string;               // SEG-001, SEG-002, ...（覆盖率报告内部标识）
  type: 'feature' | 'rule' | 'enum' | 'formula' | 'ui_layout' | 'refactor' | 'constraint';
  excerpt: string;           // 原文片段（完整保留，不概括）
  parentHeading: string;     // 所属的标题层级路径
  keywords: string[];        // 关键名词/动词
  hasQuantitative: boolean;  // 包含精确值（数字、公式、枚举列表、"最多N个"）
  hasNegation: boolean;      // 包含否定约束（"不支持"、"不展示"、"禁用"、"不可"）
  hasLinkage: boolean;       // 包含联动描述（"联动"、"根据...拉取"、"条件展示"）
  hasRefactoring: boolean;   // 包含改造指令（"改名为"、"替换"、"更换"、"重命名"）
}

function segmentPRD(content: string): PRDSegment[] {
  const segments: PRDSegment[] = [];
  let index = 1;
  const sections = splitByHeadings(content);

  for (const section of sections) {
    const items = splitByListItems(section.body);
    if (items.length === 0) {
      segments.push(createSegment(index++, section.heading, section.body));
    } else {
      for (const item of items) {
        segments.push(createSegment(index++, section.heading, item));
      }
    }
  }
  return segments;
}

function createSegment(index: number, heading: string, text: string): PRDSegment {
  return {
    id: `SEG-${String(index).padStart(3, '0')}`,
    type: classifySegmentType(text),
    excerpt: text.trim(),
    parentHeading: heading,
    keywords: extractKeywords(text),
    hasQuantitative: /\d+|最[多少]|公式|枚举|=|\//.test(text),
    hasNegation: /不支持|不展示|禁[止用]|不可|不适用|无需|不得/.test(text),
    hasLinkage: /联动|根据.*拉取|条件.*展示|动态.*加载|选[中择]后.*展示/.test(text),
    hasRefactoring: /改[名为]|替换|更换|重命名|更改为|改为/.test(text)
  };
}
```

### checkSegmentCoverage 函数

```typescript
interface PRDCoverageResult {
  segmentId: string;
  status: 'covered' | 'partial' | 'uncovered';
  matchedSpecSections: string[];
  missingDetails: string[];
  confidence: number;
}

function checkSegmentCoverage(segment: PRDSegment, specContent: string): PRDCoverageResult {
  const result: PRDCoverageResult = {
    segmentId: segment.id,
    status: 'uncovered',
    matchedSpecSections: [],
    missingDetails: [],
    confidence: 0
  };

  // 1. 关键词匹配
  const keywordHits = segment.keywords.filter(kw => specContent.includes(kw));
  const keywordCoverage = keywordHits.length / Math.max(segment.keywords.length, 1);

  // 2. 高风险标记的强化检查
  if (segment.hasQuantitative) {
    const numbers = segment.excerpt.match(/\d+/g) || [];
    const missingNumbers = numbers.filter(n => !specContent.includes(n));
    if (missingNumbers.length > 0) {
      result.missingDetails.push(`精确值未保留：${missingNumbers.join('、')}`);
    }
  }

  if (segment.hasNegation) {
    const negations = segment.excerpt.match(/不支持.*?[。，；\n]|不展示.*?[。，；\n]|禁[止用].*?[。，；\n]/g) || [];
    for (const neg of negations) {
      const negKeyword = neg.replace(/[。，；\n]/g, '').trim();
      if (!specContent.includes(negKeyword.substring(0, 6))) {
        result.missingDetails.push(`否定约束未保留："${negKeyword}"`);
      }
    }
  }

  if (segment.hasLinkage) {
    const linkageVerbs = segment.excerpt.match(/联动|根据.*拉取|条件.*展示|动态.*加载/g) || [];
    for (const verb of linkageVerbs) {
      if (!specContent.includes(verb.substring(0, 8))) {
        result.missingDetails.push(`联动关系未保留："${verb}"`);
      }
    }
  }

  if (segment.hasRefactoring) {
    const refactorPatterns = segment.excerpt.match(/改[名为].*?[。，；\n]|替换.*?[。，；\n]/g) || [];
    for (const pattern of refactorPatterns) {
      const patternKeyword = pattern.replace(/[。，；\n]/g, '').trim();
      if (!specContent.includes(patternKeyword.substring(0, 8))) {
        result.missingDetails.push(`改造指令未保留："${patternKeyword}"`);
      }
    }
  }

  // 3. 综合判定
  if (keywordCoverage >= 0.7 && result.missingDetails.length === 0) {
    result.status = 'covered';
    result.confidence = keywordCoverage;
  } else if (keywordCoverage >= 0.3 || result.missingDetails.length <= 1) {
    result.status = 'partial';
    result.confidence = keywordCoverage * 0.7;
  } else {
    result.status = 'uncovered';
    result.confidence = keywordCoverage * 0.3;
  }

  result.matchedSpecSections = findMatchedSections(specContent, segment.keywords);
  return result;
}
```

## Spec 文档结构

> Spec 模板结构与 `core/specs/workflow-templates/spec-template.md`（v3）保持一致。

### Front Matter

```yaml
---
version: 3
requirement_source: "docs/prd.md"
created_at: "2026-04-09T10:00:00Z"
status: draft
role: spec
prd_coverage: "prd-spec-coverage.json"
---
```

### 1. Context
问题背景、目标和触发来源。

### 2. Scope
基于需求判定 in-scope / out-of-scope / blocked。

### 3. Constraints
集中列出不可协商的关键约束（字段名、条件分支、上限值等）。
**包含**：多 Agent / 工作区相关的预设目录与环境约束（来自 Phase 0.3 UX 设计工件，如有）。
**包含**：Phase 0.2 澄清结果摘要（关键决策、选定方案和未就绪依赖）。

### 4. User-facing Behavior
正常流程、异常流程、边界行为、可观察输出。
**包含**：用户操作流程图（Mermaid），从首次打开到核心操作完成的完整路径（来自 Phase 0.3 UX 设计工件）。

### 5. Architecture and Module Design
模块划分、数据模型、接口设计、技术选型、风险与权衡。

### 6. File Structure
新建、修改、测试文件清单。

### 7. Acceptance Criteria
按模块组织的验收条件和测试策略。

### 8. Implementation Slices
按可渐进交付的切片组织。

### 9. Open Questions
待确认问题。PRD 回溯扫描中标为 partial/uncovered 的段落应追加到此章节，提醒用户审查时关注。

## Spec Self-Review

Spec 生成后，必须执行一次内联自审查（非子 Agent）：

1. **PRD 原文回溯扫描** — 直接将 PRD 原文逐段与 spec 内容比对（见 Step 3），确保需求不被概括压缩丢失
2. **细节保留扫描** — 对包含精确值（`hasQuantitative`）、否定约束（`hasNegation`）、联动关系（`hasLinkage`）、改造指令（`hasRefactoring`）的 PRD 段落做强化检查
3. **覆盖率阈值** — PRD 覆盖率低于 90% 时标注警告，partial/uncovered 段落追加到 §9 供用户审查
4. **Placeholder 扫描** — 搜索 "TBD"、"TODO"、"待补充" 等占位符
5. **内部一致性** — 架构章节是否与用户行为章节一致
6. **约束完整性** — 原始需求中的硬约束是否都在 Constraints 章节出现
7. **UX 流程一致性** — 流程图中的每个步骤是否在 User-facing Behavior 有对应描述（仅当 uxDesignArtifact 存在时）
8. **页面分层合理性** — 单页面不超过 4 个独立功能模块（仅当 uxDesignArtifact 存在时）
9. **首次使用体验** — 涉及工作区/初始化概念时必须有首次使用引导描述

发现问题直接修复，无需重新审查。

> 注：此 Self-Review 与执行阶段的「Spec 合规审查（子 Agent）」是不同的机制。Self-Review 为内联自检，聚焦 spec 文档本身的完整性和一致性；执行阶段的 Spec 合规审查由独立审查协议执行，聚焦**代码实现**与 spec 的一致性。

## 强制规则

- 所有需求都必须在 Scope 章节有明确判定（in_scope / out_of_scope / blocked）
- 所有 out_of_scope 和 blocked 需求必须写明原因
- 所有硬约束（字段名、数量限制、条件分支等）必须在 Constraints 章节出现
- 禁止占位符（TBD/TODO/待补充）
- PRD 原文回溯扫描覆盖率低于 90% 时，partial/uncovered 段落必须追加到 §9，提醒用户审查
- 覆盖率报告持久化到 `prd-spec-coverage.json`，供 Phase 1.1 User Spec Review 展示
