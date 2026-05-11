---
name: bug-batch
description: "批量修缺陷——从蓝鲸项目管理平台一次性拉一批 Bug，先做全量分析找出重复和共享根因再成组修，避免逐条打补丁。适合清积压、集中处理同一module多个相关问题，或需要统一验证一组接口改动。项目 ID 从 project-config.json 的 project.bkProjectId 读取。"
---

<CONTEXT>
Phase 3 开始前 Read 每个涉及 layer 的 `.claude/code-specs/{pkg}/{layer}/index.md` + `core/specs/shared/glossary.md`。
</CONTEXT>

# 批量缺陷修复

先分析全部缺陷，再按修复单元顺序执行。不要在缺少关系判断时直接逐条修复。

## 用法

```bash
/bug-batch                                        # 使用保存的经办人
/bug-batch <operator_user>                        # 显式指定经办人（并更新配置）
/bug-batch fanjj --state 待处理 --priority HIGH
```

参数：`operator_user`（公司邮箱 `@` 前部分）、`--state`（默认 `待处理`）、`--priority`（默认全部）。

## 前置条件

- `.claude/config/project-config.json` 的 `project.bkProjectId` 必须存在；为空时提示 `/scan` 后终止。
- 经办人解析顺序：CLI 参数 > `~/.claude/agent-workflow/config.json` 的 `bugBatch.operatorUser` > 首次交互询问并回写。

## 核心概念

### RelationType
- `duplicate_of`：重复缺陷，不单独编码
- `same_root_cause`：共享根因，合并单元
- `coupled_with`：强耦合，拆开会冲突
- `blocked_by`：依赖其他缺陷或单元先完成
- `needs_manual_judgement`：关系不明，人工裁决

## 执行纪律

两个 Hard Stop 调用 `AskUserQuestion`，输出后停止所有操作等用户明确输入：
- `[HARD-STOP:CONFIRM-PLAN]` — Phase 4 编排确认
- `[HARD-STOP:CONFIRM-COMMIT]` — Phase 7 提交确认

其他异常（跨单元冲突、物化失败、重建冲突等）临时调 AskUserQuestion 展示问题和选项，不需预定义命名。

## 按需读取的参考文件

- `references/analysis-and-planning.md`：分析视图、关系矩阵、FixUnit 编排示例、Task 树预览
- `references/status-and-reporting.md`：review 汇总、确认卡点、汇总报告模板
- `references/fix-protocol.md`：subagent 输入/输出 contract

## 执行 workflow

```text
Phase 0: 读项目配置
Phase 1: 拉缺陷清单
Phase 2: 获取详情并标准化
Phase 3: 全量分析（根因 / 重复 / 耦合 / 依赖）
Phase 4: 编排 FixUnit（Hard Stop）
Phase 5: 分层并行修复
Phase 6: Review + 物化 + 流转
Phase 7: 全量确认 + Commit + 流转到"待验证"（Hard Stop）
Phase 8: 汇总报告
```

## Phase 0: 读项目配置

1. 读 `.claude/config/project-config.json`，取 `project.bkProjectId`；空则提示 `/scan` 后终止。
2. 解析 `operator_user`：CLI > config > 交互询问后回写。用户误填邮箱时自动截取 `@` 前部分。

## Phase 1: 拉缺陷清单

`bk list_issues` 按 `operator_user` / `--state` / `--priority` 过滤。缺陷量大分页拉；进 Phase 3 前必须有完整视图。无匹配直接终止。

## Phase 2: 标准化

对每个缺陷并行 `bk get_issue`（~10 个一组）提取标题 / 描述 / 复现 / 优先级 / 状态 / 截图 / 日志 / module / 接口 / 错误码。补充 `symptom_summary` / `entry_point` / `module_hint` / `suspected_root_cause`。

## Phase 3: 全量分析

**禁止开始编码。**

### 根因初判 + 代码定位验证

每个 issue：

**Step A — 假设生成**：基于描述 / 复现 / 日志 / 截图推断根因候选（1-3 个）。

**Step B — 代码定位验证**：对每个假设打开候选文件，定位具体函数/行：

| 结果 | confidence | 后续 |
|------|-----------|------|
| 代码中确实存在问题点，逻辑可解释症状 | `high` | 作为 confirmed location |
| 能定位到可疑区域但无法 100% 确认 | `medium` | 标注候选，Phase 5 复核加强 |
| 描述模糊 / 代码中无法对应 | `low` | 降级为 `needs_manual_judgement` |

判定纪律：
- high = 已在代码中看到问题点并能解释症状。没打开文件 → 不是 high。
- issue 描述只有模糊表述（无复现/日志/截图）→ 天花板 medium，除非存在一眼可见的 bug。

对 medium/low 的 issue，降级前基于同批次线索、代码上下文、截图中 URL/组件/报错尝试提升 confidence。穷尽仍无法定位 → 保持原级别，记录 `clarification_needed`（问什么 + 为什么需要）。

每个 issue 输出：`root_cause_confidence` / `root_cause_evidence` / `alternative_hypotheses` / `clarification_needed`。

### Code Specs 对照

按 `module_hint` 定位 `.claude/code-specs/{pkg}/{layer}/index.md`，命中 Common Mistake → 附 `spec_hint`。`.claude/code-specs/` 不存在整体跳过。

### 关系识别

按 RelationType 定义识别。`needs_manual_judgement` 禁止自动合并。分析视图 / 关系矩阵模板见 `references/analysis-and-planning.md`。

## Phase 4: 编排 FixUnit

