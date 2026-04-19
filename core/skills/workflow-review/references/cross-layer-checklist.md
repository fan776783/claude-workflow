# Cross-Layer Checklist（Workflow-Review Stage 1 Advisory）

> Advisory only. 供 `SKILL.md` Stage 1 的「跨层检查」小节引用（执行流程第 5 项）。不写入 `quality_gates.*`，不消耗 Stage 1 / Stage 2 预算，不影响 pass/fail 判定。
>
> 对齐 Trellis `$check-cross-layer` 的 4 个维度，但只做 diff 启发式早期警示。Stage 2 子 Agent 会对 `代码复用` 与 `跨层完整性` 做更深判断；若 Stage 2 发现同一问题，应合并为一条，避免上下游重复。

## 如何使用

1. 输入 diff window 来自 `state.initial_head_commit..HEAD`（与 Stage 1 同源）。
2. 逐项判断是否命中 Trigger；命中则按对应节的 checklist 输出一条 advisory 记录。
3. guide 引用采用 fallback 链：项目 `.claude/knowledge/guides/<name>.md` → 仓库内置 `core/specs/guides/<name>.md` → 直接使用本文件的 checklist 文本。

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
- [ ] barrel（形如 src/\<dir\>/index.ts 或 src/\<dir\>/index.js 的再导出文件）是否需要更新导出
- [ ] 新文件放置位置是否符合 layer 约定

## D. 同层一致性

**Trigger**：diff 内 ≥ 2 个文件共享同一直接父目录

**Checklist**：

- [ ] 同概念在多文件使用时，是否共享常量 / 类型定义
- [ ] 命名风格 / 格式化 / 错误处理方式是否一致
- [ ] 本次修改是否让同目录下的文件行为更统一或更分裂

## 与 Stage 2 的去重

Stage 2 `stage2-review-checklist.md` 已覆盖：

- **代码复用** — subagent 会对照运行时 `.claude/.agent-workflow/specs/guides/code-reuse-checklist.md`
- **跨层完整性** — subagent 会对照运行时 `.claude/.agent-workflow/specs/guides/cross-layer-checklist.md`

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
```

实现时 probe 自身**不执行** grep / 修改 / 阻断动作，只负责把 checklist 追加到审查输出的独立块。
