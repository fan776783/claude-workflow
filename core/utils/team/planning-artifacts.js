function buildTeamTasks() {
  return [
    {
      id: 'T1',
      name: 'Team planning',
      phase: 'planning',
      status: 'pending',
      depends: [],
      blocked_by: [],
      acceptance_criteria: ['生成 team spec / plan / task board'],
      critical_constraints: ['只允许显式 /team 触发', '不自动升级 /workflow'],
      files: {},
    },
    {
      id: 'T2',
      name: 'Team execution',
      phase: 'implement',
      status: 'pending',
      depends: ['T1'],
      blocked_by: [],
      acceptance_criteria: ['团队执行与汇总状态可推进'],
      critical_constraints: ['team runtime 内部管理并行', '不直接调用 dispatching-parallel-agents 作为编排器'],
      files: {},
    },
    {
      id: 'T3',
      name: 'Team verify and fix',
      phase: 'review',
      status: 'pending',
      depends: ['T2'],
      blocked_by: [],
      acceptance_criteria: ['team-verify / team-fix 状态可推进到 completed 或 failed'],
      critical_constraints: ['verify/fix loop 只回流失败边界'],
      files: {},
    },
  ]
}

function buildPlanTasksMarkdown() {
  return `## T1: Team planning
- **阶段**: planning
- **Spec 参考**: §1, §2, §5
- **Plan 参考**: P1
- **需求 ID**: R1
- **关键约束**: 只允许显式 /team 触发, 不自动升级 /workflow
- **验收项**: 生成 team spec / plan / task board
- **质量关卡**: false
- **状态**: pending
- **actions**: 生成规划工件,拆分 team 边界,记录治理约束
- **步骤**:
  - A1: 生成 team 规划工件 → 输出 spec/plan（验证：工件存在）
  - A2: 生成 team task board → 输出边界任务（验证：任务可解析）

## T2: Team execution
- **阶段**: implement
- **Spec 参考**: §5, §7, §8
- **Plan 参考**: P2
- **需求 ID**: R1
- **关键约束**: team runtime 内部管理并行, 不直接调用 dispatching-parallel-agents 作为 team 编排器
- **验收项**: 团队执行与汇总状态可推进
- **质量关卡**: false
- **状态**: pending
- **actions**: 推进 team-exec,更新 team-state,汇总结果
- **步骤**:
  - A1: 推进边界任务执行 → 输出 team-exec 状态（验证：team-state 更新）
  - A2: 汇总执行结果 → 输出 verify 输入（验证：结果可读）

## T3: Team verify and fix
- **阶段**: review
- **Spec 参考**: §7, §8
- **Plan 参考**: P3
- **需求 ID**: R1
- **关键约束**: verify/fix loop 只回流失败边界
- **验收项**: team-verify / team-fix 状态可推进到 completed 或 failed
- **质量关卡**: true
- **状态**: pending
- **actions**: quality_review,更新汇总状态
- **步骤**:
  - A1: 汇总 quality gates 与验证证据 → 输出 team-verify 结论（验证：quality_gates 可读取）
  - A2: 若失败则进入 team-fix → 输出失败边界列表（验证：fix_loop 更新）`
}

module.exports = {
  buildTeamTasks,
  buildPlanTasksMarkdown,
}
