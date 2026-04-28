# covered_by_other 图规范化与失败级联

`bug-batch` Phase 5.5 / 5.5.3 处理 `covered_by_other` 关系、以及覆盖单元失效时的级联规则。

## 1. 绑定语义

子 agent 在 Phase 5 可能返回 `covered_by_other_unit: <unit_id>`，意思是"我不用单独改代码，另一个 FixUnit 的修复会把我顺带盖掉"。主会话据此做三件事：

- 把被覆盖单元标记为 `covered_by_other`，`covered_by_unit` 指向覆盖单元
- 把被覆盖单元的缺陷（`primary_issue` + `included_issues` + `duplicate_issues`）并入覆盖单元的 `transition_set`，后续状态流转一起走
- 若覆盖单元失效，被覆盖缺陷必须回退——这一部分由第 3 节的失败级联处理

子 agent 必须**具体指名**覆盖单元，不能留空。无法指名时降级为 `root_cause_mismatch`，走人工介入。

## 2. 终点解析

进入 Phase 5.5.1 的单元级 review 之前，主会话先对所有 `covered_by_other` 单元做一次"终点解析"——把多跳覆盖链折叠成一次跳转，顺便把异常图结构降级。

### 2.1 正常情形

逐个被覆盖单元沿着 `covered_by_unit` 链走，直到遇到一个**不再是 `covered_by_other`** 的 FixUnit。这就是"终点覆盖单元"。随后：

1. 把被覆盖单元的 `transition_set` 合并到**终点**的 `transition_set`（不是中间节点）
2. 把被覆盖单元的 `covered_by_unit` 字段**重写**为终点 `unit_id`

重写之后图就变成了一层——后续级联只需判断终点状态，不用再做多跳解析。

### 2.2 异常图检测

走链过程中碰到下列任一情况，整条链都不能进入流转，必须在解析阶段降级：

- **走回头路**（自环或多单元互相覆盖）：环上节点全部降级为 `manual_intervention` + `ambiguous_empty_change`；沿 `covered_by_unit` 可达环的前缀节点降级为 `manual_intervention` + `cover_unit_failed`
- **终点不是 `completed`**（覆盖单元自己是 `manual_intervention` / `no_change_needed`，或指向一个不存在的 unit_id）：链上所有 `covered_by_other` 节点降级为 `manual_intervention` + `cover_unit_failed`

每个节点只有一个后继，沿链走到重复节点就是环，不需要完整 SCC。

### 2.3 前置快速检查

终点解析完成后，如果所有 FixUnit 都已经不是 `completed`（全部降级），直接跳过 5.5.1 和 5.5.2，进入 Phase 8 输出报告，向用户说明"本批次无可交付的修复单元"。被规范化降级的单元也会出现在 Phase 8 的人工介入列表中。

## 3. 失败级联

覆盖单元在任何阶段失效，被覆盖单元必须跟着降级——不然缺陷的最终状态会悬在"处理中"却没有任何 commit 对应它。

### 3.1 触发条件

覆盖单元出现下列任一情形即触发级联，**与失效原因无关**（任何 `manual_intervention` reason 都算，完整原因枚举见 SKILL.md）：

- 覆盖单元被标为 `manual_intervention`
- 覆盖单元从 `confirmed_units`、`commit_scope` 或最终 cherry-pick 集合中被移出
- 5.5.5 / Phase 6 / Phase 7 选择"放弃全部已物化修改"
- Phase 7 `REBUILD-CONFLICT` 选择"放弃冲突方"

### 3.2 传递性

级联是传递的。FU-A 是 FU-B 的覆盖单元，FU-B 又是 FU-C 的覆盖单元。FU-A 失效后：

1. FU-B 被降级为 `cover_unit_failed`
2. `cover_unit_failed` 本身就是 `manual_intervention` 的一种 reason，所以 FU-B 的失效又触发对 FU-C 的级联
3. 对 FU-C 重复执行一次

实现上：在整个 `covered_by_unit` 图上做闭包计算，所有传递可达的被覆盖 FixUnit 全部降级，直到不再产生新的 `cover_unit_failed`。

### 3.3 执行动作

对每个受级联影响的被覆盖 FixUnit：

1. 标记为 `manual_intervention` + `reason: cover_unit_failed`
2. 从覆盖单元的 `transition_set` 中移除本单元的缺陷
3. 回退蓝鲸缺陷状态：
   - 级联发生在 5.5.1 / 5.5.2（覆盖单元尚未流转到"处理中"）→ 缺陷保持原状
   - 级联发生在 5.5.3 之后（已流转到"处理中"）→ 缺陷状态从"处理中"回退到"待处理"，comment 注明"原计划由 FU-XXX 覆盖修复，但覆盖单元未成功交付，回退等待人工处理"
4. 在 Phase 8 汇总中列出所有因此降级的被覆盖 FixUnit 及其原覆盖单元

## 4. 与各阶段的关系

5.5.5、Phase 6、Phase 7 对覆盖单元本身的状态处理（保持"处理中" / 回退 / revert）必须严格分两步，**顺序不能换**：

- Step 1：先执行本文件的级联（处理所有依赖该覆盖单元的被覆盖 FixUnit）
- Step 2：再按该阶段规则处理覆盖单元自身

如果某阶段局部文案和本规则冲突，以本规则为准。新增任何让覆盖单元离开最终交付集合的路径时，必须在执行路径里显式调用本级联，而不是依赖触发清单。
