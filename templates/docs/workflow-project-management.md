# 工作流项目管理工具文档

本文档描述用户级工作流系统的项目管理工具，用于管理 `~/.claude/workflows/` 目录下的多个项目状态。

**设计文档**: `.claude/docs/user-level-workflow-design.md`

---

## 📋 工具概览

| 命令 | 功能 | 典型场景 |
|------|------|----------|
| `/workflow-list-projects` | 列出所有项目 | 查看所有工作流项目，清理旧项目前查看 |
| `/workflow-clean-old` | 清理旧项目 | 释放存储空间，删除长期未使用的项目 |
| `/workflow-link-project` | 链接项目 | 项目路径变化后恢复工作流状态 |
| `/workflow-migrate-to-user` | 迁移到用户级 | 将旧版项目级状态迁移到用户级目录 |

---

## 1. `/workflow-list-projects` - 列出所有项目

### 功能描述

列出所有使用过工作流的项目，显示项目路径、最后使用时间、工作流数量等信息。

### 使用方法

```bash
/workflow-list-projects

# 可选参数：
/workflow-list-projects --sort=lastUsed    # 按最后使用时间排序（默认）
/workflow-list-projects --sort=name        # 按项目名称排序
/workflow-list-projects --sort=size        # 按存储大小排序
```

### 实现逻辑

```typescript
/**
 * 列出所有工作流项目
 */
async function listWorkflowProjects(options: {
  sort?: 'lastUsed' | 'name' | 'size'
}): Promise<void> {
  const workflowsDir = path.join(os.homedir(), '.claude/workflows');

  // 检查工作流目录是否存在
  if (!fs.existsSync(workflowsDir)) {
    console.log('📭 暂无工作流项目');
    return;
  }

  // 读取所有项目目录
  const projectDirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  if (projectDirs.length === 0) {
    console.log('📭 暂无工作流项目');
    return;
  }

  // 收集项目信息
  const projects = projectDirs.map(projectId => {
    const projectDir = path.join(workflowsDir, projectId);
    const metaPath = path.join(projectDir, '.project-meta.json');

    // 读取元数据
    const meta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      : { path: '未知', name: projectId, lastUsed: '未知' };

    // 计算存储大小
    const size = calculateDirSize(projectDir);

    // 计算工作流数量
    const workflowCount = countWorkflowFiles(projectDir);

    // 计算最后使用时间
    const lastUsedDate = meta.lastUsed ? new Date(meta.lastUsed) : null;
    const daysSinceLastUsed = lastUsedDate
      ? Math.floor((Date.now() - lastUsedDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      projectId,
      path: meta.path,
      name: meta.name,
      lastUsed: meta.lastUsed,
      daysSinceLastUsed,
      workflowCount,
      size,
      status: daysSinceLastUsed === null ? '未知'
        : daysSinceLastUsed === 0 ? '✅ 活跃'
        : daysSinceLastUsed < 7 ? '✅ 活跃'
        : daysSinceLastUsed < 30 ? '⚠️ 近期使用'
        : '⚠️ 建议清理'
    };
  });

  // 排序
  const sortKey = options.sort || 'lastUsed';
  projects.sort((a, b) => {
    if (sortKey === 'lastUsed') {
      return (b.daysSinceLastUsed ?? Infinity) - (a.daysSinceLastUsed ?? Infinity);
    } else if (sortKey === 'name') {
      return a.name.localeCompare(b.name);
    } else if (sortKey === 'size') {
      return b.size - a.size;
    }
    return 0;
  });

  // 输出表格
  console.log(`
📊 工作流项目列表（共 ${projects.length} 个项目）

┌─────────────┬──────────────────────────────────┬──────────────┬──────────┬────────┬─────────────┐
│ 项目 ID     │ 项目路径                          │ 项目名       │ 最后使用 │ 工作流 │ 状态        │
├─────────────┼──────────────────────────────────┼──────────────┼──────────┼────────┼─────────────┤
${projects.map(p =>
  `│ ${p.projectId.padEnd(12)} │ ${truncate(p.path, 32).padEnd(32)} │ ${truncate(p.name, 12).padEnd(12)} │ ${formatLastUsed(p.daysSinceLastUsed).padEnd(8)} │ ${String(p.workflowCount).padStart(6)} │ ${p.status.padEnd(11)} │`
).join('\n')}
└─────────────┴──────────────────────────────────┴──────────────┴──────────┴────────┴─────────────┘

