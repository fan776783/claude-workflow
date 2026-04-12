/**
 * 讨论迭代模式
 *
 * 在工作流执行过程中支持方案调整：
 * - 记录讨论历史
 * - 支持方案修订
 * - 决策追踪
 * - 与版本控制集成
 */

const { generateDecisionId } = require('./ulid');
const { atomicWriteJson, safeReadJson } = require('./atomic-write');

/**
 * 决策类型
 */
const DecisionType = {
  APPROVE: 'approve',           // 批准方案
  REJECT: 'reject',             // 拒绝方案
  MODIFY: 'modify',             // 修改方案
  DEFER: 'defer',               // 延迟决策
  ESCALATE: 'escalate',         // 升级决策
  SKIP: 'skip'                  // 跳过步骤
};

/**
 * 讨论状态
 */
const DiscussionStatus = {
  OPEN: 'open',                 // 讨论中
  RESOLVED: 'resolved',         // 已解决
  PENDING: 'pending',           // 等待响应
  CLOSED: 'closed'              // 已关闭
};

/**
 * 讨论迭代管理器
 */
class DiscussionManager {
  /**
   * @param {object} runStorage 运行记录存储实例
   * @param {object} versionControl 版本控制实例
   */
  constructor(runStorage, versionControl) {
    this.runStorage = runStorage;
    this.versionControl = versionControl;
  }

  /**
   * 开始新讨论
   * @param {string} runId 运行 ID
   * @param {object} options 讨论选项
   * @returns {Promise<object>}
   */
  async startDiscussion(runId, options = {}) {
    const discussion = {
      id: generateDecisionId(),
      runId,
      topic: options.topic || '',
      context: options.context || '',
      stepId: options.stepId,
      planId: options.planId,
      versionId: options.versionId,
      status: DiscussionStatus.OPEN,
      messages: [],
      decisions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolvedAt: null
    };

    // 添加初始消息
    if (options.initialMessage) {
      discussion.messages.push({
        role: 'system',
        content: options.initialMessage,
        timestamp: new Date().toISOString()
      });
    }

    // 保存到运行记录
    await this.runStorage.addDecision(runId, {
      type: 'discussion_started',
      discussionId: discussion.id,
      topic: discussion.topic
    });

    return discussion;
  }

  /**
   * 添加讨论消息
   * @param {object} discussion 讨论对象
   * @param {string} role 角色（user/assistant/system）
   * @param {string} content 消息内容
   * @returns {object}
   */
  addMessage(discussion, role, content) {
    const message = {
      role,
      content,
      timestamp: new Date().toISOString()
    };

    discussion.messages.push(message);
    discussion.updatedAt = new Date().toISOString();

    return message;
  }

  /**
   * 记录决策
   * @param {object} discussion 讨论对象
   * @param {string} type 决策类型
   * @param {object} options 决策选项
   * @returns {Promise<object>}
   */
  async recordDecision(discussion, type, options = {}) {
    if (!Object.values(DecisionType).includes(type)) {
      throw new Error(`Invalid decision type: ${type}`);
    }

    const decision = {
      id: generateDecisionId(),
      type,
      reason: options.reason || '',
      details: options.details || {},
      madeBy: options.madeBy || 'user',
      timestamp: new Date().toISOString()
    };

    discussion.decisions.push(decision);
    discussion.updatedAt = new Date().toISOString();

    // 根据决策类型更新讨论状态
    if (type === DecisionType.APPROVE || type === DecisionType.REJECT) {
      discussion.status = DiscussionStatus.RESOLVED;
      discussion.resolvedAt = new Date().toISOString();
    } else if (type === DecisionType.DEFER) {
      discussion.status = DiscussionStatus.PENDING;
    }

    // 保存到运行记录
    await this.runStorage.addDecision(discussion.runId, {
      type: 'decision_made',
      discussionId: discussion.id,
      decisionType: type,
      decisionId: decision.id
    });

    return decision;
  }

