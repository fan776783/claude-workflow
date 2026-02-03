# @pic/claude-workflow

Claude Code 工作流工具包 - 提供标准化的工作流命令、Agent 定义和文档。

## 安装

首次使用需配置私有 registry：

```bash
# 设置 registry（替换为实际地址）
npm config set @pic:registry http://your-registry-host:4873
```

```bash
# 全局安装（推荐）
npm install -g @pic/claude-workflow

# 或作为开发依赖
npm install -D @pic/claude-workflow
```

安装后会自动将工作流文件复制到 `~/.claude/` 目录。

## CLI 命令

```bash
# 查看安装状态
claude-workflow status

# 同步/更新模板
claude-workflow sync

# 强制覆盖所有文件
claude-workflow sync --force

# 初始化项目配置
claude-workflow init

# 诊断问题
claude-workflow doctor
```

## 包含内容

### 工作流技能 (skills/workflow/)

统一入口：`/workflow <action> [args]`

| 动作 | 说明 |
|------|------|
| `/workflow start "需求"` | 启动智能工作流（自动规划） |
| `/workflow execute` | 执行下一个任务 |
| `/workflow execute --retry` | 重试当前失败步骤 |
| `/workflow execute --skip` | 跳过当前步骤（慎用） |
| `/workflow status` | 查看工作流状态 |
| `/workflow unblock <dep>` | 解除任务阻塞 |
| `/workflow archive` | 归档已完成工作流 |
- `/scan` - 智能项目扫描（检测技术栈 + 生成上下文报告）
- `/write-tests` - 编写测试
- `/analyze` - 代码分析
- `/diff-review` - 差异审查

### 文档 (docs/)

- 工作流设计文档
- 项目管理工具文档
- 部署指南

## 升级

```bash
npm update -g @pic/claude-workflow
```

升级时会自动：
1. 备份当前配置到 `~/.claude/.claude-workflow/backups/`
2. 智能合并文件（保留用户修改）
3. 冲突文件写入 `.new` 后缀，需手动合并

## 项目初始化

```bash
cd your-project
claude-workflow init
```

这会在项目中创建：
- `.claude/config/project-config.json` - 项目配置

## 环境变量

- `CLAUDE_WORKFLOW_SKIP_POSTINSTALL=1` - 跳过 postinstall 自动复制

## 发布新版本

```bash
# 一键发布（自动：版本号 + 发布 + git tag + push）
npm run release:patch     # Bug 修复: 1.0.0 -> 1.0.1
npm run release:minor     # 新功能: 1.0.0 -> 1.1.0
npm run release:major     # 破坏性变更: 1.0.0 -> 2.0.0

# 或指定版本号
npm run release 2.0.0
```

## 目录结构

```
~/.claude/
├── commands/           # 工作流命令
├── prompts/            # 三模型协作 Prompt
├── docs/               # 文档
├── utils/              # 工具函数
├── workflows/          # 工作流状态（按项目隔离）
├── logs/               # 操作日志
└── .claude-workflow/   # 包元信息
    ├── meta.json       # 版本信息
    ├── originals/      # 原始模板（用于升级比对）
    └── backups/        # 升级备份
```