💾 总存储空间: ${formatSize(projects.reduce((sum, p) => sum + p.size, 0))}
  `);
}

// 辅助函数
function calculateDirSize(dirPath: string): number {
  let totalSize = 0;
  const files = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const file of files) {
    const filePath = path.join(dirPath, file.name);
    if (file.isDirectory()) {
      totalSize += calculateDirSize(filePath);
    } else {
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    }
  }

  return totalSize;
}

function countWorkflowFiles(dirPath: string): number {
  const files = fs.readdirSync(dirPath);
  return files.filter(f =>
    f === 'workflow-memory.json' ||
    f.startsWith('workflow-memory-backup-') ||
    f.startsWith('context-summary-')
  ).length;
}

function formatLastUsed(days: number | null): string {
  if (days === null) return '未知';
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  return `${Math.floor(days / 30)}月前`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}
```

### 输出示例

```
📊 工作流项目列表（共 3 个项目）

┌─────────────┬──────────────────────────────────┬──────────────┬──────────┬────────┬─────────────┐
│ 项目 ID     │ 项目路径                          │ 项目名       │ 最后使用 │ 工作流 │ 状态        │
├─────────────┼──────────────────────────────────┼──────────────┼──────────┼────────┼─────────────┤
│ a1b2c3d4e5f6│ /Users/ws/dev/skymediafrontend   │ skymediao... │ 2小时前  │      5 │ ✅ 活跃     │
│ b2c3d4e5f6a1│ /Users/ws/projects/demo-app      │ demo-app     │ 5天前    │      2 │ ⚠️ 近期使用 │
│ c3d4e5f6a1b2│ /Users/ws/old/legacy-project     │ legacy-pr... │ 60天前   │      0 │ ⚠️ 建议清理 │
└─────────────┴──────────────────────────────────┴──────────────┴──────────┴────────┴─────────────┘

💾 总存储空间: 5.2MB
```

---

## 2. `/workflow-clean-old` - 清理旧项目

### 功能描述

删除长期未使用的项目工作流状态，释放存储空间。

### 使用方法

```bash
/workflow-clean-old                   # 默认清理 30 天未使用的项目
/workflow-clean-old --days=60         # 清理 60 天未使用的项目
/workflow-clean-old --days=90 --force # 强制清理，跳过确认
```

### 实现逻辑

```typescript
/**
 * 清理旧项目工作流状态
 */
async function cleanOldWorkflowProjects(options: {
  days?: number,
  force?: boolean
}): Promise<void> {
  const days = options.days || 30;
  const workflowsDir = path.join(os.homedir(), '.claude/workflows');

  if (!fs.existsSync(workflowsDir)) {
    console.log('📭 暂无工作流项目');
    return;
  }

  // 读取所有项目目录
  const projectDirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  // 筛选出需要清理的项目
  const projectsToClean = [];
  for (const projectId of projectDirs) {
    const projectDir = path.join(workflowsDir, projectId);
    const metaPath = path.join(projectDir, '.project-meta.json');

    const meta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      : null;

    if (!meta || !meta.lastUsed) continue;

    const lastUsedDate = new Date(meta.lastUsed);
    const daysSinceLastUsed = Math.floor((Date.now() - lastUsedDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceLastUsed > days) {
      const size = calculateDirSize(projectDir);
      projectsToClean.push({
        projectId,
        path: meta.path,
        name: meta.name,
        daysSinceLastUsed,
        size
      });
    }
  }

  if (projectsToClean.length === 0) {
    console.log(`✅ 无需清理（没有超过 ${days} 天未使用的项目）`);
    return;
  }

  // 输出待清理项目
  console.log(`
🔍 扫描超过 ${days} 天未使用的项目...

找到 ${projectsToClean.length} 个项目：
${projectsToClean.map((p, i) =>
  `${i + 1}. ${p.projectId} - ${p.name} (最后使用 ${p.daysSinceLastUsed} 天前，大小 ${formatSize(p.size)})`
).join('\n')}

