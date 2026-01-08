---
description: 多模型调试（Codex 后端诊断 + Gemini 前端诊断），支持 Bug 修复全流程
argument-hint: "<问题描述或工单号>"
allowed-tools: Task(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*), TaskOutput(*), AskUserQuestion(*), mcp__auggie-mcp__codebase-retrieval(*)
examples:
  - /debug "用户头像上传失败"
  - /debug "表单提交后数据未更新"
  - /debug "页面加载白屏"
  - /debug "API 返回 500 错误"
---

# 多模型调试

双模型并行诊断（Codex 后端 + Gemini 前端），支持从问题定位到修复验证的完整流程。

## 用法

`/debug <问题描述>`

## 上下文

- 问题描述: $ARGUMENTS
- Codex 专注后端/逻辑问题，Gemini 专注前端/UI 问题
- 使用 `mcp__auggie-mcp__codebase-retrieval` 检索相关代码上下文

## 你的角色

你是**调试协调员**，编排多模型诊断：
1. **Auggie** – 代码库上下文检索
2. **Codex** – 后端逻辑、算法、数据流诊断
3. **Gemini** – 前端 UI、状态管理、渲染诊断
4. **Claude (Self)** – 综合诊断、修复实施、最终验证

## 流程

### Phase 1: 上下文检索

1. 调用 `mcp__auggie-mcp__codebase-retrieval` 检索相关代码:
   - 使用自然语言描述问题
   - 获取相关文件、函数、类定义
2. 收集错误日志、堆栈信息、复现步骤
3. 识别问题涉及的模块（前端/后端/全栈）

### Phase 2: 并行诊断

**同时启动两个后台任务**（`run_in_background: true`）：

在单个消息中同时发送两个 Bash 工具调用：

```bash
# Codex 后端诊断（后台执行）
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/debugger.md

<TASK>
诊断问题: {{问题描述}}

## 上下文
{{从 Phase 1 获取的相关代码}}

## 错误信息
{{错误日志、堆栈信息}}

## 复现步骤
{{如何触发问题}}

请分析:
1. 问题的根本原因
2. 代码逻辑、数据流、异步问题
3. 可能的修复方案（至少 2 个）
4. 推荐方案及理由
5. **影响分析**: 修复可能影响的关联模块/功能
</TASK>

OUTPUT: Structured diagnostic report. No code modifications.
EOF
```

```bash
# Gemini 前端诊断（后台执行）
codeagent-wrapper --backend gemini - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/debugger.md

<TASK>
诊断问题: {{问题描述}}

## 上下文
{{从 Phase 1 获取的相关代码}}

## 错误信息
{{错误日志、堆栈信息}}

## 复现步骤
{{如何触发问题}}

请分析:
1. UI 渲染、状态管理问题
2. 组件生命周期、事件处理问题
3. 可能的修复方案（至少 2 个）
4. 推荐方案及理由
5. **影响分析**: 修复可能影响的关联组件/页面
</TASK>

OUTPUT: Structured diagnostic report. No code modifications.
EOF
```

**说明**:
- 使用 `ROLE_FILE:` 指定提示词文件路径，让子进程自己读取，避免消耗主会话 token
- 如果 ROLE_FILE 不存在，子进程会使用 TASK 中的分析要点作为诊断指引
- 降级策略：模型不可用时自动降级为单模型诊断

### Phase 3: 假设整合

使用 `TaskOutput` 收集两个模型的诊断报告，然后：

1. **交叉验证**：识别重叠和互补的假设
2. **综合分析**：
   - 一致观点（强信号）
   - 分歧点（需要权衡）
   - 互补见解
3. **筛选 Top 假设**：按可能性排序，选出最可能原因

### Phase 3.5: 影响性分析

**修复前必须完成影响性分析**：

1. **依赖链分析**：
   - 使用 `mcp__auggie-mcp__codebase-retrieval` 查询：
     - "What functions/methods call {{问题函数}}?"
     - "What modules import {{问题模块}}?"
   - 识别直接调用方和间接调用方

2. **数据流追踪**：
   - 追踪受影响变量/状态的传播路径
   - 识别共享状态（全局变量、Context、Store）
   - 检查是否存在隐式依赖

3. **测试覆盖检查**：
   ```bash
   # 检查相关测试文件
   Glob: "**/*.test.{ts,tsx,js,jsx}" 或 "**/*.spec.{ts,tsx,js,jsx}"
   Grep: 搜索测试文件中对问题函数/组件的引用
   ```

4. **回归风险评估**：
   | 风险等级 | 条件 | 处理方式 |
   |---------|------|---------|
   | 🔴 高 | 核心模块/多处调用/无测试覆盖 | 必须增加测试 |
   | 🟡 中 | 有部分调用/部分测试覆盖 | 建议增加测试 |
   | 🟢 低 | 单一调用/充分测试覆盖 | 可直接修复 |

5. **影响清单输出**：
   ```
   ## 影响性分析报告

   ### 直接影响
   - 文件: <受直接影响的文件列表>
   - 函数/组件: <受影响的函数或组件>

   ### 间接影响
   - 调用链: <调用关系图>
   - 共享状态: <可能受影响的状态>

   ### 测试覆盖
   - 现有测试: <相关测试文件>
   - 覆盖率: <是否覆盖修改点>
   - 建议: <是否需要补充测试>

   ### 风险评估
   - 等级: 🔴/🟡/🟢
   - 原因: <评估理由>
   ```

### Phase 4: 用户确认（Hard Stop）

**必须展示诊断结果并等待用户确认**：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🔍 诊断结果

