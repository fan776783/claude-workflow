---
description: 检查工作流当前状态并推荐下一步操作
allowed-tools: Read(*)
---

# 工作流状态检查

检查当前工作流进度，并推荐下一步操作。

## 🔍 检查逻辑

### Step 1：查找并读取任务记忆文件

```bash
# 加载工具函数库
source ~/.claude/utils/workflow-helpers.sh

# 获取当前项目路径
current_path=$(pwd)

# 查找活跃工作流
workflow_dir=$(find_active_workflow "$current_path")

if [ -z "$workflow_dir" ]; then
  echo "❌ 未发现工作流任务记忆"
  echo ""
  echo "当前项目：$current_path"
  echo ""
  echo "💡 开始新的工作流："
  echo "  /workflow-start \"功能需求描述\""
  echo "  /workflow-quick-dev \"功能需求描述\""
  echo "  /workflow-fix-bug \"Bug 描述\""
  exit 0
fi

# 读取工作流记忆
memory_file="$workflow_dir/workflow-memory.json"
echo "📂 工作流目录：$workflow_dir"
echo ""
```

**注意**：工作流状态（workflow-memory.json）存储在用户级目录 `~/.claude/workflows/[project_id]/` 中，文档产物（上下文摘要、验证报告等）存储在项目目录 `.claude/` 中。

### Step 2：分析当前步骤和进度

```typescript
// 统计各种状态的步骤数量
const completedSteps = memory.steps.filter(s => s.status === 'completed');
const failedSteps = memory.steps.filter(s => s.status === 'failed');
const skippedSteps = memory.steps.filter(s => s.status === 'skipped');
const pendingSteps = memory.steps.filter(s => s.status === 'pending');

// 找到当前步骤
const currentStep = memory.steps.find(s =>
  s.status === 'in_progress' ||
  s.status === 'failed' ||
  s.status === 'pending'
);

// 计算进度百分比
const progress = Math.round((completedSteps.length + skippedSteps.length) / memory.total_steps * 100);

// 检查质量关卡状态
const qualityGateIssues = [];
for (const [gateName, gate] of Object.entries(memory.quality_gates || {})) {
  if (gate.passed === false || (gate.actual_score !== null && gate.actual_score < gate.threshold)) {
    qualityGateIssues.push({
      name: gateName,
      step_id: gate.step_id,
      score: gate.actual_score,
      threshold: gate.threshold
    });
  }
}
```

### Step 3：生成状态报告