⚠️ 确认删除？这将删除工作流状态、日志、缓存等所有数据。
  `);

  // 确认
  if (!options.force) {
    const confirmed = await AskUserQuestion({
      questions: [{
        question: '确认删除这些项目的工作流数据吗？',
        header: '确认删除',
        multiSelect: false,
        options: [
          { label: '确认删除', description: '永久删除这些项目的工作流数据' },
          { label: '取消', description: '取消删除操作' }
        ]
      }]
    });

    if (confirmed.answers['确认删除'] !== '确认删除') {
      console.log('❌ 已取消删除');
      return;
    }
  }

  // 执行删除
  let totalSize = 0;
  for (const project of projectsToClean) {
    const projectDir = path.join(workflowsDir, project.projectId);
    fs.rmSync(projectDir, { recursive: true, force: true });
    totalSize += project.size;
  }

  console.log(`
✅ 已清理 ${projectsToClean.length} 个项目，释放空间 ${formatSize(totalSize)}
  `);
}
```

### 输出示例

```
🔍 扫描超过 30 天未使用的项目...

找到 2 个项目：
1. c3d4e5f6a1b2 - legacy-project (最后使用 60 天前，大小 2.5MB)
2. d4e5f6a1b2c3 - temp-project (最后使用 45 天前，大小 1.2MB)

⚠️ 确认删除？这将删除工作流状态、日志、缓存等所有数据。

[用户确认后]

✅ 已清理 2 个项目，释放空间 3.7MB
```

---

## 3. `/workflow-link-project` - 链接项目

### 功能描述

当项目路径变化时（如移动到新目录），将当前项目链接到现有项目的工作流状态。

### 使用方法

```bash
# 自动检测并链接（推荐）
/workflow-link-project

# 手动指定项目 ID
/workflow-link-project a1b2c3d4e5f6
```

### 实现逻辑

```typescript
/**
 * 链接项目到现有工作流状态
 */
async function linkWorkflowProject(projectId?: string): Promise<void> {
  const cwd = process.cwd();
  const currentProjectId = getProjectId();
  const workflowsDir = path.join(os.homedir(), '.claude/workflows');

  // 检查当前项目是否已有工作流状态
  const currentProjectDir = path.join(workflowsDir, currentProjectId);
  if (fs.existsSync(currentProjectDir)) {
    console.log('✅ 当前项目已有工作流状态，无需链接');
    return;
  }

  // 如果未指定项目 ID，自动检测
  if (!projectId) {
    // 读取所有项目
    const projectDirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    // 查找相似项目（基于项目名称）
    const currentProjectName = path.basename(cwd);
    const similarProjects = projectDirs
      .map(id => {
        const metaPath = path.join(workflowsDir, id, '.project-meta.json');
        const meta = fs.existsSync(metaPath)
          ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          : null;
        return { id, meta };
      })
      .filter(p => p.meta && p.meta.name === currentProjectName)
      .sort((a, b) => new Date(b.meta.lastUsed).getTime() - new Date(a.meta.lastUsed).getTime());

    if (similarProjects.length === 0) {
      console.log('❌ 未找到相似项目，请手动指定项目 ID');
      return;
    }

    // 询问用户
    const answer = await AskUserQuestion({
      questions: [{
        question: '检测到新路径，是否链接到现有项目？',
        header: '项目链接',
        multiSelect: false,
        options: [
          ...similarProjects.map(p => ({
            label: p.meta.name,
            description: `${p.meta.path} (最后使用 ${formatLastUsed(Math.floor((Date.now() - new Date(p.meta.lastUsed).getTime()) / (1000 * 60 * 60 * 24)))})`
          })),
          { label: '创建新项目', description: '不链接，创建新的工作流状态' }
        ]
      }]
    });

    if (answer.answers['项目链接'] === '创建新项目') {
      console.log('✅ 将创建新项目的工作流状态');
      return;
    }

    // 找到选中的项目 ID
    const selectedProject = similarProjects.find(p => p.meta.name === answer.answers['项目链接']);
    if (!selectedProject) {
      console.log('❌ 未找到选中的项目');
      return;
    }

    projectId = selectedProject.id;
  }

  // 验证项目 ID 存在
  const sourceProjectDir = path.join(workflowsDir, projectId);
  if (!fs.existsSync(sourceProjectDir)) {
    console.log(`❌ 项目 ID ${projectId} 不存在`);
    return;
  }

  // 创建符号链接
  fs.symlinkSync(sourceProjectDir, currentProjectDir, 'dir');

  // 更新元数据
  const metaPath = path.join(sourceProjectDir, '.project-meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  meta.path = cwd;
  meta.lastUsed = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`