### Codex 分析（后端视角）
<Codex 诊断摘要>

### Gemini 分析（前端视角）
<Gemini 诊断摘要>

### 综合诊断
**最可能原因**：<具体诊断>
**证据**：<支持证据>
**推荐修复方案**：<具体方案>

### 影响性分析
**风险等级**：🔴/🟡/🟢
**直接影响**：<受影响的文件/函数>
**间接影响**：<调用链/共享状态>
**测试覆盖**：<现有测试 / 需补充测试>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## **是否继续执行此修复方案？(Y/N)**

⚠️ **Hard Stop** - 工作流已暂停，等待您的确认。

请回复：
- **Y** 或 **是** - 继续执行修复
- **N** 或 **否** - 终止并重新分析

[立即终止回复，禁止继续执行任何操作]
```

### Phase 5: 修复与验证

**用户确认后执行**：

#### 5.1 实施修复

基于诊断结果编写修复代码：
- 遵循推荐的修复方案
- 最小化改动，避免大范围重构
- 添加修复注释（问题描述、根因、方案）
- 处理边界条件

#### 5.2 双模型审查

**并行调用 Codex + Gemini 审查修复代码**（`run_in_background: true`）：

```bash
# Codex 审查（后端/逻辑）
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/codex/reviewer.md

<TASK>
审查此修复代码：

**问题描述**: {{问题描述}}
**修复文件**: {{修改的文件列表}}
**修复方案**: {{修复方案摘要}}

## Diff 内容
{{git diff 内容}}

请评估:
1. 根因是否正确解决
2. 是否引入新 bug（回归检查）
3. 对调用方的影响
4. 边界条件处理
5. 代码质量
</TASK>

OUTPUT FORMAT (override ROLE_FILE default):
- Review comments only, NO scoring report
- Sort by P0→P3 priority (P0=Critical, P1=High, P2=Medium, P3=Low)
EOF
```

```bash
# Gemini 审查（前端/UI）- 仅涉及前端时执行
codeagent-wrapper --backend gemini - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/reviewer.md

<TASK>
审查此修复代码：

**问题描述**: {{问题描述}}
**修复文件**: {{修改的文件列表}}
**修复方案**: {{修复方案摘要}}

## Diff 内容
{{git diff 内容}}

请评估:
1. UI 一致性
2. 用户体验影响
3. 是否影响其他组件/页面
4. 可访问性
5. 性能影响
</TASK>

OUTPUT FORMAT (override ROLE_FILE default):
- Review comments only, NO scoring report
- Sort by P0→P3 priority (P0=Critical, P1=High, P2=Medium, P3=Low)
EOF
```

#### 5.3 综合审查意见

使用 `TaskOutput` 收集审查结果，确认问题解决。

## 输出格式

```markdown
## 🔍 Debug: <问题描述>

### Phase 1: 上下文检索
- 检索到 X 个相关文件
- 问题类型: [前端/后端/全栈]
- 关键文件: <文件列表>

### Phase 2: 并行诊断

#### Codex 诊断（后端视角）
<诊断内容>

#### Gemini 诊断（前端视角）
<诊断内容>

### Phase 3: 综合分析

#### 一致观点（强信号）
- <双方都认同的点>

#### 分歧点（需权衡）
| 议题 | Codex 观点 | Gemini 观点 |
|------|------------|-------------|

#### Top 假设
1. [最可能原因] - 可能性: High
2. [次可能原因] - 可能性: Medium

### Phase 3.5: 影响性分析

#### 直接影响
- 文件: <受影响文件>
- 函数/组件: <受影响函数>

#### 间接影响
- 调用链: <调用关系>
- 共享状态: <状态依赖>

#### 测试覆盖
- 现有测试: <相关测试>
- 建议: <是否需补充>

#### 风险评估
- 等级: 🔴/🟡/🟢
- 原因: <评估理由>

### Phase 4: 确认
**是否按此诊断进行修复？(Y/N)**

### Phase 5: 修复验证（用户确认后）
- 修复内容: <具体修改>
- Codex 审查: <审查结果>
- Gemini 审查: <审查结果>
- 最终状态: ✅ 已修复 / ⚠️ 需要进一步处理
```

## 问题类型检测

| 关键词 | 类型 | 主要诊断模型 |
|--------|------|--------------|
| 白屏、渲染、样式、组件、状态 | 前端 | Gemini |
| API、数据库、500、超时、权限 | 后端 | Codex |
| 全栈、页面+接口、数据不同步 | 全栈 | 并行 |

## 关键原则

1. **不假设，先验证** - 所有假设需要证据支持
2. **并行诊断** - 充分利用双模型的不同视角
3. **影响性分析** - 修复前评估回归风险，避免引入新 bug
4. **用户确认** - 修复前必须获得确认
5. **交叉审查** - 修复后双模型验证
6. **最小改动** - 优先局部修复，避免大范围重构

## 降级策略

```typescript
// 如果 Codex 不可用
if (!codexResult) {
  console.log(`⚠️ Codex 不可用，降级为 Gemini 单模型诊断`);
}

// 如果 Gemini 不可用
if (!geminiResult) {
  console.log(`⚠️ Gemini 不可用，降级为 Codex 单模型诊断`);
}

// 如果两者都不可用
if (!codexResult && !geminiResult) {
  console.log(`⚠️ 外部模型不可用，使用 Claude 直接分析`);
}
```

## 相关命令

- `/analyze` - 双模型技术分析（不修复，仅分析）
- `/diff-review` - 快速代码审查
- `/diff-review-deep` - 多模型深度代码审查
- `/write-tests` - 编写测试
