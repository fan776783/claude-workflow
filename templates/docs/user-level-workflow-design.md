# 用户级工作流状态管理设计文档

## 📋 概述

本文档描述基于当前工作目录（cwd）的用户级工作流状态管理方案，彻底解决多人协作时的 Git 冲突问题。

**设计原则**：
- ✅ 完全自动化 - 用户无需任何配置
- ✅ 天然隔离 - 每个开发者管理自己的状态
- ✅ 职责分离 - 项目级共享，用户级私有
- ✅ 通用性强 - 支持任何类型项目（Git/非Git）

---

## 🗂️ 目录结构

### 项目级目录（.claude/ - Git 管理）

```
project/.claude/
├── commands/                    # 自定义斜杠命令（团队共享）✅ Git
│   ├── workflow-start.md
│   ├── workflow-fix-bug.md
│   └── ...
├── config/                      # 项目配置（团队共享）✅ Git
│   └── project-config.json
├── templates/                   # 文档模板（团队共享）✅ Git
│   ├── context-summary-template.md
│   └── bug-report-template.md
├── workflow-snapshots/          # 工作流快照（可选提交）✅ Git
│   └── fix-avatar-2024-01-20.json
└── docs/                        # 技术文档（团队共享）✅ Git
    └── user-level-workflow-design.md
```

**提交到 Git**：团队共享的配置、命令、模板、快照

---

### 用户级目录（~/.claude/ - 用户自管理）

```
~/.claude/
├── workflows/                          # 工作流状态（按项目隔离）
│   ├── a1b2c3d4e5f6/                   # 项目 1（基于路径 hash）
│   │   ├── workflow-memory.json
│   │   ├── workflow-memory-backup-2024-01-20-10:30.json
│   │   ├── workflow-memory-backup-2024-01-19-15:00.json
│   │   ├── context-summary-fix-avatar.md
│   │   ├── context-summary-add-payment.md
│   │   ├── bug-reports/
│   │   │   └── bug-p328_600.md
│   │   ├── verification-report-fix-avatar.md
│   │   └── .project-meta.json          # 项目元数据
│   ├── b2c3d4e5f6a1/                   # 项目 2
│   │   ├── workflow-memory.json
│   │   └── .project-meta.json
│   └── c3d4e5f6a1b2/                   # 项目 3
│       └── ...
├── logs/                               # 操作日志（按项目）
│   ├── a1b2c3d4e5f6/
│   │   └── operations-log.md
│   └── b2c3d4e5f6a1/
│       └── operations-log.md
├── cache/                              # 缓存数据
│   └── context-cache/
├── projects-index.json                 # 全局项目索引
└── global-config.json                  # 全局配置
```

**不提交 Git**：完全由用户自己管理，Claude Code 自动维护

---

## 🔧 核心实现

### 1. 项目识别算法

```typescript
/**
 * 获取当前项目的唯一标识
 * 基于当前工作目录（cwd）计算 MD5 hash
 */
function getProjectId(): string {
  const cwd = process.cwd(); // 例如：/Users/ws/dev/skymediafrontend
  const hash = crypto.createHash('md5')
    .update(cwd)
    .digest('hex')
    .substring(0, 12); // 取前 12 位，例如：a1b2c3d4e5f6

  return hash;
}
```

**优点**：
- ✅ 唯一性强 - 不同路径产生不同 hash
- ✅ 固定长度 - 始终 12 个字符
- ✅ 无特殊字符 - 可安全用作目录名
- ✅ 可重现 - 相同路径产生相同 hash

---

### 2. 工作流路径解析

```typescript
/**
 * 获取当前项目的工作流记忆文件路径
 * 自动处理目录创建和元数据维护
 */
function getWorkflowMemoryPath(): string {
  const projectId = getProjectId();
  const workflowDir = path.join(
    os.homedir(),
    '.claude/workflows',
    projectId
  );

  // 首次使用：创建目录和元数据
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });

    // 保存项目元数据
    const meta = {
      path: process.cwd(),
      name: path.basename(process.cwd()),
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(workflowDir, '.project-meta.json'),
      JSON.stringify(meta, null, 2)
    );

    // 更新全局索引
    updateProjectsIndex(projectId, meta);
  } else {
    // 更新最后使用时间
    updateLastUsed(projectId);
  }

  return path.join(workflowDir, 'workflow-memory.json');
}
```

