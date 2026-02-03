# 测试框架指南

根据项目技术栈选择对应的测试框架配置。

## Vitest (推荐)

**适用**：Vite 项目、现代 TypeScript 项目

### 配置

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // 或 'node'
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
```

### 命令

```bash
pnpm test              # 运行测试
pnpm test --watch      # 监听模式
pnpm test --coverage   # 覆盖率报告
pnpm test --ui         # UI 界面
```

### 特性

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock
vi.mock('./module')
vi.fn()
vi.spyOn(obj, 'method')

// 清理
vi.clearAllMocks()
vi.resetAllMocks()
vi.restoreAllMocks()
```

---

## Jest

**适用**：React 项目、Node.js 项目

### 配置

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80 },
  },
}
```

### 命令

```bash
npm test               # 运行测试
npm test -- --watch    # 监听模式
npm test -- --coverage # 覆盖率报告
```

### 特性

```typescript
import { jest } from '@jest/globals'

// Mock
jest.mock('./module')
jest.fn()
jest.spyOn(obj, 'method')

// 清理
jest.clearAllMocks()
jest.resetAllMocks()
jest.restoreAllMocks()
```

---

## Go test

**适用**：Go 项目

### 文件命名

```
foo.go      → foo_test.go
bar/baz.go  → bar/baz_test.go
```

### 基本结构

```go
package mypackage

import "testing"

func TestAdd(t *testing.T) {
    result := Add(1, 2)
    if result != 3 {
        t.Errorf("Add(1, 2) = %d; want 3", result)
    }
}

// 表驱动测试
func TestAddTable(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive", 1, 2, 3},
        {"negative", -1, 1, 0},
        {"zero", 0, 0, 0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            if got := Add(tt.a, tt.b); got != tt.expected {
                t.Errorf("Add(%d, %d) = %d; want %d", tt.a, tt.b, got, tt.expected)
            }
        })
    }
}
```

### 命令

```bash
go test ./...           # 运行所有测试
go test -v ./...        # 详细输出
go test -cover ./...    # 覆盖率
go test -race ./...     # 竞态检测
```

---

## pytest

**适用**：Python 项目

### 文件命名

```
foo.py      → test_foo.py
bar/baz.py  → bar/test_baz.py
```

### 基本结构

```python
import pytest

def test_add():
    assert add(1, 2) == 3

# 参数化
@pytest.mark.parametrize("a,b,expected", [
    (1, 2, 3),
    (-1, 1, 0),
    (0, 0, 0),
])
def test_add_parametrized(a, b, expected):
    assert add(a, b) == expected

# Fixture
@pytest.fixture
def user():
    return User(name="John")

def test_user_name(user):
    assert user.name == "John"

# Mock
def test_with_mock(mocker):
    mock_api = mocker.patch('module.api_call')
    mock_api.return_value = {'data': 'value'}
    result = function_under_test()
    assert result == 'value'
```

### 命令

```bash
pytest                  # 运行测试
pytest -v               # 详细输出
pytest --cov=src        # 覆盖率
pytest -x               # 首次失败停止
```
