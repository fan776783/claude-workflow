# Workflow 优化方案 v4（最终版）

> Codex 审核通过，总分 83/100，可进入实施阶段

## 概述

本方案旨在优化 claude-workflow 项目的工作流系统，主要包含以下优化项：

1. **计划版本控制** - 为技术方案文档引入版本控制机制
2. **讨论迭代模式** - 在工作流执行过程中支持方案调整
3. **Prompt 增强** - 在工作流启动时自动增强用户需求
4. **专业化 Agent** - 引入 planner 和 ui-ux-designer Agent

## 核心改进

### 1. ID 生成策略（ULID）

| ID 类型 | 格式 | 说明 |
|---------|------|------|
| `planId` | `plan-{ulid}` | 26 字符，时间有序，无碰撞 |
| `runId` | `run-{ulid}` | 26 字符，支持并发 |
| `decisionId` | `dec-{ulid}` | 独立 ULID |
| `versionId` | `1, 2, 3...` | 简单递增 |

### 2. 存储边界拆分

```
~/.claude/workflows/{projectId}/
├── plans/                           # Plan 级存储（长期资产）
│   ├── index.json                   # 计划索引（可重建缓存）
│   └── {planId}/                    # 每个计划一个目录
│       ├── meta.json                # 计划元数据（真相源）
│       ├── v1.md, v2.md             # 版本文件
│       └── diffs/                   # diff 文件
│
└── runs/                            # Run 级存储（运行态）
    ├── current.json                 # 当前活跃 run 指针
    └── {runId}.json                 # 每次运行的记录
```

### 3. 可续租的文件锁

```typescript
interface LockInfo {
  pid: number;
  hostname: string;
  startedAt: number;
  lastHeartbeat: number;
  nonce: string;           // 随机标识，防止 PID 复用误判
  operation: string;       // 当前操作描述
}
```

- 心跳续租：每 5 秒更新 lastHeartbeat
- 过期阈值：60 秒无心跳视为过期
- 进程存活检测：同机器检查 PID 是否存在
- 不默认强制抢锁

### 4. 跨平台原子写入

**POSIX 时序**：
```
write tmp → fsync(tmp) → rename(tmp→target) → fsync(dir)
```

**Windows 策略**：
```
write tmp → FlushFileBuffers → unlink target → rename
```

**降级策略**：网络盘/容器卷降级为普通写入

### 5. index.json 定位为可重建缓存

- 真相源：`plans/{planId}/meta.json`
- 启动时自动重建索引
- 写操作先更新 meta.json，再更新 index（允许不一致）
- 索引过期（>1 小时）或损坏自动重建

### 6. ContentHash 规范

**最小规范化（不改变语义）**：
1. 编码：UTF-8
2. 换行：CRLF → LF, CR → LF
3. 文件末尾：确保有且仅有一个换行符
4. 不修改行内空白

### 7. stablePath 同步配置化

| 模式 | 说明 |
|------|------|
| `none` | 不添加任何标记 |
| `frontmatter` | 使用 YAML front-matter |
| `comment` | 使用 HTML 注释（文件末尾） |
| `sidecar` | 使用旁路文件（.sync.json） |

### 8. slug 生命周期管理

- 目录名始终使用 planId（确保唯一性）
- slug 作为别名，存储在 meta.json
- 提供 slug → planId 查找功能
- slug 变更不移动目录

### 9. projectId 定义

- 基于项目根目录绝对路径
- MD5 哈希取前 12 位
- 同一路径始终生成相同 ID

### 10. 敏感信息 HMAC 处理

- 本机随机生成 32 字节密钥
- 密钥存储在 `~/.claude/.secret-key`
- 使用 HMAC-SHA-256
- 无法通过字典枚举反推原文

### 11. Schema 版本演进

- 所有数据结构添加 `schemaVersion` 字段
- 读取时检查版本，低版本自动迁移
- 高版本兼容读取（忽略未知字段）

## 数据结构

### PlanMeta

```typescript
interface PlanMeta {
  schemaVersion: number;
  planId: string;           // plan-{ulid}，目录名
  slug: string;             // 别名，可变
  displayName: string;      // 显示名称
  description?: string;
  currentVersion: number;
  stablePath: string;       // 项目级稳定入口路径
  versions: PlanVersion[];
  createdAt: string;
  updatedAt: string;
}
```

### PlanVersion

```typescript
interface PlanVersion {
  versionId: number;
  path: string;             // 相对路径，如 "v1.md"
  contentHash: string;      // sha256:{hex}
  status: 'draft' | 'approved' | 'superseded';
  author: string;
  createdAt: string;
  summary: string;
  basedOn?: number;
  diffRef?: string;
  changes?: VersionChange[];
}
```

### RunRecord

```typescript
interface RunRecord {
  schemaVersion: number;
  runId: string;            // run-{ulid}
  planId: string;
  planVersionAtStart: number;
  task: TaskInfo;
  enhancement: EnhancementStorage;
  steps: WorkflowStep[];
  currentStepId: number;
  totalSteps: number;
  decisions: Decision[];
  qualityGatesBypassed: QualityGateBypass[];
  artifacts: Record<string, string>;
  status: 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed';
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

## 实施计划

| 阶段 | 优化项 | 预计工作量 | 优先级 |
|------|--------|-----------|--------|
| Phase 1 | ULID 生成 + 可续租锁 | 1 天 | P0 |
| Phase 2 | 跨平台原子写入 | 0.5 天 | P0 |
| Phase 3 | Plan/Run 存储分离 + 索引重建 | 1.5 天 | P0 |
| Phase 4 | ContentHash 规范 + stablePath 配置化 | 0.5 天 | P1 |
| Phase 5 | slug 管理 + projectId 定义 | 0.5 天 | P1 |
| Phase 6 | 计划版本控制 | 1 天 | P1 |
| Phase 7 | 讨论迭代模式 | 1 天 | P1 |
| Phase 8 | HMAC 敏感信息 + Schema 版本 | 0.5 天 | P2 |
| Phase 9 | Prompt 增强 | 0.5 天 | P2 |
| Phase 10 | Agent 合同 Schema | 1 天 | P2 |
| Phase 11 | 迁移工具 + 测试 | 1 天 | P1 |

**总计**：约 9 天

## 验收标准

- [ ] 崩溃注入/断电模拟测试通过
- [ ] 双进程并发抢锁/续租测试通过
- [ ] index 损坏/缺失/过期自愈测试通过
- [ ] frontmatter 合并不产生非必要 diff
- [ ] 密钥丢失/轮换兼容测试通过

## Codex 审核记录

| 版本 | 总分 | 日期 |
|------|------|------|
| v1 | 75/100 | 2025-01-19 |
| v2 | 84/100 | 2025-01-19 |
| v3 | 83/100 | 2025-01-19 |
| v4 | 83/100 | 2025-01-19 |

## 参考

- ccg-workflow 项目的 spec 设计
- Codex 审核建议
