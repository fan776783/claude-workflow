---
name: tdd
description: "Test-driven development with a red-green-refactor loop, built one vertical slice at a time. Use when user wants to build features or fix bugs with TDD, mentions 'red-green-refactor' / '测试驱动' / 'TDD' / '先写测试', or asks for integration tests. Refuses horizontal slicing (write all tests first then all code) as an anti-pattern."
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**,按其必读清单执行。
本 skill 的跳过条件:修改已有测试文件格式 / 重命名类 typo delta无需走完整 TDD。
</PRE-FLIGHT>

# Test-Driven Development

## 核心原则

**测试验证行为,穿过 public interface;不测试 implementation 细节。代码可以全换,测试不应该换。**

架构词汇用 `core/specs/shared/architecture-language.md`(Module / Interface / Seam / Depth / Adapter)。

### 好测试

integration 风格:穿过真实代码路径,经由 public API。描述系统**做什么**,不描述**怎么做**。像规范——"user can checkout with valid cart"一眼知道这条能力存在。refactor 后存活,因为它不关心内部结构。

### 坏测试

耦合到 implementation。mock 内部协作方、测私有方法、绕过 interface 用外部手段验证(比如直接查 DB 而不是走接口)。warning sign:refactor 会让测试红,但行为没变。重命名内部 function 测试就挂 = 它在测 implementation 不是行为。

## 反模式:Horizontal Slice

**不要先写所有测试,再写所有实现**。这是 horizontal slicing——把 RED 当"写所有测试",GREEN 当"写所有代码"。

产出**烂测试**:
- 批量写的测试测 _想象中的_ 行为,不是 _真实_ 行为
- 最终在测结构的**形状**(数据结构 / function signature)而非 user-facing 行为
- 对真实变化不敏感——行为坏了它还过,行为对了它反而挂
- outrun your headlights,提前对测试结构 commit,不理解 implementation

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  ...
```

**正确做法**:vertical slice via tracer bullet。一个 test → 一个 implementation → 重复。每个 test 响应你从上一轮学到的东西。刚写完代码,你最清楚哪些行为重要、怎么验证。

## workflow

### 1. 规划

用 `core/specs/shared/glossary.md` 的项目词汇命名测试和 interface,让测试可读。

动手前:
- [ ] 和用户确认 interface 要怎么变
- [ ] 和用户确认测哪些行为(按优先级)
- [ ] 找 deep module 机会(小 interface + 大 behaviour)
- [ ] 列出要测的行为(不是 implementation 步骤)
- [ ] 用户批准

问:"public interface 长什么样?哪些行为最重要?"

**测试不完所有东西**。和用户确认哪些行为最关键。重点覆盖 critical path 和复杂逻辑,不是每个 edge case。

### 2. Tracer Bullet

写**一条**测试,验证系统**一件**事:

```
RED:   写第一个行为的测试 → 失败
GREEN: 写最小代码让它过 → 通过
```

tracer bullet 证明 end-to-end 通路。

### 3. delta循环

剩下每个行为:

```
RED:   下一个测试 → 失败
GREEN: 最小代码让它过 → 通过
```

规则:
- 一次一个测试
- 只写够当前测试过的代码
- 不为未来测试提前写东西
- 测试聚焦可观察行为

### 4. Refactor

所有测试过后:
- [ ] 抽出重复
- [ ] 深化 module(把复杂度藏到简单 interface 后)
- [ ] 自然处用 SOLID
- [ ] 新代码暴露出的旧代码问题
- [ ] 每一步 refactor 后跑测试

**红灯下不要 refactor**。先到绿。

## 每轮 checklist

- [ ] 测试描述行为,不描述 implementation
- [ ] 测试只用 public interface
- [ ] refactor 不会让测试挂
- [ ] 代码是让当前测试过的最小量
- [ ] 未加猜测性特性

## 与其他 skill 的关系

- `/workflow-execute` 在执行阶段可调用本 skill 的 vertical slice 纪律
- `/fix-bug` Phase 3 写修复时应走 red-green-refactor,而不是先改代码后补测试
- `/diagnose` Phase 5 如果给出了 regression_seam,顺手进本 skill 写回归测试