  /**
   * 请求方案修订
   * @param {object} discussion 讨论对象
   * @param {string} feedback 修订反馈
   * @param {object} options 选项
   * @returns {Promise<object>}
   */
  async requestRevision(discussion, feedback, options = {}) {
    // 记录修订请求
    this.addMessage(discussion, 'user', feedback);

    const decision = await this.recordDecision(discussion, DecisionType.MODIFY, {
      reason: feedback,
      details: {
        requestedChanges: options.requestedChanges || [],
        priority: options.priority || 'normal'
      },
      madeBy: 'user'
    });

    // 如果关联了版本控制，标记需要新版本
    if (discussion.planId && this.versionControl) {
      decision.requiresNewVersion = true;
    }

    return decision;
  }

  /**
   * 批准方案
   * @param {object} discussion 讨论对象
   * @param {object} options 选项
   * @returns {Promise<object>}
   */
  async approve(discussion, options = {}) {
    const decision = await this.recordDecision(discussion, DecisionType.APPROVE, {
      reason: options.reason || 'Approved',
      details: options.details || {},
      madeBy: options.madeBy || 'user'
    });

    // 如果关联了版本控制，批准当前版本
    if (discussion.planId && discussion.versionId && this.versionControl) {
      await this.versionControl.approveVersion(discussion.planId, discussion.versionId);
    }

    return decision;
  }

  /**
   * 拒绝方案
   * @param {object} discussion 讨论对象
   * @param {string} reason 拒绝原因
   * @param {object} options 选项
   * @returns {Promise<object>}
   */
  async reject(discussion, reason, options = {}) {
    return this.recordDecision(discussion, DecisionType.REJECT, {
      reason,
      details: options.details || {},
      madeBy: options.madeBy || 'user'
    });
  }

  /**
   * 跳过步骤
   * @param {object} discussion 讨论对象
   * @param {string} reason 跳过原因
   * @param {object} options 选项
   * @returns {Promise<object>}
   */
  async skip(discussion, reason, options = {}) {
    const decision = await this.recordDecision(discussion, DecisionType.SKIP, {
      reason,
      details: {
        stepId: discussion.stepId,
        riskAcknowledged: options.riskAcknowledged || false
      },
      madeBy: options.madeBy || 'user'
    });

    // 记录质量关卡绕过
    if (options.isQualityGate) {
      await this.runStorage.updateRun(discussion.runId, {
        qualityGatesBypassed: [
          ...(await this.runStorage.getRun(discussion.runId)).qualityGatesBypassed || [],
          {
            stepId: discussion.stepId,
            reason,
            timestamp: new Date().toISOString()
          }
        ]
      });
    }

    return decision;
  }

  /**
   * 关闭讨论
   * @param {object} discussion 讨论对象
   * @param {string} resolution 解决方案
   */
  closeDiscussion(discussion, resolution = '') {
    discussion.status = DiscussionStatus.CLOSED;
    discussion.resolvedAt = new Date().toISOString();
    discussion.resolution = resolution;
    discussion.updatedAt = new Date().toISOString();
  }

  /**
   * 获取讨论摘要
   * @param {object} discussion 讨论对象
   * @returns {object}
   */
  getSummary(discussion) {
    return {
      id: discussion.id,
      topic: discussion.topic,
      status: discussion.status,
      messageCount: discussion.messages.length,
      decisionCount: discussion.decisions.length,
      lastDecision: discussion.decisions.length > 0
        ? discussion.decisions[discussion.decisions.length - 1]
        : null,
      duration: discussion.resolvedAt
        ? new Date(discussion.resolvedAt) - new Date(discussion.createdAt)
        : Date.now() - new Date(discussion.createdAt).getTime()
    };
  }