按关系生成 FixUnit：
- `duplicate_of` → 归并到主单元
- `same_root_cause` / `coupled_with` → 按最小改动合并
- `blocked_by` → 表达为 `blocked_by_units`
- `needs_manual_judgement` → 独立单元，请求裁决

confidence 在编排中的作用：
- 全 `high` → 正常执行
- 含 `medium` → Phase 5 subagent 根因复核加强
- 含 `low` → 必须为 `needs_manual_judgement`，不进 Phase 5

全部不可执行时（全 `needs_manual_judgement`）→ Hard Stop 说明"本批次信息不足"，用户补充后重回 Phase 3 或终止。

### `[HARD-STOP:CONFIRM-PLAN]`

展示编排结果（模板见 `references/analysis-and-planning.md`）+ 批量澄清区（有 `clarification_needed` 时）。调用 AskUserQuestion，options：
- `confirm_plan` — 进 Phase 5
- `revise_plan` — 按反馈重排
- `reduce_scope` — 缩小缺陷集合重回 Phase 3
- `provide_info` — 用户补充模糊缺陷信息，可执行单元先行

## Phase 5: 分层并行修复

**不调用 fix-bug**。用内部修复协议（`references/fix-protocol.md`）避免嵌套 Hard Stop。

### 拓扑分层

```text
Layer 0: 无 blocked_by_units（可立即并行）
Layer 1: 仅依赖 Layer 0
Layer N: 依赖 Layer 0..N-1
```

### worktree 隔离

同层 2+ 且无文件交集 → 各 worktree 并行；有交集 → 降级串行；同层 1 个 → 主工作树。

路径：`<repo_root>/../bug-batch-worktrees/<unit_id>`；分支 `fix/<unit_id>`。

### subagent 执行

输入/输出 contract 见 `references/fix-protocol.md`。

### 结果判定

- 改了文件 + 根因确认 → `completed`
- 根因已被批次外修复 → `no_change_needed`
- 被本批次其他 FixUnit 覆盖 → `covered_by_other`（必须指名 unit_id）
- 其他（root_cause_mismatch / 验证失败 / 超范围）→ `manual_intervention`

层间推进：上游全 completed → 下游解阻；上游有 manual_intervention → 下游保 blocked。

## Phase 6: Review + 物化 + 流转

covered_by_other 单元：缺陷并入覆盖单元一起流转。覆盖单元失效（标 manual_intervention / 从提交集合移除 / 物化失败，均视为失效）→ 被覆盖单元标 manual_intervention，缺陷回退"待处理"。级联传递执行，直到无新的回退产生。

### 单元级 review

对 completed 单元逐个 review diff（主会话直接审，不调 codex）：根因是否落到 files_changed；是否最小改动；验证是否覆盖 validation_scope。

P0/P1 问题 → 标 `manual_intervention` + `review_rejected`。

顺带定档 `code_specs_impact`（四档，供 Phase 8 归纳）。

### 物化到协调分支

通过 review 的 FixUnit 逐个 commit 到协调分支：
- 首个单元物化前记录 `pre_bug_batch_base` = 协调分支当前 HEAD（仅记录一次，后续不覆盖）
- 每个 FixUnit 独立 commit，message 前缀 `[bug-batch-stage] <unit_id>:`
- worktree 执行的优先 cherry-pick；冲突时降级 patch

物化失败 → `manual_intervention` + 触发覆盖级联。

### 即时流转到"处理中"

物化成功 + files_changed 非空 → 流转覆盖缺陷到"处理中"。按 `../fix-bug/references/status-readiness.md` 调用。

### 跨单元交叉影响

已物化单元 ≥ 2 时，检测文件交集 / 共享依赖 / 接口兼容性 / 回归风险。协调分支跑项目级测试。

- 无交叉 → Phase 7
- 兼容性问题 → 标 `manual_intervention`，从提交集合移除
- 严重冲突 → AskUserQuestion 让用户选择处理方式

review 汇总模板见 `references/status-and-reporting.md`。

## Phase 7: 全量确认 + Commit + 流转

### 全量确认

展示汇总（模板 `references/status-and-reporting.md`）。

**Happy path**：全 `completed` + 无未修复 P0/P1 → 跳过 Hard Stop，直接进入重建。

**`[HARD-STOP:CONFIRM-COMMIT]`**：存在 manual_intervention / no_change_needed / covered_by_other，或有未修 P0/P1 → 展示后等用户确认。用户可对个别 FixUnit 选 discard / keep_code_no_commit / user_will_handle。被拒单元从提交集合移除（先执行覆盖级联）。

### 提交 Commit

从 `pre_bug_batch_base` 重建（不 revert，避免破坏隐性依赖）：

1. 备份协调分支到 `refs/backup/bug-batch-<timestamp>`
2. 从 `pre_bug_batch_base` 拉临时分支
3. 按 materialization_order cherry-pick 确认单元（冲突时 AskUserQuestion）
4. squash 为单一 commit：`fix: <issue_numbers> 修复了 <摘要>`
5. 更新协调分支指向重建结果
6. 清理临时分支

### 流转到"待验证"

Commit 完成后，实际入 commit 的缺陷批量流转到"待验证"。

## Phase 8: 汇总报告

输出：修复单元统计 / FixUnit 视图 / Issue 视图 / 失败项 / 阻塞项。模板见 `references/status-and-reporting.md`。

### Code Specs 归纳

消费本批次 `code_specs_impact`：
- 同一文件被 2+ FixUnit 标 `spec_gap` → 建议 `/spec-update` 归纳
- 同一段落 2+ `spec_violation` → 建议审视执行机制
- 单发不升级

`.claude/code-specs/` 不存在整体跳过。
