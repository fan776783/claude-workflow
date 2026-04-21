# Cross-Layer Checklist（Workflow-Review Stage 1）

> 供 `SKILL.md` Stage 1 的「跨层检查」小节引用（执行流程第 6–7 项）。文件包含两类 probe，语义不同：
>
> - **§ A–D**：advisory probe。不写入 `quality_gates.*`，不消耗 Stage 1 / Stage 2 预算，不影响 pass/fail 判定。
> - **§ E**：infra 深度 gate，**阻塞**。命中即走 `quality_review.js fail --cross-layer-depth-gap true`，会写 `quality_gates.*` 并让 Stage 1 失败。
>
> Probe E 依赖 Code Specs Check（执行流程第 5 项）产出的 code-spec 映射，必须在其之后执行。
>
> A–D 共 4 个维度，只做 diff 启发式早期警示。Stage 2 子 Agent 会对 `代码复用` 与 `跨层完整性` 做更深判断；若 Stage 2 发现同一问题，应合并为一条，避免上下游重复。

## 如何使用

1. 输入 diff window 来自 `state.initial_head_commit..HEAD`（与 Stage 1 同源）。
2. 逐项判断是否命中 Trigger；命中则按对应节的 checklist 输出一条 advisory 记录。
3. guide 引用采用 fallback 链：项目 `.claude/code-specs/guides/<name>.md` → 仓库内置 `core/specs/guides/<name>.md` → 直接使用本文件的 checklist 文本。

## A. 数据流（3+ layers）

**Trigger**：diff 文件命中 ≥ 3 个下列层目录

- `api` / `routes` / `handlers` / `controllers`
- `service` / `lib` / `core` / `domain`
- `db` / `models` / `repositories` / `schema`
- `components` / `views` / `templates` / `pages`
- `utils` / `helpers` / `common`

**Checklist**：

- [ ] 读路径：DB → Service → API → UI 各层类型与字段映射是否一致
- [ ] 写路径：UI → API → Service → DB 错误传播是否到位
- [ ] Loading / pending 状态在每一层是否都有处理
- [ ] 跨层 type / schema 是否共享定义（避免字段名漂移）

**Points to**：项目级 `guides/cross-layer-checklist.md`（bootstrap 不保证具体 guide body 是否已填充），fallback 到仓库内置 `core/specs/guides/cross-layer-checklist.md`

## B. 代码复用

**Trigger**（任一满足）：

- diff 触及 `src/constants/**`
- diff 新增行中出现 ≥ 3 次相同字面量（字符串或数字常量）

**Checklist**：

- [ ] 同值常量是否散落在多处？是否应抽成共享常量
- [ ] 本次批量修改后，`grep` 原值是否还有残留
- [ ] 新建 util 前是否搜过同名 / 同义函数
- [ ] 相似 pattern 是否已有现成实现可复用

**Points to**：项目级 `guides/code-reuse-checklist.md`，fallback 到仓库内置 `core/specs/guides/code-reuse-checklist.md`

## C. Import 路径

**Trigger**：diff window 内含新增源文件（非配置 / 文档）

**Checklist**：

- [ ] 相对 import vs 绝对 import 的风格是否与邻近文件一致
- [ ] 是否引入循环依赖
- [ ] barrel（re-export index）是否需要更新导出
- [ ] 新文件放置位置是否符合 layer 约定

## D. 同层一致性

**Trigger**：diff 内 ≥ 2 个文件共享同一直接父目录

**Checklist**：

- [ ] 同概念在多文件使用时，是否共享常量 / 类型定义
- [ ] 命名风格 / 格式化 / 错误处理方式是否一致
- [ ] 本次修改是否让同目录下的文件行为更统一或更分裂

## E. Infra / Cross-Layer 深度 Gate（阻塞）

**Trigger（AND）**：

1. 以下任一命中：
   - § A（数据流 ≥ 3 层）命中
   - diff 文件命中 infra 关键路径（`src/api/**`、`src/routes/**`、`src/controllers/**`、`src/services/**`、`src/migrations/**`、`migrations/**`、`db/**`、`schema/**`、`prisma/**`、`auth/**`、`security/**`、`middleware/**` 等；清单以 `core/utils/workflow/role_injection.js::INFRA_PATH_PATTERNS` 为准）
   - § D 命中且其中任一文件匹配 infra glob
