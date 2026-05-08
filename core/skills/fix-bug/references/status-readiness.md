# Status Transition Readiness

缺陷 / 需求的"是否可推进到下一状态"判定规则。fix-bug、bug-batch 共用。

## 字段

- `status_transition_ready: boolean` — 本 FixUnit / IssueRecord 能否触发外部状态流转（蓝鲸 / Jira / GitHub Issues 等）

## 判定条件（全部满足才为 true）

1. **根因已确认** — `root_cause_confirmed = true`
2. **推荐方案已落地** — 对应文件已改、diff 非空、符合 Phase 2 确认的 `affected_scope`
3. **验证结果与预期一致** — `verification_summary` 明确通过（自动测试命中 / 手动验证步骤完成）
4. **review未发现阻断问题** — Codex / 当前模型review无 P0 / P1（P2 / P3 可带着走）
5. **入参有 issue_number** — 自由描述（无缺陷单）的 bug 无状态可流转，ready 永为 false
6. **未命中 manual_intervention** — 任何进入 `manual_intervention` 分支的 FixUnit ready 永为 false

## 任一条件不满足

- 输出 `status_transition_ready = false`
- 明确说明未满足的条件（如"review发现 2 个 P0 问题"）
- review P0 / P1 → 额外标记 `manual_intervention` + `reason: review_rejected`（见 `manual-intervention-reasons.md`）
- 不调用外部状态流转 API

## 流转动作

### 代码已落地但 review 未完成（"处理中"中间流转）

**此流转不依赖 `status_transition_ready = true`**。触发条件只需：
- 入参有 `issue_number`
- `root_cause_confirmed = true`
- 对应代码已落地、验证通过

运行期由具体 skill 授权（如 `core/skills/fix-bug/SKILL.md` Phase 3.3），目的是让外部 issue tracker 反映"已开始处理"。

### ready = true 时的下游流转（"待验证"等）

```bash
node <bk-skill>/cli/bk.mjs transition_issue \
  --issue_number <issue_number> \
  --target_state <target> \
  --comment "<commit_sha 已提交>"
```

**target 语义**：
- `待验证`：review通过、等待 QA / reporter 验证（fix-bug Phase 4.3.1，要求 ready=true）
- 其他：按外部系统状态机决定（默认要求 ready=true）

### 批量流转（bug-batch）

- `primary_issue` 先流转，`included_issues` 和 `duplicate_issues` 跟随
- 外部 API 不支持多选时顺序逐条调用
- 任一条失败走下面的失败处理路径

## 失败处理

| 失败类型 | 策略 |
|---|---|
| 网络 / 接口错误 | 重试 1 次，仍失败 → 记录到 `residual_risks`，workflow继续不 Hard Stop |
| 状态不允许转换 | 记录实际状态后跳过，提示"可能已被他人流转" |
| MCP / CLI 不可用 | 记录原因，提醒用户手动流转 |

## 使用方式

Skill SKILL.md 里写：

```markdown
### Phase N 状态流转就绪判断

按 `core/specs/shared/status-readiness.md § 判定条件` 评估。满足全部 6 条 → ready = true，按该文件"流转动作"执行。任一不满足 → ready = false 并按失败处理矩阵。
```

不再在每个 skill 里复写 6 条判定和失败矩阵。
