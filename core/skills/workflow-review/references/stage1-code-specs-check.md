# Stage 1 Code Specs Check（Advisory）

> workflow-review Stage 1 的 per-change 子步。诊断语义：按 diff 文件反查 `{pkg}/{layer}/` 下的 code-spec，列出缺失 / 偏差 / 建议，**不参与 Stage 1 pass/fail 判定**。
>
> 诊断条数写入 `state.quality_gates[taskId].stage1.code_specs_check.findings_count`；是否执行写入 `performed`；`advisory: true` 固定。

## 适用范围

- 每次 `/workflow-review` 的 Stage 1 执行都跑一次本子步
- 诊断不消耗 Stage 1 / Stage 2 的 4 次共享预算
- 输出块独立于 `Issues` / `Spec Coverage Checklist`，合并到最终review报告时放在 `Code Specs Check (Advisory)` 区块

## 执行顺序（参考 SKILL.md 主workflow）

```
files = git_diff_name_only(base, HEAD)

findings = []

for file in files:
  spec = locate_code_spec(file)        # 按 {pkg}/{layer}/*.md 反查
  if spec is None:
    findings.push(missing_spec(file))
    continue
  deviation = compare_spec_to_code(spec, file)
  if deviation:
    findings.push(deviation)

render_block("Code Specs Check (Advisory)", findings)
report_cli(
  code_specs_performed = true,
  code_specs_findings = len(findings),
)
```

## 反查规则

对每个改动文件，优先用以下顺序定位 code-spec：

1. **路径映射**：`src/{pkg}/{layer}/**` → `.claude/code-specs/{pkg}/{layer}/*.md`；若仓库单包，`{pkg}` 取自 `project-config.json` 的 `project.name` 或 `package.json#name`。
2. **文件名 hint**：剔除扩展名后与 code-spec 文件名或 Spec `## 2. Signatures` 里 `File:` 字段做包含匹配。
3. **Scope glob**：code-spec `## 1. Scope / Trigger` 的 `Applies to` 字段里的 glob 显式命中。

以上任一命中即视为 "found"。都不命中视为 "no spec"。

## 输出形式

每条 finding 使用以下之一：

- `- [<file> → <relative code-spec path>]: <偏差描述> → <建议修复方式>`
- `- [<file>]: no code-spec under <pkg>/<layer>/, consider /spec-update`

无 finding 时输出：`- No findings.`（仍然要出块，表明检查已执行）

## 诊断维度

逐条对照 code-spec 的 7 段：

| 段 | 典型偏差 |
|----|---------|
| 1. Scope / Trigger | 改动文件不在 `Applies to` 声明的范围内 |
| 2. Signatures | 新增 API / 命令 / 表未在 Signatures 声明；File / Name 字段与代码实际名称不一致 |
| 3. Contracts | 请求/响应字段清单与实际实现不一致；Environment 新增 env 未登记 |
| 4. Validation & Error Matrix | 代码新增校验 / 错误码但 spec 未登记 |
| 5. Good / Base / Bad Cases | 出现新边界情形但 cases 无示例 |
| 6. Tests Required | 新增测试但未在 spec 列表中 |
| 7. Wrong vs Correct | 出现反例规避点（可选：只在显式改动时列） |

## 写入 state

通过 CLI 参数把执行结果写入：

```
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js pass <taskId> \
  --project-id {projectId} \
  --base-commit <baseCommit> --current-commit <currentCommit> \
  --from-task <fromTask> --to-task <toTask> --files-changed <n> \
  --stage1-attempts <n> --stage2-attempts <n> \
  --code-specs-performed true \
  --code-specs-findings <findings_count>
```

或在 `fail` 路径：

```
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js fail <taskId> \
  --project-id {projectId} \
  --failed-stage stage1 \
  --base-commit <baseCommit> --total-attempts <n> \
  --code-specs-performed true \
  --code-specs-findings <findings_count> \
  --last-result-json '<json>'
```

`--code-specs-performed` 默认 `true`，如因执行环境问题未跑本子步必须显式设为 `false`。

## 与 Probe E 的分工

- 本子步 = **per-file advisory 诊断**：只列缺失 / 偏差 / 建议，不阻塞。
- Probe E（§ cross-layer-checklist § E）= **infra 深度 gate**：命中关键路径且 code-spec 深度不足时升级为 Stage 1 阻塞。
- 若同一文件两处都有发现：本子步列出一次；Probe E 只在 `blocking_issues.cross_layer_depth_gap` 里登记。最终报告里不重复。
