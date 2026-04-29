# Impact Analysis Template

跨 skill 的影响面分析通用骨架。fix-bug Phase 2.1、bug-batch Phase 3、workflow-review 共用这份最小公约数；diff-review 的 `specs/impact-analysis.md` 保留评审专用的深度维度（不重复）。

## 何时做影响分析

- 修复 / 改动前（预先）：评估改动是否会回归其他功能
- 修复后（后验）：确认改动范围未超标
- review时（评审）：评估 finding 是否值得阻断发布

## 6 个维度

按此顺序评估，结论压缩到报告的 Impact 字段：

### 1. Blast Radius（影响半径）
- 直接改的文件 / 函数 / 类
- 直接 import / require 该改动点的上游
- 通过 contract 间接依赖的下游（API 调用、事件订阅、DB schema 依赖）

输出：`direct: [...], upstream: [...], downstream: [...]`

### 2. Regression Surface（回归面）
- 已有测试命中改动点的集合（`grep` 测试文件里的符号）
- 没有测试覆盖但逻辑分支受影响的点
- 手工验证必须覆盖的 happy path / error path

输出：`covered_by_tests: [...], needs_manual_test: [...]`

### 3. Contract Changes（contract变化）
- API 签名（参数 / 返回类型 / error 语义）
- DB schema（列 / 索引 / 约束）
- 事件 / 消息队列 payload 结构
- 配置 key / env var

输出：`breaking: [...], additive: [...], none`

### 4. State & Persistence（状态 / 持久化）
- 是否引入新的共享状态（cache / session / global）
- 是否改变现有状态的读写顺序 / 生命周期
- 是否触发 migration（数据 / schema）

输出：`new_state: [...], mutations: [...], migrations: [...]`

### 5. Ordering & Concurrency（时序 / 并发）
- 是否依赖特定调用顺序
- 是否在并发路径上（请求 / 消息 / 定时任务）
- 锁 / 事务 / retry 是否正确

输出：单句结论 "safe under concurrent access" / "requires <X> ordering" / "unchanged"

### 6. Deployment & Backward Compatibility（部署 / 向后兼容）
- 是否影响滚动升级（老版本 / 新版本共存时的行为）
- 是否要求特定部署顺序（DB 先 / 服务后）
- 是否需要 feature flag / dark launch

输出：`deploy_order: [...], requires_flag: bool, rollback_path: <...>`

## 严重性映射

全部 6 个维度综合评估后，给改动 / finding 一个 severity。这里是**初判**；最终 severity 由下游 skill 的 calibration 规则决定（见 diff-review report-schema.md）。

| Severity | 含义 |
|---|---|
| 高 | Blast Radius 跨module / Contract breaking / 数据迁移风险 / 并发敏感 |
| 中 | 跨文件但限于同module / Contract additive / 测试覆盖不足 |
| 低 | 局部改动 / 测试充分 / contract不变 |

## 最低要求（按场景）

| 场景 | 必须执行的维度 |
|---|---|
| 最终进入报告的 P0 / P1 finding | 全部 6 个 |
| 声称跨module的 P2 finding | 1, 2, 3 |
| 局部 P2 / P3 finding | 1, 2（可轻量化，一句话说明） |
| fix-bug / bug-batch 修复前 | 1, 2, 3, 6 |
| workflow-review Stage 1 | 1, 2, 3 |

## 使用方式

Skill SKILL.md 里写：

```markdown
### Phase N 影响分析

按 `core/specs/shared/impact-analysis-template.md § 6 个维度` 评估，按"最低要求"决定深度。结论放进 <目标字段>。
```

复用本文件时，skill 专属维度（如 diff-review 的 "Verification Coverage"）在各自 specs/ 里补充，不回写本文件。