---

### 3. 项目元数据

**`.project-meta.json`** - 每个项目目录下的元数据文件：

```json
{
  "path": "/Users/ws/dev/skymediafrontend",
  "name": "skymediafrontend",
  "createdAt": "2025-01-20T10:00:00Z",
  "lastUsed": "2025-01-20T14:30:00Z",
  "workflowCount": 5,
  "totalSize": "2.5MB",
  "git": {
    "remote": "git@github.com:company/skymediafrontend.git",
    "branch": "feature/user-level-workflow"
  }
}
```

---

### 4. 全局项目索引

**`~/.claude/projects-index.json`** - 快速查询所有项目：

```json
{
  "version": "1.0",
  "lastUpdated": "2025-01-20T14:30:00Z",
  "projects": {
    "a1b2c3d4e5f6": {
      "path": "/Users/ws/dev/skymediafrontend",
      "name": "skymediafrontend",
      "lastUsed": "2025-01-20T14:30:00Z",
      "workflowCount": 5
    },
    "b2c3d4e5f6a1": {
      "path": "/Users/ws/projects/demo-app",
      "name": "demo-app",
      "lastUsed": "2025-01-19T10:00:00Z",
      "workflowCount": 2
    },
    "c3d4e5f6a1b2": {
      "path": "/Users/ws/old/legacy-project",
      "name": "legacy-project",
      "lastUsed": "2024-11-20T08:00:00Z",
      "workflowCount": 0
    }
  }
}
```

---

## 🔄 向后兼容策略

### 检测和迁移

工作流启动时自动检测项目级状态并提示迁移：

```typescript
function getWorkflowMemoryPathWithMigration(): string {
  const cwd = process.cwd();
  const projectLevelPath = path.join(cwd, '.claude/workflow-memory.json');

  // 检查项目级状态（旧方案）
  if (fs.existsSync(projectLevelPath)) {
    console.log(`
⚠️ 检测到项目级工作流状态（旧方案）

📍 位置：${projectLevelPath}

🔄 建议迁移到用户级目录：
  - 优点：完全避免 Git 冲突
  - 优点：多人协作无冲突
  - 优点：用户完全自主管理

执行命令：/workflow-migrate-to-user
或手动复制：cp ${projectLevelPath} ${getUserLevelPath()}
    `);

    // 询问用户是否立即迁移
    // 使用 AskUserQuestion
  }

  // 返回用户级路径（新方案）
  return getUserLevelPath();
}
```

---

## 📊 项目管理工具

### 列出所有项目

```bash
/workflow-list-projects

# 输出：
# ID            项目路径                               项目名              最后使用      状态
# a1b2c3d4e5f6  /Users/ws/dev/skymediafrontend        skymediafrontend    2小时前       ✅ 活跃
# b2c3d4e5f6a1  /Users/ws/projects/demo-app           demo-app            5天前
# c3d4e5f6a1b2  /Users/ws/old/legacy-project          legacy-project      60天前        ⚠️ 建议清理
```

---

### 清理旧项目

```bash
/workflow-clean-old --days=30

# 输出：
# 🔍 扫描超过 30 天未使用的项目...
#
# 找到 2 个项目：
# 1. c3d4e5f6a1b2 - legacy-project (最后使用 60 天前)
# 2. d4e5f6a1b2c3 - temp-project (最后使用 45 天前)
#
# ⚠️ 确认删除？这将删除工作流状态、日志、缓存等所有数据。
#
# [Y/n]: Y
#
# ✅ 已清理 2 个项目，释放空间 5.2MB
```

---

### 链接项目（处理路径变化）

