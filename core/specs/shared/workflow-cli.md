# Workflow CLI 路径约定

所有 `workflow-*` skill 调用的 CLI 都在固定公共路径下,**`npm install` 后始终存在**,不做动态解析:

```
~/.agents/agent-workflow/core/utils/workflow/
├── workflow_cli.js         # planning + execution 状态机的唯一写入口
├── execution_sequencer.js  # 治理决策、retry、skip
├── quality_review.js       # workflow-review 用的 stage1/stage2 写入
└── task_parser.js          # 单 task 解析
```

CLI 调用统一用完整路径写命令,不要引入未导出的 shell 别名。

## CLI 写入契约

`workflow_cli.js` 是 planning 与 execution 状态机的**唯一写入口**。绕过它手写 spec / plan / state.json 会让 `workflow-state.json` 缺失,下一会话无法恢复。`init` 子命令仅执行期自愈(状态丢失重建),规划期禁用。

`spec-review --choice` 仅接受 5 个 canonical 字符串(精确匹配,来自 `planning_gates.js`):

| canonical 字符串 | 含义 |
|---|---|
| `Spec 正确，生成 Plan` | approve,生成 plan.md 骨架并推到 `planned` |
| `Spec 正确，继续` | approve,继续 workflow |
| `需要修改 Spec` | 回到 spec 扩写(含设计修订) |
| `缺少需求细节` | 回到 spec 扩写,保留需求细节 |
| `需要拆分范围` | 拒绝,状态回 `idle` |

**禁止把用户原话直接塞给 `--choice`**,必须先归一化为以上字符串之一。