2. 关联 code-spec **存在**但 7 段里 `## 4. Validation & Error Matrix` / `## 5. Good / Base / Bad Cases` / `## 6. Tests Required` 任一缺失或只剩占位符
   - 关联 code-spec **不存在**时不升级为阻塞，只在 Stage 1 Code Specs Check 里按 advisory 记录；避免把"没写 spec"和"改了关键路径"叠加惩罚

**Checklist**：

- [ ] 枚举命中的 infra 文件清单
- [ ] 列出关联 code-spec（可能多份）
- [ ] 对每份 spec 逐段核对 7 段是否达标；缺失段名要具体
- [ ] 给用户明确修复路径：`/spec-update` 补齐 → 重跑 `/workflow-review`

**阻塞行为**：

- 调用 `quality_review.js fail --failed-stage stage1 --cross-layer-depth-gap true` 并提供：
  - `--cross-layer-files <逗号分隔>`：命中 infra 路径的文件
  - `--cross-layer-specs <逗号分隔>`：关联 code-spec 相对路径
  - `--cross-layer-missing-sections <逗号分隔>`：缺失段名
  - `--cross-layer-description <text>`：可选的额外说明
- CLI 会把字段写入 `state.quality_gates[taskId].stage1.cross_layer_depth_gap`，并把一条 `type: "cross_layer_depth_gap"` 条目合并到 `blocking_issues`
- Stage 1 pass 路径**禁止**出现 `cross_layer_depth_gap=true` 的参数；Probe E 命中等价于必须走 fail 分支

**示例 CLI 调用**：

```
node ~/.agents/agent-workflow/core/utils/workflow/quality_review.js fail T3 \
  --project-id {projectId} \
  --failed-stage stage1 \
  --base-commit <baseCommit> --total-attempts 2 \
  --code-specs-performed true --code-specs-findings 1 \
  --cross-layer-depth-gap true \
  --cross-layer-files "src/api/export.ts,src/migrations/20260419_add_export.sql" \
  --cross-layer-specs "my-pkg/backend/export-api.md" \
  --cross-layer-missing-sections "Validation & Error Matrix,Tests Required" \
  --last-result-json '{}'
```

## 与 Stage 2 的去重

Stage 2 `stage2-review-checklist.md` 已覆盖：

- **代码复用** — 子 Agent 会对照运行时 `.claude/.agent-workflow/specs/guides/code-reuse-checklist.md`
- **跨层完整性** — 子 Agent 会对照运行时 `.claude/.agent-workflow/specs/guides/cross-layer-checklist.md`

Stage 1 的 probe 是**更便宜的早期警示**；Stage 2 的判断权威更高。若同一问题两者都命中，以 Stage 2 的详细判定为准，在最终报告里合并为一条。

## 调用语义（面向 SKILL.md 实现）

Stage 1 主任务执行时按以下伪代码串接：

```text
files = git_diff_name_only(base, HEAD)
diff  = git_diff(base, HEAD)

advisory = []

if count_layers(files) >= 3:
  advisory.push(section="A 数据流", checklist_from="§A")

if touches(files, "src/constants/**") or repeated_literal(diff, min=3):
  advisory.push(section="B 代码复用", checklist_from="§B")

if any_new_source_file(files):
  advisory.push(section="C Import 路径", checklist_from="§C")

if shared_parent_dir_count(files, min=2):
  advisory.push(section="D 同层一致性", checklist_from="§D")

render_block("Cross-Layer (Advisory)", advisory)

# Probe E 单独判断：只有命中且 code-spec 深度不足时才阻塞
infra = classifyInfraDepth(files)   # role_injection.js
if infra.infra and related_specs_exist(files) and missing_sections_in_specs(files):
  quality_review_fail(
    failed_stage="stage1",
    cross_layer_depth_gap=true,
    files=infra.infraFiles,
    specs=related_specs,
    missing_sections=sections,
  )
```

A/B/C/D probe 自身**不执行** grep / 修改 / 阻断动作，只负责把 checklist 追加到审查输出的独立块。Probe E 是唯一会写 `blocking_issues` 的跨层判断。
