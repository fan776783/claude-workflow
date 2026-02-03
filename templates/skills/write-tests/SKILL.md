---
name: write-tests
description: "测试编写专家 - 为代码编写高质量单元测试和集成测试。触发条件：用户调用 /write-tests，或请求编写测试、补充测试覆盖率、修复失败测试、设计测试策略。支持 Vitest、Jest 等主流测试框架。"
---

# 测试编写专家

为代码编写高质量、可维护的测试。

## 用法

`/write-tests [目标代码/功能描述]`

## 核心能力

- **单元测试**：为函数、类、组件编写独立测试
- **集成测试**：测试多个模块间的交互
- **Mock 策略**：设计和实现有效的 mock、stub、spy
- **异步测试**：正确处理 Promise、async/await、回调
- **测试调试**：快速定位和修复失败的测试
- **覆盖率优化**：识别未覆盖的代码路径并补充测试

## 工作流程

1. **理解代码** — 阅读要测试的代码实现，理解功能和边界
2. **设计测试用例** — 正常情况、边界条件、异常情况、特殊场景
3. **编写测试代码** — 遵循 AAA 模式，每个测试只验证一个行为
4. **实现 Mock** — 识别需要 mock 的依赖，选择合适的策略
5. **运行和验证** — 运行测试，检查覆盖率
6. **优化和重构** — 消除重复，提取工具函数

## 测试模式

**核心模式**：AAA (Arrange-Act-Assert) — 每个测试只验证一个行为

详见 [references/patterns.md](references/patterns.md)：
- AAA 模式示例与最佳实践
- 异步测试处理
- Mock/Spy/Stub 策略
- 边界条件与参数化测试
- React/Vue 组件测试

## 断言选择

| 断言 | 用途 |
|------|------|
| `toBe()` | 严格相等（===） |
| `toEqual()` | 深度相等（对象、数组） |
| `toBeNull()` / `toBeDefined()` | null/defined 检查 |
| `toBeTruthy()` / `toBeFalsy()` | 布尔值检查 |
| `toThrow()` | 异常检查 |
| `toHaveBeenCalled()` | Mock 调用检查 |

## 最佳实践

- 清晰命名：`应该 [在某种情况下] [做某事]`
- 使用 `describe` 分组，`beforeEach`/`afterEach` 管理状态
- 只 mock 外部依赖，不 mock 被测试的代码
- 在 `afterEach` 中清理：`vi.clearAllMocks()`
- 目标覆盖率 80%+，关键业务逻辑 100%

## 框架适配

根据项目检测结果自动适配：

| 框架 | 测试文件 | 运行命令 |
|------|----------|----------|
| Vitest | `*.test.ts` | `pnpm test` |
| Jest | `*.test.ts` | `npm test` |
| Go test | `*_test.go` | `go test ./...` |
| pytest | `test_*.py` | `pytest` |

详见 [references/frameworks.md](references/frameworks.md)