```bash
# 场景：项目移动到新路径
cd /Users/ws/projects/skymedia-v2  # 新路径

/workflow-start

# 自动检测：
⚠️ 检测到新路径，是否链接到现有项目？

找到类似项目：
1. skymediafrontend (/Users/ws/dev/skymediafrontend) - 最后使用 2 小时前
2. 创建新项目

选择：1

✅ 已链接到现有项目
📋 工作流状态已迁移
🔄 元数据已更新
```

手动链接：

```bash
/workflow-link-project a1b2c3d4e5f6

# 输出：
# ✅ 已将当前项目链接到 a1b2c3d4e5f6 (skymediafrontend)
# 📋 工作流状态：5 个工作流
# 📍 原路径：/Users/ws/dev/skymediafrontend
# 📍 新路径：/Users/ws/projects/skymedia-v2
```

---

## 🎯 用户体验

### 场景 1：日常开发（完全自动）

```bash
# 开发者在项目 1 工作
cd /Users/zhangsan/dev/skymediafrontend
/workflow-start "实现支付功能"
# ✅ 自动使用 ~/.claude/workflows/a1b2c3d4e5f6/workflow-memory.json

# 开发者切换到项目 2
cd /Users/zhangsan/dev/other-project
/workflow-start "修复 Bug"
# ✅ 自动切换到 ~/.claude/workflows/b2c3d4e5f6a1/workflow-memory.json
```

**完全无感知，自动隔离！**

---

### 场景 2：多人协作（天然隔离）

```bash
# 开发者 A
cd /Users/zhangsan/company/skymediafrontend
/workflow-start "功能开发"
# 使用：~zhangsan/.claude/workflows/xxx/workflow-memory.json

# 开发者 B（同一项目，不同机器）
cd /Users/lisi/workspace/skymediafrontend
/workflow-start "功能开发"
# 使用：~lisi/.claude/workflows/yyy/workflow-memory.json

# ✅ 完全隔离，无 Git 冲突
# ✅ 各自管理自己的工作流状态
```

---

### 场景 3：任务交接（通过快照）

```bash
# 开发者 A：导出快照
cd /Users/zhangsan/dev/skymediafrontend
/workflow-snapshot "完成需求分析阶段"
# 生成：project/.claude/workflow-snapshots/payment-feature-2024-01-20.json
# ✅ 提交到 Git

# 开发者 B：导入快照
cd /Users/lisi/workspace/skymediafrontend
/workflow-import .claude/workflow-snapshots/payment-feature-2024-01-20.json
# ✅ 导入到 ~/.claude/workflows/yyy/workflow-memory.json
# ✅ 继续开发
```

---

## ✅ 优势总结

1. **完全避免 Git 冲突**
   - 工作流状态不在项目目录
   - 天然隔离，无需 .gitignore

2. **用户完全自主**
   - 每个开发者管理自己的状态
   - 无需担心影响他人

3. **职责清晰**
   - 项目级：团队共享（命令、配置、模板）
   - 用户级：个人私有（状态、日志、缓存）

4. **完全自动化**
   - 无需配置
   - 无需手动管理
   - 自动切换项目

5. **支持任务交接**
   - 通过快照机制
   - 灵活导出/导入

6. **通用性强**
   - 支持 Git 项目
   - 支持非 Git 项目
   - 支持任何类型项目

---

## 📝 实施清单

- [ ] 创建用户级目录结构文档 ✅
- [ ] 更新 workflow-start.md 支持用户级存储
- [ ] 更新 workflow-fix-bug.md 支持用户级存储
- [ ] 更新其他工作流命令
- [ ] 清理 .gitignore 中的工作流规则
- [ ] 创建项目管理工具文档
- [ ] 创建 /workflow-migrate-to-user 命令
- [ ] 创建 /workflow-list-projects 命令
- [ ] 创建 /workflow-clean-old 命令
- [ ] 创建 /workflow-link-project 命令
- [ ] 更新 CLAUDE.md 文档
- [ ] 更新 agents.md 文档

---

## 📚 相关文档

- `CLAUDE.md` - 项目开发规范
- `agents.md` - Agent 命令使用指南
- `.claude/commands/workflow-start.md` - 工作流启动命令
- `.claude/commands/workflow-fix-bug.md` - Bug 修复工作流
