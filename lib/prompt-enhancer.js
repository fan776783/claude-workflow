/**
 * Prompt 增强
 *
 * 在工作流启动时自动增强用户需求：
 * - 需求澄清与补充
 * - 上下文注入
 * - 约束条件添加
 * - 质量标准设定
 */

/**
 * 增强策略
 */
const EnhancementStrategy = {
  CLARIFY: 'clarify',           // 澄清需求
  EXPAND: 'expand',             // 扩展细节
  CONSTRAIN: 'constrain',       // 添加约束
  CONTEXTUALIZE: 'contextualize' // 注入上下文
};

/**
 * 增强模板
 */
const enhancementTemplates = {
  // 需求澄清模板
  clarification: {
    questions: [
      '这个功能的主要用户是谁？',
      '有哪些边界情况需要考虑？',
      '是否有性能要求？',
      '是否需要兼容旧版本？',
      '有哪些安全考虑？'
    ],
    format: '## 需求澄清\n\n{questions}'
  },

  // 技术约束模板
  technicalConstraints: {
    items: [
      '遵循现有代码风格和架构模式',
      '确保向后兼容性',
      '添加适当的错误处理',
      '编写单元测试',
      '更新相关文档'
    ],
    format: '## 技术约束\n\n{items}'
  },

  // 质量标准模板
  qualityStandards: {
    items: [
      '代码覆盖率 > 80%',
      '无 ESLint 错误',
      '通过 TypeScript 类型检查',
      '性能无明显退化',
      'Codex 审查评分 ≥ 80'
    ],
    format: '## 质量标准\n\n{items}'
  }
};

/**
 * Prompt 增强器
 */
class PromptEnhancer {
  constructor(options = {}) {
    this.projectContext = options.projectContext || {};
    this.userPreferences = options.userPreferences || {};
    this.templates = { ...enhancementTemplates, ...options.templates };
  }