  /**
   * 格式化讨论历史
   * @param {object} discussion 讨论对象
   * @returns {string}
   */
  formatHistory(discussion) {
    const lines = [
      `## 讨论: ${discussion.topic}`,
      `状态: ${discussion.status}`,
      `创建时间: ${discussion.createdAt}`,
      '',
      '### 消息历史',
      ''
    ];

    for (const msg of discussion.messages) {
      const roleLabel = {
        user: '👤 用户',
        assistant: '🤖 助手',
        system: '⚙️ 系统'
      }[msg.role] || msg.role;

      lines.push(`**${roleLabel}** (${msg.timestamp})`);
      lines.push(msg.content);
      lines.push('');
    }

    if (discussion.decisions.length > 0) {
      lines.push('### 决策记录');
      lines.push('');

      for (const dec of discussion.decisions) {
        const typeLabel = {
          [DecisionType.APPROVE]: '✅ 批准',
          [DecisionType.REJECT]: '❌ 拒绝',
          [DecisionType.MODIFY]: '📝 修改',
          [DecisionType.DEFER]: '⏸️ 延迟',
          [DecisionType.ESCALATE]: '⬆️ 升级',
          [DecisionType.SKIP]: '⏭️ 跳过'
        }[dec.type] || dec.type;

        lines.push(`- **${typeLabel}** (${dec.timestamp}): ${dec.reason}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * 迭代会话管理器
 */
class IterationSession {
  /**
   * @param {DiscussionManager} discussionManager 讨论管理器实例
   */
  constructor(discussionManager) {
    this.discussionManager = discussionManager;
    this.currentDiscussion = null;
    this.iterationCount = 0;
    this.maxIterations = 10;
  }

  /**
   * 开始迭代会话
   * @param {string} runId 运行 ID
   * @param {object} options 选项
   * @returns {Promise<object>}
   */
  async start(runId, options = {}) {
    this.currentDiscussion = await this.discussionManager.startDiscussion(runId, options);
    this.iterationCount = 0;
    return this.currentDiscussion;
  }

  /**
   * 提交用户反馈
   * @param {string} feedback 反馈内容
   * @returns {Promise<object>}
   */
  async submitFeedback(feedback) {
    if (!this.currentDiscussion) {
      throw new Error('No active discussion');
    }

    this.iterationCount++;

    if (this.iterationCount > this.maxIterations) {
      throw new Error(`Maximum iterations (${this.maxIterations}) exceeded`);
    }

    this.discussionManager.addMessage(this.currentDiscussion, 'user', feedback);

    return {
      discussion: this.currentDiscussion,
      iterationCount: this.iterationCount,
      canContinue: this.iterationCount < this.maxIterations
    };
  }

  /**
   * 提交助手响应
   * @param {string} response 响应内容
   * @returns {object}
   */
  submitResponse(response) {
    if (!this.currentDiscussion) {
      throw new Error('No active discussion');
    }

    this.discussionManager.addMessage(this.currentDiscussion, 'assistant', response);

    return this.currentDiscussion;
  }

  /**
   * 完成迭代
   * @param {string} type 决策类型
   * @param {object} options 选项
   * @returns {Promise<object>}
   */
  async complete(type, options = {}) {
    if (!this.currentDiscussion) {
      throw new Error('No active discussion');
    }

    let decision;

    switch (type) {
      case DecisionType.APPROVE:
        decision = await this.discussionManager.approve(this.currentDiscussion, options);
        break;
      case DecisionType.REJECT:
        decision = await this.discussionManager.reject(
          this.currentDiscussion,
          options.reason || 'Rejected',
          options
        );
        break;
      case DecisionType.SKIP:
        decision = await this.discussionManager.skip(
          this.currentDiscussion,
          options.reason || 'Skipped',
          options
        );
        break;
      default:
        decision = await this.discussionManager.recordDecision(
          this.currentDiscussion,
          type,
          options
        );
    }

    this.discussionManager.closeDiscussion(
      this.currentDiscussion,
      options.resolution || `Completed with ${type}`
    );

    const result = {
      discussion: this.currentDiscussion,
      decision,
      iterationCount: this.iterationCount
    };

    this.currentDiscussion = null;
    this.iterationCount = 0;

    return result;
  }

  /**
   * 获取当前状态
   * @returns {object}
   */
  getStatus() {
    return {
      hasActiveDiscussion: !!this.currentDiscussion,
      discussionId: this.currentDiscussion?.id,
      iterationCount: this.iterationCount,
      maxIterations: this.maxIterations,
      canContinue: this.iterationCount < this.maxIterations
    };
  }
}

module.exports = {
  DecisionType,
  DiscussionStatus,
  DiscussionManager,
  IterationSession
};