✅ 已将当前项目链接到 ${projectId}

📋 工作流状态：${countWorkflowFiles(sourceProjectDir)} 个工作流
📍 原路径：${meta.path}
📍 新路径：${cwd}
  `);
}
```

### 输出示例

```
⚠️ 检测到新路径，是否链接到现有项目？

找到类似项目：
1. skymediafrontend (/Users/ws/dev/skymediafrontend) - 最后使用 2 小时前
2. 创建新项目

选择：1

✅ 已将当前项目链接到 a1b2c3d4e5f6

📋 工作流状态：5 个工作流
📍 原路径：/Users/ws/dev/skymediafrontend
📍 新路径：/Users/ws/projects/skymedia-v2
```

---

## 4. `/workflow-migrate-to-user` - 迁移到用户级

### 功能描述

将旧版项目级工作流状态（`.claude/workflow-memory.json`）迁移到用户级目录（`~/.claude/workflows/`）。

### 使用方法

```bash
/workflow-migrate-to-user             # 自动检测并迁移当前项目
/workflow-migrate-to-user --all       # 迁移所有项目（递归搜索）
```

### 实现逻辑

```typescript
/**
 * 迁移项目级工作流状态到用户级
 */
async function migrateWorkflowToUser(options: {
  all?: boolean
}): Promise<void> {
  const cwd = process.cwd();

  if (options.all) {
    // 递归搜索所有项目级工作流状态
    console.log('🔍 扫描所有项目级工作流状态...');

    const projectLevelStates = findProjectLevelWorkflowStates(cwd);

    if (projectLevelStates.length === 0) {
      console.log('✅ 未找到项目级工作流状态');
      return;
    }

    console.log(`
找到 ${projectLevelStates.length} 个项目级工作流状态：
${projectLevelStates.map((p, i) => `${i + 1}. ${p}`).join('\n')}

⚠️ 确认迁移？
    `);

    const confirmed = await AskUserQuestion({
      questions: [{
        question: '确认迁移这些项目的工作流状态到用户级目录吗？',
        header: '确认迁移',
        multiSelect: false,
        options: [
          { label: '确认迁移', description: '迁移并删除旧版文件' },
          { label: '取消', description: '取消迁移操作' }
        ]
      }]
    });

    if (confirmed.answers['确认迁移'] !== '确认迁移') {
      console.log('❌ 已取消迁移');
      return;
    }

    // 执行迁移
    for (const projectPath of projectLevelStates) {
      await migrateProject(projectPath);
    }

    console.log(`✅ 已迁移 ${projectLevelStates.length} 个项目`);
    return;
  }

  // 迁移当前项目
  const projectLevelPath = path.join(cwd, '.claude/workflow-memory.json');

  if (!fs.existsSync(projectLevelPath)) {
    console.log('✅ 当前项目无项目级工作流状态');
    return;
  }

  await migrateProject(cwd);

  console.log('✅ 迁移完成');
}

/**
 * 迁移单个项目
 */
async function migrateProject(projectPath: string): Promise<void> {
  const projectLevelDir = path.join(projectPath, '.claude');

  // 计算项目 ID（基于项目路径）
  const hash = crypto.createHash('md5')
    .update(projectPath)
    .digest('hex')
    .substring(0, 12);

  const userLevelDir = path.join(os.homedir(), '.claude/workflows', hash);

  // 创建用户级目录
  if (!fs.existsSync(userLevelDir)) {
    fs.mkdirSync(userLevelDir, { recursive: true });
  }

  // 迁移文件列表
  const filesToMigrate = [
    'workflow-memory.json',
    'workflow-memory-backup-*.json',
    'workflow-memory-completed-*.json',
    'context-summary-*.md',
    'verification-report*.md',
    'operations-log.md',
    'coding-log*.md'
  ];

  let migratedCount = 0;

  for (const pattern of filesToMigrate) {
    const files = fs.readdirSync(projectLevelDir)
      .filter(f => minimatch(f, pattern));

    for (const file of files) {
      const sourcePath = path.join(projectLevelDir, file);
      const targetPath = path.join(userLevelDir, file);

      // 复制文件
      fs.copyFileSync(sourcePath, targetPath);

      // 删除原文件
      fs.unlinkSync(sourcePath);

      migratedCount++;
    }
  }

  // 迁移 bug-reports 目录
  const bugReportsDir = path.join(projectLevelDir, 'bug-reports');
  if (fs.existsSync(bugReportsDir)) {
    const targetBugReportsDir = path.join(userLevelDir, 'bug-reports');
    fs.cpSync(bugReportsDir, targetBugReportsDir, { recursive: true });
    fs.rmSync(bugReportsDir, { recursive: true, force: true });
    migratedCount++;
  }

  // 创建元数据
  const meta = {
    path: projectPath,
    name: path.basename(projectPath),
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    migratedFrom: 'project-level',
    migratedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(userLevelDir, '.project-meta.json'),
    JSON.stringify(meta, null, 2)
  );

  console.log(`
