/**
 * Agent 合同 Schema
 *
 * 定义 Agent 的输入输出契约：
 * - 输入参数规范
 * - 输出格式规范
 * - 能力声明
 * - 调用约束
 */

/**
 * Agent 类型
 */
const AgentType = {
  PLANNER: 'planner',           // 规划 Agent
  CODER: 'coder',               // 编码 Agent
  REVIEWER: 'reviewer',         // 审查 Agent
  TESTER: 'tester',             // 测试 Agent
  ANALYST: 'analyst',           // 分析 Agent
  DESIGNER: 'designer'          // 设计 Agent
};

/**
 * 输出格式
 */
const OutputFormat = {
  TEXT: 'text',                 // 纯文本
  MARKDOWN: 'markdown',         // Markdown
  JSON: 'json',                 // JSON
  DIFF: 'diff',                 // Unified Diff
  CODE: 'code'                  // 代码块
};

/**
 * Agent 合同定义
 */
class AgentContract {
  constructor(options = {}) {
    this.name = options.name || '';
    this.type = options.type || AgentType.ANALYST;
    this.version = options.version || '1.0.0';
    this.description = options.description || '';

    // 输入规范
    this.inputs = options.inputs || [];

    // 输出规范
    this.outputs = options.outputs || [];

    // 能力声明
    this.capabilities = options.capabilities || [];

    // 约束条件
    this.constraints = options.constraints || [];

    // 依赖
    this.dependencies = options.dependencies || [];

    // 元数据
    this.metadata = options.metadata || {};
  }