  /**
   * 增强用户需求
   * @param {string} originalPrompt 原始需求
   * @param {object} options 增强选项
   * @returns {object} 增强结果
   */
  enhance(originalPrompt, options = {}) {
    const strategies = options.strategies || [
      EnhancementStrategy.CONTEXTUALIZE,
      EnhancementStrategy.CONSTRAIN
    ];

    const enhancements = [];
    let enhancedPrompt = originalPrompt;

    for (const strategy of strategies) {
      const enhancement = this.applyStrategy(strategy, originalPrompt, options);
      if (enhancement) {
        enhancements.push(enhancement);
      }
    }

    // 组合增强内容
    if (enhancements.length > 0) {
      enhancedPrompt = this.combineEnhancements(originalPrompt, enhancements);
    }

    return {
      original: originalPrompt,
      enhanced: enhancedPrompt,
      enhancements,
      metadata: {
        strategies,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * 应用增强策略
   * @param {string} strategy 策略
   * @param {string} prompt 原始需求
   * @param {object} options 选项
   * @returns {object|null}
   */
  applyStrategy(strategy, prompt, options = {}) {
    switch (strategy) {
      case EnhancementStrategy.CLARIFY:
        return this.applyClarification(prompt, options);
      case EnhancementStrategy.EXPAND:
        return this.applyExpansion(prompt, options);
      case EnhancementStrategy.CONSTRAIN:
        return this.applyConstraints(prompt, options);
      case EnhancementStrategy.CONTEXTUALIZE:
        return this.applyContextualization(prompt, options);
      default:
        return null;
    }
  }

  /**
   * 应用需求澄清
   */
  applyClarification(prompt, options = {}) {
    const template = this.templates.clarification;
    const relevantQuestions = this.selectRelevantQuestions(prompt, template.questions);

    if (relevantQuestions.length === 0) {
      return null;
    }

    return {
      strategy: EnhancementStrategy.CLARIFY,
      content: relevantQuestions.map(q => `- ${q}`).join('\n'),
      questions: relevantQuestions
    };
  }

  /**
   * 应用需求扩展
   */
  applyExpansion(prompt, options = {}) {
    const expansions = [];

    // 检测是否需要扩展
    if (this.needsUserStory(prompt)) {
      expansions.push(this.generateUserStory(prompt));
    }

    if (this.needsAcceptanceCriteria(prompt)) {
      expansions.push(this.generateAcceptanceCriteria(prompt));
    }

    if (expansions.length === 0) {
      return null;
    }

    return {
      strategy: EnhancementStrategy.EXPAND,
      content: expansions.join('\n\n'),
      expansions
    };
  }

  /**
   * 应用技术约束
   */
  applyConstraints(prompt, options = {}) {
    const constraints = [];

    // 基础约束
    constraints.push(...this.templates.technicalConstraints.items);

    // 项目特定约束
    if (this.projectContext.framework) {
      constraints.push(`遵循 ${this.projectContext.framework} 最佳实践`);
    }

    if (this.projectContext.testFramework) {
      constraints.push(`使用 ${this.projectContext.testFramework} 编写测试`);
    }

    // 用户偏好约束
    if (this.userPreferences.codeStyle) {
      constraints.push(`代码风格: ${this.userPreferences.codeStyle}`);
    }

    return {
      strategy: EnhancementStrategy.CONSTRAIN,
      content: constraints.map(c => `- ${c}`).join('\n'),
      constraints
    };
  }

  /**
   * 应用上下文注入
   */
  applyContextualization(prompt, options = {}) {
    const contextItems = [];

    // 项目信息
    if (this.projectContext.name) {
      contextItems.push(`项目: ${this.projectContext.name}`);
    }

    if (this.projectContext.type) {
      contextItems.push(`类型: ${this.projectContext.type}`);
    }

    if (this.projectContext.framework) {
      contextItems.push(`框架: ${this.projectContext.framework}`);
    }

    // 相关文件提示
    if (options.relatedFiles && options.relatedFiles.length > 0) {
      contextItems.push(`相关文件: ${options.relatedFiles.join(', ')}`);
    }

    // 依赖信息
    if (options.dependencies && options.dependencies.length > 0) {
      contextItems.push(`依赖: ${options.dependencies.join(', ')}`);
    }

    if (contextItems.length === 0) {
      return null;
    }

    return {
      strategy: EnhancementStrategy.CONTEXTUALIZE,
      content: contextItems.map(c => `- ${c}`).join('\n'),
      context: contextItems
    };
  }

  /**
   * 组合增强内容
   */
  combineEnhancements(original, enhancements) {
    const sections = [`## 原始需求\n\n${original}`];

    for (const enhancement of enhancements) {
      const title = {
        [EnhancementStrategy.CLARIFY]: '## 需要澄清',
        [EnhancementStrategy.EXPAND]: '## 需求扩展',
        [EnhancementStrategy.CONSTRAIN]: '## 技术约束',
        [EnhancementStrategy.CONTEXTUALIZE]: '## 项目上下文'
      }[enhancement.strategy] || '## 补充信息';

      sections.push(`${title}\n\n${enhancement.content}`);
    }

    return sections.join('\n\n');
  }

  /**
   * 选择相关问题
   */
  selectRelevantQuestions(prompt, questions) {
    const promptLower = prompt.toLowerCase();
    const relevant = [];

    for (const question of questions) {
      // 简单的相关性检测
      if (question.includes('用户') && !promptLower.includes('用户')) {
        relevant.push(question);
      } else if (question.includes('性能') && !promptLower.includes('性能')) {
        relevant.push(question);
      } else if (question.includes('安全') && !promptLower.includes('安全')) {
        relevant.push(question);
      }
    }

    return relevant.slice(0, 3); // 最多3个问题
  }

  /**
   * 检测是否需要用户故事
   */
  needsUserStory(prompt) {
    return prompt.length < 100 && !prompt.includes('作为');
  }

  /**
   * 生成用户故事
   */
  generateUserStory(prompt) {
    return `### 用户故事\n作为 [用户角色]，我希望 ${prompt}，以便 [达成目标]。`;
  }

  /**
   * 检测是否需要验收标准
   */
  needsAcceptanceCriteria(prompt) {
    return !prompt.includes('验收') && !prompt.includes('标准');
  }

  /**
   * 生成验收标准
   */
  generateAcceptanceCriteria(prompt) {
    return `### 验收标准\n- [ ] 功能正常工作\n- [ ] 边界情况已处理\n- [ ] 测试已通过\n- [ ] 文档已更新`;
  }

  /**
   * 设置项目上下文
   */
  setProjectContext(context) {
    this.projectContext = { ...this.projectContext, ...context };
  }

  /**
   * 设置用户偏好
   */
  setUserPreferences(preferences) {
    this.userPreferences = { ...this.userPreferences, ...preferences };
  }
}

/**
 * 增强存储结构
 */
class EnhancementStorage {
  constructor() {
    this.original = '';
    this.enhanced = '';
    this.enhancements = [];
    this.metadata = {};
  }

  /**
   * 从增强结果创建
   */
  static fromResult(result) {
    const storage = new EnhancementStorage();
    storage.original = result.original;
    storage.enhanced = result.enhanced;
    storage.enhancements = result.enhancements;
    storage.metadata = result.metadata;
    return storage;
  }

  /**
   * 转换为 JSON
   */
  toJSON() {
    return {
      original: this.original,
      enhanced: this.enhanced,
      enhancements: this.enhancements,
      metadata: this.metadata
    };
  }

  /**
   * 从 JSON 恢复
   */
  static fromJSON(json) {
    const storage = new EnhancementStorage();
    storage.original = json.original || '';
    storage.enhanced = json.enhanced || '';
    storage.enhancements = json.enhancements || [];
    storage.metadata = json.metadata || {};
    return storage;
  }
}

module.exports = {
  EnhancementStrategy,
  PromptEnhancer,
  EnhancementStorage,
  enhancementTemplates
};
