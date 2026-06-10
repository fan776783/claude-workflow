# 代码结构检索查询

按下列维度逐项检索（关键词 + 路径模式），命中后跟读关键文件取证。

## 查询列表

### 1. 项目入口与启动workflow

```
路径: **/{index,main,app,server}.{ts,js,go,py}, **/cmd/**/main.go
关键词: func main|createApp|bootstrap|app.listen|middleware|use\(
```

**期望结果**：
- 入口文件路径（src/index.ts, main.go, app.py）
- 启动workflow概述（初始化顺序、中间件注册）

### 2. API 路由与端点

```
路径: **/{routes,controllers,api,handlers}/**, **/app/api/**
关键词: router\.|app\.(get|post|put|delete)|@(Get|Post)Mapping|gin\.|http.HandleFunc|GraphQL|schema
```

**期望结果**：
- 路由文件位置（app/api/, routes/, controllers/）
- 端点列表（GET /api/users, POST /api/auth/login）
- 认证方式（JWT/Session/OAuth）

### 3. 数据模型与数据库 Schema

```
路径: **/{models,entities,schema}/**, **/prisma/schema.prisma, **/*.sql
关键词: class .*Model|@Entity|type .* struct|CREATE TABLE|@Table|belongsTo|hasMany|ForeignKey
```

**期望结果**：
- Model 文件位置（models/, prisma/schema.prisma）
- 核心实体（User, Product, Order）
- 关系定义（一对多、多对多）

### 4. 前端组件结构

```
路径: **/{components,pages,app,views}/**/*.{tsx,jsx,vue,svelte}
关键词: export default|defineComponent|createRouter|RouterProvider|useStore|createStore|Pinia|Redux
```

**期望结果**：
- 组件目录结构（components/, pages/, app/）
- 路由配置文件
- 全局布局组件
- 状态管理方案

### 5. 核心业务逻辑

```
路径: **/{services,lib,utils,domain,usecase}/**
关键词: class .*Service|func .*Service|export (async )?function|payment|order|auth
```

**期望结果**：
- 服务层位置（services/, lib/, utils/）
- 核心业务workflow（支付、订单、认证）

### 6. 测试覆盖情况

```
路径: **/__tests__/**, **/*.{test,spec}.{ts,js}, **/*_test.go, **/tests/**
关键词: describe\(|it\(|test\(|func Test|@Test|expect\(
```

**期望结果**：
- 测试目录结构（__tests__/, tests/, *_test.go）
- 测试框架（Jest, Vitest, Go test）
- 主要测试用例

### 7. UI 设计系统（figma-ui 缓存）

```
路径: **/tailwind.config.{ts,js}, **/{variables,tokens}.{scss,css}, **/theme/**
关键词: --color-|colors:|spacing:|fontFamily:|@theme|:root
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

1. **并行查询**：可并行检索多个维度提高效率
2. **结果合并**：将所有命中整合到 repo-context.md
3. **跟读取证**：对关键命中跟读确认，不仅凭文件名/关键词下结论