  /**
   * 验证输入
   * @param {object} input 输入数据
   * @returns {object} 验证结果
   */
  validateInput(input) {
    const errors = [];
    const warnings = [];

    for (const spec of this.inputs) {
      const value = input[spec.name];

      // 必填检查
      if (spec.required && (value === undefined || value === null)) {
        errors.push(`Missing required input: ${spec.name}`);
        continue;
      }

      // 类型检查
      if (value !== undefined && spec.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== spec.type) {
          errors.push(`Invalid type for ${spec.name}: expected ${spec.type}, got ${actualType}`);
        }
      }

      // 枚举检查
      if (value !== undefined && spec.enum && !spec.enum.includes(value)) {
        errors.push(`Invalid value for ${spec.name}: must be one of ${spec.enum.join(', ')}`);
      }

      // 范围检查
      if (value !== undefined && spec.type === 'number') {
        if (spec.min !== undefined && value < spec.min) {
          errors.push(`Value for ${spec.name} is below minimum: ${spec.min}`);
        }
        if (spec.max !== undefined && value > spec.max) {
          errors.push(`Value for ${spec.name} exceeds maximum: ${spec.max}`);
        }
      }

      // 长度检查
      if (value !== undefined && spec.type === 'string') {
        if (spec.minLength !== undefined && value.length < spec.minLength) {
          warnings.push(`Value for ${spec.name} is shorter than recommended: ${spec.minLength}`);
        }
        if (spec.maxLength !== undefined && value.length > spec.maxLength) {
          errors.push(`Value for ${spec.name} exceeds maximum length: ${spec.maxLength}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证输出
   * @param {object} output 输出数据
   * @returns {object} 验证结果
   */
  validateOutput(output) {
    const errors = [];
    const warnings = [];

    for (const spec of this.outputs) {
      const value = output[spec.name];

      // 必填检查
      if (spec.required && (value === undefined || value === null)) {
        errors.push(`Missing required output: ${spec.name}`);
        continue;
      }

      // 格式检查
      if (value !== undefined && spec.format) {
        if (!this.validateFormat(value, spec.format)) {
          errors.push(`Invalid format for ${spec.name}: expected ${spec.format}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证格式
   */
  validateFormat(value, format) {
    switch (format) {
      case OutputFormat.JSON:
        try {
          if (typeof value === 'string') {
            JSON.parse(value);
          }
          return true;
        } catch {
          return false;
        }

      case OutputFormat.DIFF:
        return typeof value === 'string' &&
          (value.includes('---') || value.includes('+++') || value.includes('@@'));

      case OutputFormat.MARKDOWN:
        return typeof value === 'string';

      case OutputFormat.CODE:
        return typeof value === 'string';

      default:
        return true;
    }
  }

  /**
   * 转换为 JSON Schema
   */
  toJsonSchema() {
    const inputProperties = {};
    const required = [];

    for (const spec of this.inputs) {
      inputProperties[spec.name] = {
        type: spec.type || 'string',
        description: spec.description || ''
      };

      if (spec.enum) {
        inputProperties[spec.name].enum = spec.enum;
      }

      if (spec.default !== undefined) {
        inputProperties[spec.name].default = spec.default;
      }

      if (spec.required) {
        required.push(spec.name);
      }
    }

    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: this.name,
      description: this.description,
      type: 'object',
      properties: inputProperties,
      required
    };
  }

  /**
   * 转换为文档
   */
  toDocumentation() {
    const lines = [
      `# ${this.name}`,
      '',
      this.description,
      '',
      `**类型**: ${this.type}`,
      `**版本**: ${this.version}`,
      ''
    ];

    // 能力
    if (this.capabilities.length > 0) {
      lines.push('## 能力');
      lines.push('');
      for (const cap of this.capabilities) {
        lines.push(`- ${cap}`);
      }
      lines.push('');
    }

    // 输入
    if (this.inputs.length > 0) {
      lines.push('## 输入参数');
      lines.push('');
      lines.push('| 参数 | 类型 | 必填 | 说明 |');
      lines.push('|------|------|------|------|');
      for (const input of this.inputs) {
        lines.push(`| ${input.name} | ${input.type || 'string'} | ${input.required ? '是' : '否'} | ${input.description || ''} |`);
      }
      lines.push('');
    }

    // 输出
    if (this.outputs.length > 0) {
      lines.push('## 输出');
      lines.push('');
      lines.push('| 字段 | 格式 | 说明 |');
      lines.push('|------|------|------|');
      for (const output of this.outputs) {
        lines.push(`| ${output.name} | ${output.format || 'text'} | ${output.description || ''} |`);
      }
      lines.push('');
    }

    // 约束
    if (this.constraints.length > 0) {
      lines.push('## 约束条件');
      lines.push('');
      for (const constraint of this.constraints) {
        lines.push(`- ${constraint}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ========== 预定义 Agent 合同 ==========

/**
 * Planner Agent 合同
 */
const PlannerContract = new AgentContract({
  name: 'planner',
  type: AgentType.PLANNER,
  version: '1.0.0',
  description: '规划 Agent，负责分析需求并生成执行计划',

  inputs: [
    {
      name: 'requirement',
      type: 'string',
      required: true,
      description: '用户需求描述',
      minLength: 10,
      maxLength: 10000
    },
    {
      name: 'context',
      type: 'object',
      required: false,
      description: '项目上下文信息'
    },
    {
      name: 'constraints',
      type: 'array',
      required: false,
      description: '约束条件列表'
    }
  ],

  outputs: [
    {
      name: 'plan',
      format: OutputFormat.JSON,
      required: true,
      description: '执行计划'
    },
    {
      name: 'analysis',
      format: OutputFormat.MARKDOWN,
      required: true,
      description: '需求分析'
    },
    {
      name: 'risks',
      format: OutputFormat.JSON,
      required: false,
      description: '风险评估'
    }
  ],

  capabilities: [
    '需求分析与拆解',
    '复杂度评估',
    '步骤规划',
    '依赖识别',
    '风险评估'
  ],

  constraints: [
    '不执行实际代码修改',
    '输出必须是结构化的执行计划',
    '必须包含验收标准'
  ]
});

/**
 * Reviewer Agent 合同
 */
const ReviewerContract = new AgentContract({
  name: 'reviewer',
  type: AgentType.REVIEWER,
  version: '1.0.0',
  description: '审查 Agent，负责代码和方案审查',

  inputs: [
    {
      name: 'content',
      type: 'string',
      required: true,
      description: '待审查内容'
    },
    {
      name: 'type',
      type: 'string',
      required: true,
      enum: ['code', 'design', 'plan'],
      description: '审查类型'
    },
    {
      name: 'criteria',
      type: 'array',
      required: false,
      description: '审查标准'
    }
  ],

  outputs: [
    {
      name: 'score',
      format: OutputFormat.JSON,
      required: true,
      description: '评分（0-100）'
    },
    {
      name: 'findings',
      format: OutputFormat.JSON,
      required: true,
      description: '发现的问题'
    },
    {
      name: 'suggestions',
      format: OutputFormat.MARKDOWN,
      required: false,
      description: '改进建议'
    }
  ],

  capabilities: [
    '代码质量审查',
    '安全漏洞检测',
    '性能问题识别',
    '最佳实践检查',
    '架构评估'
  ],

  constraints: [
    '不执行实际代码修改',
    '必须提供具体的问题位置',
    '评分必须有依据'
  ]
});

/**
 * UI/UX Designer Agent 合同
 */
const UIDesignerContract = new AgentContract({
  name: 'ui-ux-designer',
  type: AgentType.DESIGNER,
  version: '1.0.0',
  description: 'UI/UX 设计 Agent，负责界面设计和用户体验优化',

  inputs: [
    {
      name: 'designSpec',
      type: 'object',
      required: true,
      description: '设计规范（来自 Figma 等）'
    },
    {
      name: 'targetPath',
      type: 'string',
      required: true,
      description: '目标代码路径'
    },
    {
      name: 'framework',
      type: 'string',
      required: false,
      enum: ['react', 'vue', 'angular'],
      description: '前端框架'
    }
  ],

  outputs: [
    {
      name: 'code',
      format: OutputFormat.CODE,
      required: true,
      description: '生成的 UI 代码'
    },
    {
      name: 'styles',
      format: OutputFormat.CODE,
      required: false,
      description: '样式代码'
    },
    {
      name: 'components',
      format: OutputFormat.JSON,
      required: false,
      description: '组件列表'
    }
  ],

  capabilities: [
    'Figma 设计稿解析',
    '响应式布局实现',
    '组件化设计',
    '样式系统集成',
    '可访问性优化'
  ],

  constraints: [
    '必须遵循设计规范',
    '代码必须符合框架最佳实践',
    '必须考虑响应式设计'
  ]
});

/**
 * Agent 合同注册表
 */
const contractRegistry = new Map([
  ['planner', PlannerContract],
  ['reviewer', ReviewerContract],
  ['ui-ux-designer', UIDesignerContract]
]);

/**
 * 注册 Agent 合同
 * @param {string} name Agent 名称
 * @param {AgentContract} contract 合同
 */
function registerContract(name, contract) {
  contractRegistry.set(name, contract);
}

/**
 * 获取 Agent 合同
 * @param {string} name Agent 名称
 * @returns {AgentContract|null}
 */
function getContract(name) {
  return contractRegistry.get(name) || null;
}

/**
 * 列出所有 Agent 合同
 * @returns {string[]}
 */
function listContracts() {
  return Array.from(contractRegistry.keys());
}

module.exports = {
  AgentType,
  OutputFormat,
  AgentContract,
  PlannerContract,
  ReviewerContract,
  UIDesignerContract,
  registerContract,
  getContract,
  listContracts
};
