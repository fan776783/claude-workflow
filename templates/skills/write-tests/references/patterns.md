# 测试模式

## AAA 模式

每个测试遵循 Arrange-Act-Assert 结构：

```typescript
describe('UserService', () => {
  it('应该创建用户', async () => {
    // Arrange - 准备
    const userData = { name: 'John', email: 'john@example.com' }
    const mockRepo = { save: vi.fn().mockResolvedValue({ id: 1, ...userData }) }
    const service = new UserService(mockRepo)

    // Act - 执行
    const result = await service.create(userData)

    // Assert - 验证
    expect(result.id).toBe(1)
    expect(mockRepo.save).toHaveBeenCalledWith(userData)
  })
})
```

## 异步测试

### Promise

```typescript
it('应该异步返回数据', async () => {
  const data = await fetchData()
  expect(data).toBeDefined()
})
```

### 错误处理

```typescript
it('应该拒绝无效输入', async () => {
  await expect(fetchData(null)).rejects.toThrow('Invalid input')
})
```

## Mock 策略

### Mock 函数

```typescript
const mockFn = vi.fn()
  .mockReturnValue('default')
  .mockReturnValueOnce('first call')
  .mockImplementation((x) => x * 2)
```

### Mock 模块

```typescript
vi.mock('./api', () => ({
  fetchUser: vi.fn().mockResolvedValue({ id: 1, name: 'John' })
}))
```

### Spy 方法

```typescript
const spy = vi.spyOn(console, 'log')
doSomething()
expect(spy).toHaveBeenCalledWith('expected message')
spy.mockRestore()
```

### 部分 Mock

```typescript
vi.mock('./utils', async () => {
  const actual = await vi.importActual('./utils')
  return {
    ...actual,
    specificFn: vi.fn()
  }
})
```

## 测试组织

### 分组

```typescript
describe('Calculator', () => {
  describe('add', () => {
    it('应该加两个正数', () => {})
    it('应该处理负数', () => {})
  })

  describe('divide', () => {
    it('应该除两个数', () => {})
    it('应该抛出除零错误', () => {})
  })
})
```

### 共享设置

```typescript
describe('UserService', () => {
  let service: UserService
  let mockRepo: MockRepository

  beforeEach(() => {
    mockRepo = createMockRepository()
    service = new UserService(mockRepo)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })
})
```

## 边界条件

### 常见边界

```typescript
describe('validateEmail', () => {
  it.each([
    ['valid@email.com', true],
    ['invalid', false],
    ['', false],
    [null, false],
    ['a@b.c', true],
    ['very.long.email.address@subdomain.domain.com', true],
  ])('validateEmail(%s) 应该返回 %s', (input, expected) => {
    expect(validateEmail(input)).toBe(expected)
  })
})
```

### 参数化测试

```typescript
describe.each([
  { a: 1, b: 2, expected: 3 },
  { a: -1, b: 1, expected: 0 },
  { a: 0, b: 0, expected: 0 },
])('add($a, $b)', ({ a, b, expected }) => {
  it(`应该返回 ${expected}`, () => {
    expect(add(a, b)).toBe(expected)
  })
})
```

## 组件测试（React/Vue）

### React 组件

```typescript
import { render, screen, fireEvent } from '@testing-library/react'

describe('Button', () => {
  it('应该触发点击事件', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click me</Button>)

    fireEvent.click(screen.getByText('Click me'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

### Vue 组件

```typescript
import { mount } from '@vue/test-utils'

describe('Button', () => {
  it('应该触发点击事件', async () => {
    const wrapper = mount(Button, {
      props: { label: 'Click me' }
    })

    await wrapper.trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
```
