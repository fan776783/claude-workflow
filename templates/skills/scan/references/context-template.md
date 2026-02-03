# 项目上下文报告模板

将语义分析结果按此模板写入 `.claude/repo-context.md`。

---

```markdown
# 项目上下文报告

**生成时间**：{{TIMESTAMP}}
**项目路径**：{{PROJECT_PATH}}
**项目 ID**：{{PROJECT_ID}}

---

## 1. 技术栈

### 1.1 核心框架

| 类型 | 技术 | 版本 |
|------|------|------|
| 语言 | {{LANGUAGE}} | {{VERSION}} |
| 框架 | {{FRAMEWORK}} | {{VERSION}} |
| 构建工具 | {{BUILD_TOOL}} | {{VERSION}} |
| 包管理器 | {{PACKAGE_MANAGER}} | - |

### 1.2 主要依赖

{{从 package.json/go.mod/requirements.txt 提取的核心依赖}}

---

## 2. 项目结构

### 2.1 目录树概览

```
{{PROJECT_NAME}}/
├── src/                  # 源代码
│   ├── app/             # 应用入口
│   ├── components/      # 可复用组件
│   ├── lib/             # 工具库
│   ├── services/        # 服务层
│   └── types/           # 类型定义
├── tests/               # 测试文件
└── ...
```

### 2.2 关键文件说明

| 路径 | 用途 | 备注 |
|------|------|------|
| {{PATH}} | {{PURPOSE}} | {{NOTE}} |

---

## 3. 入口与启动流程

**入口文件**：{{ENTRY_FILE}}

**启动流程**：
1. {{STEP_1}}
2. {{STEP_2}}
3. {{STEP_3}}

---

## 4. API 接口

### 4.1 路由定义

**位置**：{{ROUTE_FILE}}

### 4.2 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| {{METHOD}} | {{PATH}} | {{DESC}} | {{AUTH}} |

### 4.3 认证方式

- **认证方式**：{{AUTH_TYPE}}
- **中间件位置**：{{MIDDLEWARE_PATH}}

---

## 5. 数据模型

### 5.1 Schema 文件

**位置**：{{SCHEMA_FILE}}

### 5.2 核心实体

{{ENTITY_LIST}}

---

## 6. 前端结构

### 6.1 路由配置

**路由类型**：{{ROUTER_TYPE}}

### 6.2 核心组件

| 组件名 | 路径 | 用途 |
|--------|------|------|
| {{NAME}} | {{PATH}} | {{PURPOSE}} |

### 6.3 状态管理

- **方案**：{{STATE_MANAGER}}
- **Store 文件**：{{STORE_PATH}}

---

## 7. 核心业务模块

### 7.1 服务层

**位置**：{{SERVICES_PATH}}

**核心服务**：
- {{SERVICE_1}}：{{DESC}}
- {{SERVICE_2}}：{{DESC}}

---

## 8. 测试覆盖

### 8.1 测试框架

- **单元测试**：{{UNIT_TEST_FRAMEWORK}}
- **E2E 测试**：{{E2E_FRAMEWORK}}

### 8.2 测试文件分布

| 目录 | 测试类型 | 文件数 |
|------|----------|--------|
| {{DIR}} | {{TYPE}} | {{COUNT}} |

---

## 9. 开发工作流

### 9.1 常用命令

```bash
# 开发模式
{{DEV_COMMAND}}

# 构建
{{BUILD_COMMAND}}

# 测试
{{TEST_COMMAND}}
```

### 9.2 环境变量

**配置文件**：`.env.local`（参考 `.env.example`）

---

## 附录：扫描元数据

- **扫描工具**：Claude Workflow /scan
- **扫描时间**：{{SCAN_DURATION}}
- **分析文件数**：{{TOTAL_FILES}}
```
