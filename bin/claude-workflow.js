#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const semver = require('semver');

const pkg = require('../package.json');
const {
  ensureClaudeHome,
  installFresh,
  upgradeFrom,
  copyTemplatesToClaude,
  installForAgents,
  getInstallationStatus,
  migrateFromLegacy,
  SYMLINK_DIRS,
} = require('../lib/installer');
const {
  agents,
  detectInstalledAgents,
  getCanonicalDir,
  getAllAgentNames,
  parseAgentArg,
} = require('../lib/agents');
const {
  runInteractiveInstall,
  runInteractiveStatus,
} = require('../lib/interactive-installer');

// 无参数时显示交互式菜单（仅在 TTY 环境）
if (process.argv.length === 2) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { run } = require('../lib/menu');
    run();
  } else {
    // 非 TTY 环境，打印帮助信息
    console.log(`Claude Workflow v${pkg.version}`);
    console.log('\n使用: claude-workflow <command>\n');
    console.log('可用命令:');
    console.log('  sync     同步工作流模板到 ~/.claude');
    console.log('  init     初始化项目配置');
    console.log('  status   查看安装状态');
    console.log('  doctor   诊断配置问题');
    console.log('\n示例:');
    console.log('  claude-workflow sync');
    console.log('  claude-workflow sync -f');
  }
} else {
  // 有参数时执行命令

const program = new Command();

program
  .name('claude-workflow')
  .description('Claude Code 工作流工具包管理器')
  .version(pkg.version);

// sync 命令：同步模板到多个 Agent
program
  .command('sync')
  .description('同步工作流模板到 AI 编码工具')
  .option('-f, --force', '强制覆盖所有文件')
  .option('-c, --clean', '清理模式：先删除旧文件再安装（用于移除已删除的 skill）')
  .option('-a, --agent <agents>', '指定目标 Agent（逗号分隔，* 表示全部）')
  .option('--project', '项目级安装（当前目录）')
  .option('--legacy', '使用旧版安装模式（仅 Claude Code）')
  .option('-i, --interactive', '交互式安装模式')
  .option('-y, --yes', '跳过确认提示')
  .action(async (options) => {
    try {
      const homeDir = os.homedir();
      const templatesDir = path.join(__dirname, '..', 'templates');
      const currentVersion = pkg.version;

      // 交互式模式
      if (options.interactive || (process.stdin.isTTY && !options.agent && !options.yes && !options.legacy)) {
        await runInteractiveInstall({
          templatesDir,
          version: currentVersion,
          force: options.force,
          clean: options.clean,
        });
        return;
      }

      // 旧版模式：保持向后兼容
      if (options.legacy) {
        const claudeDir = path.join(homeDir, '.claude');
        const metaDir = path.join(claudeDir, '.claude-workflow');
        const metaFile = path.join(metaDir, 'meta.json');

        await ensureClaudeHome(claudeDir, metaDir);

        if (options.force) {
          console.log('[claude-workflow] 强制同步模式（旧版）...');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupDir = path.join(metaDir, 'backups', `force-sync-${timestamp}`);
          const results = await copyTemplatesToClaude({ templatesDir, claudeDir, overwrite: true, backupDir });
          console.log('[claude-workflow] 强制同步完成');
          if (results.backedUp.length > 0) {
            console.log(`[claude-workflow] 已备份 ${results.backedUp.length} 个冲突文件到: ${backupDir}`);
            results.backedUp.forEach(f => console.log(`  - ${f}`));
          }
        } else {
          let previousVersion = null;
          if (await fs.pathExists(metaFile)) {
            const meta = await fs.readJson(metaFile);
            previousVersion = meta.version || null;
          }

          if (!previousVersion) {
            await installFresh({ claudeDir, metaDir, templatesDir, version: currentVersion });
          } else {
            await upgradeFrom({
              fromVersion: previousVersion,
              toVersion: currentVersion,
              claudeDir,
              metaDir,
              templatesDir
            });
          }
        }

        await fs.writeJson(metaFile, {
          version: currentVersion,
          installedAt: new Date().toISOString(),
          npmPackage: pkg.name
        }, { spaces: 2 });

        console.log('[claude-workflow] sync 完成（旧版模式）');
        return;
      }

      // 新版模式：多 Agent 支持
      const global = !options.project;
      const targetAgents = parseAgentArg(options.agent);

      if (targetAgents.length === 0) {
        console.log('[claude-workflow] 未检测到已安装的 Agent，将安装到 Claude Code');
        targetAgents.push('claude-code');
      }

      console.log(`[claude-workflow] 同步到 ${targetAgents.length} 个 Agent...`);
      console.log(`  目标: ${targetAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
      console.log(`  作用域: ${global ? '全局' : '项目级'}`);
      if (options.clean) {
        console.log(`  模式: 清理安装（删除旧文件）`);
      }

      const result = await installForAgents({
        templatesDir,
        agents: targetAgents,
        global,
        cwd: process.cwd(),
        force: options.force,
        clean: options.clean,
      });

      // 输出结果
      console.log(`\n[claude-workflow] Canonical 位置: ${result.canonicalDir}`);

      if (result.canonical) {
        if (result.canonical.cleaned && result.canonical.cleaned.length > 0) {
          console.log(`  已清理: ${result.canonical.cleaned.join(', ')}`);
        }
        console.log(`  已复制: ${result.canonical.copied.join(', ') || '无'}`);
      }

      console.log('\n  Agent 状态:');
      for (const [name, agentResult] of Object.entries(result.agents)) {
        const displayName = agents[name]?.displayName || name;
        const status = agentResult.success ? '✓' : '✗';
        const mode = agentResult.links?.skills?.mode || 'unknown';
        console.log(`    ${status} ${displayName} (${mode})`);
      }

      if (result.errors.length > 0) {
        console.log('\n  错误:');
        result.errors.forEach(err => console.log(`    - ${err}`));
      }

      console.log('\n[claude-workflow] sync 完成');
    } catch (err) {
      console.error(`[claude-workflow] sync 失败: ${err.message}`);
      process.exitCode = 1;
    }
  });

// init 命令：初始化项目配置
program
  .command('init')
  .description('在当前项目中初始化 Claude 工作流配置')
  .option('-f, --force', '覆盖已存在的配置')
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const claudeDir = path.join(cwd, '.claude');
      const configDir = path.join(claudeDir, 'config');
      const configFile = path.join(configDir, 'project-config.json');

      // 检测项目信息
      const projectName = path.basename(cwd);
      const hasPackageJson = await fs.pathExists(path.join(cwd, 'package.json'));
      const hasGit = await fs.pathExists(path.join(cwd, '.git'));

      let projectType = 'unknown';
      let packageManager = 'unknown';
      let framework = 'unknown';

      if (hasPackageJson) {
        const pkgJson = await fs.readJson(path.join(cwd, 'package.json'));

        // 检测 monorepo
        if (await fs.pathExists(path.join(cwd, 'pnpm-workspace.yaml')) || pkgJson.workspaces) {
          projectType = 'monorepo';
        } else {
          projectType = 'single';
        }

        // 检测包管理器
        if (await fs.pathExists(path.join(cwd, 'pnpm-lock.yaml'))) {
          packageManager = 'pnpm';
        } else if (await fs.pathExists(path.join(cwd, 'yarn.lock'))) {
          packageManager = 'yarn';
        } else if (await fs.pathExists(path.join(cwd, 'package-lock.json'))) {
          packageManager = 'npm';
        }

        // 检测框架
        const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
        if (deps.react && deps.vue) framework = 'react+vue';
        else if (deps.react) framework = 'react';
        else if (deps.vue) framework = 'vue';
        else if (deps.next) framework = 'nextjs';
        else if (deps.nuxt) framework = 'nuxtjs';
      }

      // 检查是否已存在配置
      if (await fs.pathExists(configFile) && !options.force) {
        console.log('[claude-workflow] 配置已存在，使用 --force 覆盖');
        process.exitCode = 1;
        return;
      }

      await fs.ensureDir(configDir);

      const config = {
        $schema: 'https://json-schema.org/draft-07/schema#',
        $comment: 'Claude Code 项目配置文件',
        project: {
          name: projectName,
          type: projectType,
          rootDir: '.',
          description: '项目描述'
        },
        tech: {
          packageManager,
          framework,
          testing: {
            framework: 'vitest',
            coverage: true
          }
        },
        workflow: {
          defaultModel: 'sonnet',
          enableBKMCP: false,
          enableFigmaMCP: false
        },
        conventions: {
          commitPrefix: ['feat', 'fix', 'chore', 'refactor', 'perf', 'docs', 'style', 'test', 'revert'],
          commitFormat: 'prefix: content',
          language: 'zh-CN',
          pathAlias: '@/'
        },
        metadata: {
          version: '1.0.0',
          generatedAt: new Date().toISOString(),
          autoDetected: true
        }
      };

      await fs.writeJson(configFile, config, { spaces: 2 });

      console.log('[claude-workflow] 项目初始化完成');
      console.log(`  项目类型: ${projectType}`);
      console.log(`  包管理器: ${packageManager}`);
      console.log(`  框架: ${framework}`);
      console.log(`  配置文件: ${configFile}`);
      console.log('\n下一步:');
      console.log('  1. 编辑 .claude/config/project-config.json 完善配置');
      console.log('  2. 创建 CLAUDE.md 添加项目规范');
      console.log('  3. 开始使用工作流: /workflow start "功能描述"');

    } catch (err) {
      console.error(`[claude-workflow] init 失败: ${err.message}`);
      process.exitCode = 1;
    }
  });

// status 命令：查看安装状态
program
  .command('status')
  .description('查看工作流安装状态')
  .option('--project', '查看项目级安装状态')
  .option('-i, --interactive', '交互式状态显示')
  .action(async (options) => {
    try {
      // 交互式模式
      if (options.interactive || process.stdin.isTTY) {
        await runInteractiveStatus({
          global: !options.project,
          cwd: process.cwd(),
        });
        return;
      }

      const global = !options.project;
      const status = await getInstallationStatus(global, process.cwd());

      console.log('\n[claude-workflow] 安装状态\n');

      if (status.installed) {
        console.log(`  Canonical: ${status.canonicalDir}`);
        console.log(`  版本: v${status.version || '未知'}`);
        if (status.installedAt) {
          console.log(`  安装时间: ${status.installedAt}`);
        }
        console.log(`  当前包版本: v${pkg.version}`);

        if (status.version && semver.lt(status.version, pkg.version)) {
          console.log(`\n  [提示] 有新版本可用，运行 claude-workflow sync 更新`);
        }

        console.log('\n  Agent 状态:');
        for (const [name, agentStatus] of Object.entries(status.agents)) {
          const displayName = agents[name]?.displayName || name;
          let statusIcon = '  ';
          let statusText = '';

          if (agentStatus.installed) {
            if (agentStatus.valid) {
              statusIcon = '✓';
              statusText = `(${agentStatus.mode})`;
            } else {
              statusIcon = '!';
              statusText = '(symlink 断开)';
            }
          } else if (agentStatus.detected) {
            statusIcon = '○';
            statusText = '(未安装)';
          } else {
            statusIcon = '✗';
            statusText = '(未检测到)';
          }

          console.log(`    ${statusIcon} ${displayName.padEnd(16)} ${statusText}`);
        }
      } else {
        console.log('  状态: 未安装');
        console.log('  运行 npm install @pic/claude-workflow 安装');

        // 检查旧版安装
        const homeDir = os.homedir();
        const oldMetaFile = path.join(homeDir, '.claude', '.claude-workflow', 'meta.json');
        if (await fs.pathExists(oldMetaFile)) {
          console.log('\n  [提示] 检测到旧版安装，运行 claude-workflow sync 迁移到新架构');
        }
      }

      // 检测已安装的 Agent
      const detectedAgents = detectInstalledAgents();
      if (detectedAgents.length > 0) {
        console.log(`\n  检测到的 Agent: ${detectedAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
      }

      console.log('');

    } catch (err) {
      console.error(`[claude-workflow] status 失败: ${err.message}`);
      process.exitCode = 1;
    }
  });

// doctor 命令：诊断问题
program
  .command('doctor')
  .description('诊断工作流配置问题')
  .option('--project', '诊断项目级安装')
  .action(async (options) => {
    try {
      const global = !options.project;
      const homeDir = os.homedir();
      const issues = [];
      const ok = [];

      console.log('\n[claude-workflow] 诊断中...\n');

      // 检查 canonical 目录
      const canonicalDir = getCanonicalDir(global, process.cwd());
      if (await fs.pathExists(canonicalDir)) {
        ok.push(`Canonical 目录存在: ${canonicalDir}`);

        // 检查必要子目录
        for (const dir of SYMLINK_DIRS) {
          const dirPath = path.join(canonicalDir, dir);
          if (await fs.pathExists(dirPath)) {
            const files = await fs.readdir(dirPath);
            if (files.length > 0) {
              ok.push(`${dir}/ 目录正常 (${files.length} 个文件)`);
            } else {
              issues.push(`${dir}/ 目录为空`);
            }
          } else {
            issues.push(`${dir}/ 目录不存在`);
          }
        }

        // 检查元信息
        const metaFile = path.join(canonicalDir, '.meta', 'meta.json');
        if (await fs.pathExists(metaFile)) {
          ok.push('元信息文件存在');
        } else {
          issues.push('元信息文件不存在');
        }
      } else {
        issues.push(`Canonical 目录不存在: ${canonicalDir}`);
      }

      // 检查各 Agent 的 symlink 状态
      const status = await getInstallationStatus(global, process.cwd());
      const installedAgents = Object.entries(status.agents).filter(([_, s]) => s.installed);
      const brokenLinks = installedAgents.filter(([_, s]) => s.mode === 'symlink' && !s.valid);

      if (installedAgents.length > 0) {
        ok.push(`已安装到 ${installedAgents.length} 个 Agent`);
      }

      if (brokenLinks.length > 0) {
        brokenLinks.forEach(([name, s]) => {
          issues.push(`${agents[name]?.displayName || name}: symlink 断开 (${s.target})`);
        });
      }

      // 检查旧版安装
      const oldClaudeDir = path.join(homeDir, '.claude');
      const oldMetaFile = path.join(oldClaudeDir, '.claude-workflow', 'meta.json');
      if (await fs.pathExists(oldMetaFile)) {
        // 检查是否已迁移
        const skillsDir = path.join(oldClaudeDir, 'skills');
        if (await fs.pathExists(skillsDir)) {
          const stats = await fs.lstat(skillsDir);
          if (!stats.isSymbolicLink()) {
            issues.push('检测到旧版安装，建议运行 claude-workflow sync 迁移');
          }
        }
      }

      // 输出结果
      if (ok.length > 0) {
        console.log('  ✅ 正常:');
        ok.forEach(item => console.log(`     - ${item}`));
      }

      if (issues.length > 0) {
        console.log('\n  ❌ 问题:');
        issues.forEach(item => console.log(`     - ${item}`));
        console.log('\n  建议运行: claude-workflow sync --force');
      } else {
        console.log('\n  所有检查通过!');
      }

      console.log('');

    } catch (err) {
      console.error(`[claude-workflow] doctor 失败: ${err.message}`);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);

} // end of else block (有参数时执行命令)