```markdown
# 工作流状态报告

**任务名称**：{{memory.task_name}}
**复杂度**：{{memory.complexity}}
**预计耗时**：{{memory.estimated_time}}
**状态**：{{memory.status}}
**最后更新**：{{memory.updated_at}}

---

## 📊 进度概览

**总进度**：{{progress}}（{{completedSteps.length + skippedSteps.length}} / {{memory.total_steps}}）

[████████████░░░░] {{progress}}

**已完成步骤**：{{completedSteps.length}}
**已跳过步骤**：{{skippedSteps.length}}
**失败步骤**：{{failedSteps.length}}
**待执行步骤**：{{pendingSteps.length}}

---

## 📍 当前步骤

{{if currentStep}}
**步骤 {{currentStep.id}}**：{{currentStep.name}}
**所属阶段**：{{currentStep.phase}}
**状态**：{{currentStep.status}}
**预计耗时**：{{currentStep.estimated_time}}

{{if currentStep.status === 'failed'}}
⚠️ **失败原因**：{{currentStep.failure_reason}}
**上次评分**：{{currentStep.actual_score}} / {{currentStep.threshold}}
**差距**：{{currentStep.threshold - currentStep.actual_score}} 分
{{endif}}

{{else if memory.status === 'completed'}}
🎉 所有步骤已完成！
{{endif}}

---

## 📋 关键产物

{{for artifactName, artifactPath in memory.artifacts}}
{{if artifactPath}}
- ✅ {{artifactName}}：`{{artifactPath}}`
{{endif}}
{{endfor}}

---

## 🎯 质量关卡状态

{{for gateName, gate in memory.quality_gates}}
**{{gateName}}**：
- 步骤ID：{{gate.step_id}}
- 阈值：{{gate.threshold}}
- 实际评分：{{gate.actual_score || '未评分'}}
- 状态：{{gate.passed ? '✅ 通过' : (gate.actual_score ? '❌ 失败' : '⏸️ 待执行')}}
{{endfor}}

{{if qualityGateIssues.length > 0}}
⚠️ **质量关卡问题**：
{{for issue in qualityGateIssues}}
- {{issue.name}}（步骤 {{issue.step_id}}）：评分 {{issue.score}} < 阈值 {{issue.threshold}}
{{endfor}}
{{endif}}

---

## 📜 用户决策记录

{{if memory.decisions && memory.decisions.length > 0}}
{{for decision in memory.decisions}}
- **步骤 {{decision.step_id}}**（{{decision.timestamp}}）：
  - 问题：{{decision.question}}
  - 决策：{{decision.answer}}
  - 理由：{{decision.reason}}
{{endfor}}
{{else}}
无用户决策记录
{{endif}}

---

## ⚠️ 遗留问题

{{if memory.issues && memory.issues.length > 0}}
{{for issue in memory.issues}}
- **{{issue.severity}}**：{{issue.description}}（{{issue.timestamp}}）
{{endfor}}
{{else}}
无遗留问题
{{endif}}

---

## 🎯 下一步建议

{{if memory.status === 'completed'}}
### 🎉 工作流已完成
恭喜！{{memory.task_name}} 已完成全部步骤。

**最终评分**：{{calculateFinalScore(memory)}} / 100
**总耗时**：{{calculateTotalTime(memory)}}

**产物文档**：
{{for artifactName, artifactPath in memory.artifacts}}
{{if artifactPath}}
- {{artifactPath}}
{{endif}}
{{endfor}}

查看工作流总结：
\```bash
cat {{memory.artifacts.workflow_summary}}
\```

{{else if currentStep && currentStep.status === 'failed'}}
### ⚠️ 当前步骤失败
{{currentStep.name}}（步骤 {{currentStep.id}}）执行失败。

**失败原因**：{{currentStep.failure_reason}}

{{if currentStep.quality_gate}}
**质量关卡未通过**：
- 评分：{{currentStep.actual_score}} / {{currentStep.threshold}}
- 差距：{{currentStep.threshold - currentStep.actual_score}} 分

**建议操作**：
1. 根据反馈优化相关内容
2. 重新执行：`/workflow-retry-step`
{{else}}
**建议操作**：
1. 查看错误信息并修复
2. 重试：`/workflow-retry-step`
3. 或跳过（慎用）：`/workflow-skip-step`
{{endif}}

{{else if currentStep}}
### ✅ 准备就绪
当前可以继续执行下一步。

**下一步骤**：{{currentStep.name}}
**所属阶段**：{{currentStep.phase}}
**预计耗时**：{{currentStep.estimated_time}}

**执行命令**：
\```bash
/workflow-execute
\```

{{if shouldRecommendNewDialog(currentStep)}}
💡 **建议**：此步骤建议在新对话窗口中执行，避免上下文消耗。
{{endif}}

{{else}}
### ⏸️ 无待执行步骤
所有步骤都已完成或跳过，但工作流状态未标记为 completed。

请检查 workflow-memory.json 文件。
{{endif}}

---

## 🔧 常用命令

**查看技术方案**：
\```bash
cat {{state.tech_design_path}}
\```

**查看验证报告**：
\```bash
cat {{state.verification?.report_path}}
\```

**查看操作日志**：
\```bash
cat .claude/operations-log-{task_name}.md
\```

**重置工作流**（慎用）：
\```bash
# 备份当前状态
cp .claude/workflow-state.json .claude/workflow-state.backup.json

# ���除状态文件以重新开始
rm .claude/workflow-state.json
\```
```

---

## 示例输出

### 示例1：刚完成阶段1

```
# 工作流状态报告

**任务名称**：多租户权限管理
**当前阶段**：阶段1：需求分析
**状态**：✅ 已完成
**最后更新**：2025-01-18 14:30:00

---

## 📊 进度概览

| 阶段 | 状态 | 耗时 |
|------|------|------|
| ✅ 阶段1：需求分析 | 已完成 | 15分钟 |
| ⏸️ 阶段2：技术方案 | 未开始 | - |
| ⏸️ 阶段3：开发实施 | 未开始 | - |
| ⏸️ 阶段4：质量验证 | 未开始 | - |
| ⏸️ 阶段5：文档交付 | 未开始 | - |

**总进度**：1/5（20%）

---

## 📋 关键产物

- ✅ 上下文摘要：`.claude/context-summary-multi-tenant-permission.md`

---

## 🎯 下一步建议

### ✅ 准备就绪
当前阶段已完成，可以开始下一阶段。

**下一阶段**：阶段2：技术方案设计

**执行命令**：
\```bash
/workflow-phase2-design
\```

**建议**：
- 在新的对话窗口中执行，避免上下文消耗
- 确保已仔细阅读上一阶段的产物文档
- 如有疑问，可先查看上下文摘要文档
```

### 示例2：阶段2完成但评分不足

```
# 工作流状态报告

**任务名称**：多租户权限管理
**当前阶段**：阶段2：技术方案设计
**状态**：✅ 已完成
**最后更新**：2025-01-18 15:45:00

---

## 🎯 下一步建议

### ⚠️ 警告
⚠️ Codex 评分过低（75），建议先优化技术方案

### ⚠️ 需要处理
当前阶段虽已完成，但存在问题需要处理。

**问题**：⚠️ Codex 评分过低（75），建议先优化技术方案

**建议操作**：
1. 查看技术方案文档中的 Codex 审查意见
2. 根据 Codex 建议优化技术方案
3. 可选：重新调用 Codex 进行审查
4. 确认评分达到 80 分以上后再进入开发实施
```

---

## 💡 使用建议

1. **定期检查状态**：每完成一个阶段后执行此命令
2. **新对话启动**：开始新阶段前先检查状态，确认上下文
3. **问题排查**：遇到问题时检查状态，确认当前进度
4. **团队协作**：团队成员接手工作时先检查状态