✅ 已迁移项目: ${path.basename(projectPath)}

**项目路径**: ${projectPath}
**项目 ID**: ${hash}
**迁移文件数**: ${migratedCount}
**用户级目录**: ${userLevelDir}
  `);
}

/**
 * 递归查找所有项目级工作流状态
 */
function findProjectLevelWorkflowStates(dir: string, maxDepth = 3, currentDepth = 0): string[] {
  if (currentDepth > maxDepth) return [];

  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // 跳过 node_modules、.git 等目录
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }

      if (entry.isDirectory()) {
        // 检查是否为 .claude 目录
        if (entry.name === '.claude') {
          const workflowMemoryPath = path.join(fullPath, 'workflow-memory.json');
          if (fs.existsSync(workflowMemoryPath)) {
            results.push(dir);
          }
        } else {
          // 递归搜索
          results.push(...findProjectLevelWorkflowStates(fullPath, maxDepth, currentDepth + 1));
        }
      }
    }
  } catch (error) {
    // 忽略权限错误等
  }

  return results;
}
```

### 输出示例

```
🔍 扫描所有项目级工作流状态...

找到 2 个项目级工作流状态：
1. /Users/ws/dev/skymediafrontend
2. /Users/ws/projects/demo-app

⚠️ 确认迁移？

[用户确认后]

✅ 已迁移项目: skymediafrontend

**项目路径**: /Users/ws/dev/skymediafrontend
**项目 ID**: a1b2c3d4e5f6
**迁移文件数**: 8
**用户级目录**: /Users/ws/.claude/workflows/a1b2c3d4e5f6

✅ 已迁移项目: demo-app

**项目路径**: /Users/ws/projects/demo-app
**项目 ID**: b2c3d4e5f6a1
**迁移文件数**: 3
**用户级目录**: /Users/ws/.claude/workflows/b2c3d4e5f6a1

✅ 已迁移 2 个项目
```

---

## 📊 全局项目索引

所有项目信息自动维护在 `~/.claude/projects-index.json`：

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
    }
  }
}
```

**自动更新时机**：
- 首次在项目中使用工作流
- 每次工作流执行时更新 `lastUsed`
- 迁移项目时添加/更新项目记录

---

## 🔗 相关文档

- `.claude/docs/user-level-workflow-design.md` - 用户级工作流设计文档
- `.claude/commands/workflow-start.md` - 工作流启动命令
- `.claude/commands/workflow-fix-bug.md` - Bug 修复工作流
- `CLAUDE.md` - 项目开发规范

---

## 💡 最佳实践

### 定期清理

建议每月清理一次旧项目：

```bash
# 每月执行
/workflow-clean-old --days=60
```

### 项目重命名/移动

项目路径变化后，使用链接功能恢复工作流状态：

```bash
# 项目移动后
cd /new/project/path
/workflow-link-project
```

### 团队协作

- ✅ 每个开发者管理自己的工作流状态，完全隔离
- ✅ 通过快照机制（`.claude/workflow-snapshots/`）共享工作流状态
- ✅ 项目级配置（`.claude/config/`）提交到 Git，团队共享

### 备份重要工作流

重要工作流建议创建快照并提交到 Git：

```bash
/workflow-snapshot "完成需求分析阶段"
# 生成：.claude/workflow-snapshots/payment-feature-2024-01-20.json
# 提交到 Git 供团队使用
```
