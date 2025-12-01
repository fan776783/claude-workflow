---
description: 编写测试 - 调用 Vitest 测试专家编写或改进测试代码
allowed-tools: Task(subagent_type=vitest-tester), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(pnpm test*, pnpm coverage*)
examples:
  - /write-tests
    为用户登录组件编写单元测试
  - /write-tests
    提高路由模块的测试覆盖率
  - /write-tests
    修复失败的集成测试
---

# 编写测试

调用 Vitest 测试专家 agent，编写或改进测试代码。

**使用场景**：
- 为新功能编写单元测试或集成测试
- 审查和改进现有测试代码
- 调试失败的测试用例
- 设计测试策略和 mock 方案
- 提高测试覆盖率
- 优化测试性能和可维护性

请启动 `vitest-tester` agent，执行以下任务：

**测试目标**：{用户指定要测试的代码/功能}

**任务类型**：
- [ ] 编写新测试
- [ ] 改进现有测试
- [ ] 调试失败的测试
- [ ] 提高覆盖率
- [ ] 优化测试性能

**测试要求**：
1. 遵循 AAA 模式（Arrange-Act-Assert）
2. 覆盖正常情况、边界条件、异常情况
3. 设计合适的 mock 策略
4. 保持测试的独立性和可维护性
5. 提供清晰的测试描述

**输出格式**：
- 测试用例设计
- 完整的测试代码（TypeScript + Vitest）
- Mock 说明和策略
- 运行命令和预期结果
- 覆盖率报告

**测试框架**：Vitest
**包管理器**：pnpm
**语言**：TypeScript

**工作目录**：当前项目目录（自动识别 `process.cwd()`）
