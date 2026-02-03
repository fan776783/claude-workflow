# 语义代码检索查询

使用 `mcp__auggie-mcp__codebase-retrieval` 执行以下查询。

## 查询列表

### 1. 项目入口与启动流程

```
information_request: "项目的入口文件、main 函数、启动流程、应用初始化代码、中间件注册顺序"
```

**期望结果**：
- 入口文件路径（src/index.ts, main.go, app.py）
- 启动流程概述（初始化顺序、中间件注册）

### 2. API 路由与端点

```
information_request: "API 路由定义、HTTP 端点、RESTful 接口、GraphQL schema、认证中间件"
```

**期望结果**：
- 路由文件位置（app/api/, routes/, controllers/）
- 端点列表（GET /api/users, POST /api/auth/login）
- 认证方式（JWT/Session/OAuth）

### 3. 数据模型与数据库 Schema

```
information_request: "数据模型定义、数据库 schema、ORM 实体、表结构、实体关系"
```

**期望结果**：
- Model 文件位置（models/, prisma/schema.prisma）
- 核心实体（User, Product, Order）
- 关系定义（一对多、多对多）

### 4. 前端组件结构

```
information_request: "前端页面组件、可复用组件、路由配置、页面布局、状态管理"
```

**期望结果**：
- 组件目录结构（components/, pages/, app/）
- 路由配置文件
- 全局布局组件
- 状态管理方案

### 5. 核心业务逻辑

```
information_request: "核心业务逻辑、服务层、工具函数、辅助模块、业务流程"
```

**期望结果**：
- 服务层位置（services/, lib/, utils/）
- 核心业务流程（支付、订单、认证）

### 6. 测试覆盖情况

```
information_request: "单元测试、集成测试、E2E 测试文件、测试配置、测试工具"
```

**期望结果**：
- 测试目录结构（__tests__/, tests/, *_test.go）
- 测试框架（Jest, Vitest, Go test）
- 主要测试用例

### 7. UI 设计系统（figma-ui 缓存）

```
information_request: "设计系统、UI 组件库、设计 tokens、颜色变量、间距变量、字体变量、组件复用模式"
```

**期望结果**：
- 设计 Token 定义位置（tailwind.config, variables.scss, tokens.css）
- 颜色变量摘要（primary, secondary, error, success）
- 间距变量摘要（xs, sm, md, lg, xl）
- 可复用组件列表（Button, Modal, Form, Table）

**输出格式**（写入独立的 `ui-config.json` 文件）：
```json
{
  "assetsDir": "public/images",
  "cssFramework": "tailwind",
  "designTokensFile": "tailwind.config.ts",
  "designTokens": {
    "colors": { "primary": "#1890ff", "error": "#ff4d4f" },
    "spacing": { "xs": "4px", "sm": "8px", "md": "16px" },
    "typography": { "base": "14px", "lg": "16px" }
  },
  "componentsDir": "src/components",
  "existingComponents": ["Button", "Modal", "Table", "Form"],
  "generatedAt": "2026-02-03T00:00:00Z"
}
```

> 输出到 `.claude/config/ui-config.json`，与 `project-config.json` 分离。

## 执行策略

1. **并行查询**：可以并行执行多个查询提高效率
2. **结果合并**：将所有查询结果整合到 repo-context.md
3. **降级处理**：MCP 不可用时跳过，仅输出 Part 1 配置
