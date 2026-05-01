---
name: diagnose
description: "Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → build feedback loop → hypothesise → instrument → fix → regression-test. Use when user says 'diagnose this' / 'debug this' / 产出 '怎么定位' / 'reproduce 不出来',reports a bug / throws / fails, or describes a perf regression. 不写修复代码 —— 产出根因 + 推荐修复方案,交给 /fix-bug 或 /workflow-execute 消费。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:环境级 / 第三方级偶发问题明显与项目代码无关(例如 npm install 失败、Docker 镜像拉不下来)时可跳过 code-specs。
</PRE-FLIGHT>

# Diagnose

硬 bug 的纪律。只有明确理由才能跳 Phase,默认按序走。

术语用 `core/specs/shared/glossary.md`;架构讨论用 `core/specs/shared/architecture-language.md`。

## Phase 1 — 先建反馈循环

**这是本 skill 的全部精华**。剩下都是机械动作。如果你有一个快速、确定、agent 可跑的 pass/fail 信号指向这个 bug,你会找到根因——二分、假设证伪、instrumentation 都只是消费那个信号。没有信号,盯代码再久也救不了你。

在这一步花超常比例的精力。**主动、创造性、拒绝放弃**。

### 构造反馈循环的 10 种方式(按顺序尝试)

1. **失败测试** 在能触达 bug 的任何 seam(unit / integration / e2e)
2. **curl / HTTP 脚本** 打 dev server
3. **CLI 调用** + fixture 输入,diff stdout 与已知正确快照
4. **Headless 浏览器脚本**(Playwright / Puppeteer)驱动 UI,断言 DOM / console / network
5. **回放抓到的 trace**:把真实网络请求 / payload / event log 存到磁盘,隔离地回放到 bug 代码路径
6. **一次性 harness**:spin up 系统的最小子集(一个 service,mock 依赖),用一次函数调用命中 bug 路径
7. **property / fuzz loop**:bug 是"有时输出错",跑 1000 个随机输入
8. **Bisection harness**:bug 在两个已知状态间出现(commit / 数据集 / 版本),自动化 "boot at state X, check, repeat",`git bisect run` 驱动
9. **Differential loop**:同一输入跑老版本 vs 新版本(或两套 config),diff 输出
10. **HITL bash 脚本**:最后手段。真的必须人点的话,用 `scripts/hitl-loop.template.sh` 把人变成循环的一环

建好对的反馈循环,bug 就修了 90%。

### 把循环当产品迭代

有了 _一个_ 循环后问:
- 能更快吗?(缓存 setup / 跳过无关 init / 收窄测试范围)
- 信号能更锐吗?(断言具体症状,不是"没 crash")
- 能更确定吗?(pin 时间 / seed RNG / 隔离 fs / 冻结网络)

30 秒且 flaky 的循环只比没循环好一点点。2 秒且确定的循环是 debugging 超能力。

### 非确定性 bug

目标**不是**干净复现,是**提高复现率**。loop trigger 100 次 / 并行 / 加压力 / 收窄时序窗口 / 注入 sleep。50% flake 的 bug 可调,1% 不可——把复现率往上推到可调。

### 真的建不出循环时

停下来明说。列出你试过什么。问用户要:(a) 能复现的环境访问权限,(b) 抓到的工件(HAR / log dump / core dump / 带时间戳的录屏),或 (c) 在生产加临时 instrumentation 的授权。**不要**没循环就进 Phase 2 猜。

建好你相信的循环,再进 Phase 2。

## Phase 2 — 复现

跑循环。看 bug 出来。

确认:
- [ ] 循环出的失败模式和**用户**描述的一致(不是附近另一个 bug;错 bug = 错 fix)
- [ ] 多次可复现(或非确定性 bug 复现率够调)
- [ ] 抓到了确切症状(error message / 错误输出 / 慢时延)供后面相位验证

复现不出来不进 Phase 3。

## Phase 3 — 假设

**在验证任何假设前生成 3-5 个 ranked 假设**。单假设容易锚定在第一个看起来合理的想法上。

每个假设必须**可证伪**:

> 格式:"If <X> 是因,then <改 Y> 会让 bug 消失 / <改 Z> 会让 bug 加重。"

写不出预测 → vibe,弃之。

### 假设表

| Rank | 假设 | 预测(If…then…) | 证伪成本 |
|------|------|------------------|---------|
| 1 | … | If X then Y | 低 / 中 / 高 |
| 2 | … | … | … |

**把 ranked list 发给用户再开始证伪**。用户的领域知识经常能瞬间重排("我们刚给 #3 改了 deploy"),或说出已经排除的假设。不要 block 等用户;用户 AFK 就按你的排名进。不调 AskUserQuestion,只是自然语言展示 + 邀请 "如需调整告诉我,否则我按 rank 顺序开始证伪"。

## Phase 4 — Instrument

每个 probe 对应 Phase 3 的一个具体预测。**一次只改一个变量**。

工具偏好:
1. **Debugger / REPL 断点**,环境支持就用。一个断点胜十条 log。
2. **定点 log** 打在区分假设的边界
3. **绝不**"全打日志然后 grep"

**每条 debug log 加独特前缀**(如 `[DEBUG-a4f2]`)。结束时一个 grep 就能清掉。无 tag 的 log 存活,有 tag 的 log 死掉。

**性能分支**:perf regression 时 log 常常是错的。改用:建 baseline 测量(timing harness / `performance.now()` / profiler / query plan)→ 二分。先测,再修。

## Phase 5 — 产出根因,不修代码

到这里 diagnose 就结束。产出:

```
- root_cause: <一句话 + 证据指针>
- falsified_hypotheses: [<哪些被证伪及为什么>]
- recommended_fix: <方案描述 + 影响边界>
- alternative_fixes: [<备选>]
- repro_loop: <Phase 1 最终用的循环>
- regression_seam: <有没有合适的 seam 放回归测试,没有则说明>
```

**不写修复代码**。交给:
- `/fix-bug` 消费(做 Phase 2 确认 + Phase 3 修复 + Phase 4 review)
- `/workflow-execute` 消费(如果在 workflow 里)

## Phase 6 — Cleanup

产出给下游前完成:
- [ ] 所有 `[DEBUG-...]` instrumentation 移除(grep 前缀)
- [ ] 一次性 prototype 删除或搬到明确标注的 debug 目录
- [ ] 循环本身如果值得保留(作为回归 harness),告诉下游 skill 保留路径

## 红旗清单

- "先试试改这个看看" — 没假设就动手
- "可能是这里的问题" — 模糊定位,无追踪证据
- "无预测的'可能是 X'" — vibe,不入假设表
- "只列 1-2 个假设就开始证伪" — 违反 3-5 要求,anchor 风险高
- "改了好几个地方应该能修好" — 散弹枪
- "跳过 Phase 1,直接假设" — 没反馈循环先别猜

## 与其他 skill 的关系

- `fix-bug` Phase 1 开头会建议先 `/diagnose` 建反馈循环
- `bug-batch` 内部修复协议不进入本 skill,用自己的批量分析
- 架构级 gap 识别出来 → 手动交给 `/workflow-spec` 或 `improve-codebase-architecture` 思路
