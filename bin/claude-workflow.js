#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const semver = require('semver');

const pkg = require('../package.json');
const { ensureClaudeHome, installFresh, upgradeFrom, copyTemplatesToClaude } = require('../lib/installer');

const program = new Command();

program
  .name('claude-workflow')
  .description('Claude Code 工作流工具包管理器')
  .version(pkg.version);

// sync 命令：同步模板到 ~/.claude
program
  .command('sync')
  .description('同步工作流模板到 ~/.claude')
  .option('-f, --force', '强制覆盖所有文件')
  .action(async (options) => {
    try {
      const homeDir = os.homedir();
      const claudeDir = path.join(homeDir, '.claude');
      const metaDir = path.join(claudeDir, '.claude-workflow');
      const metaFile = path.join(metaDir, 'meta.json');
      const templatesDir = path.join(__dirname, '..', 'templates');
      const currentVersion = pkg.version;

      await ensureClaudeHome(claudeDir, metaDir);

      if (options.force) {
        console.log('[claude-workflow] 强制同步模式...');
        await copyTemplatesToClaude({ templatesDir, claudeDir, overwrite: true });
        console.log('[claude-workflow] 强制同步完成');
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

      console.log('[claude-workflow] sync 完成');
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
      console.log('  3. 开始使用工作流: /workflow-start "功能描述"');

    } catch (err) {
      console.error(`[claude-workflow] init 失败: ${err.message}`);
      process.exitCode = 1;
    }
  });

// status 命令：查看安装状态
program
  .command('status')
  .description('查看工作流安装状态')
  .action(async () => {
    try {
      const homeDir = os.homedir();
      const claudeDir = path.join(homeDir, '.claude');
      const metaDir = path.join(claudeDir, '.claude-workflow');
      const metaFile = path.join(metaDir, 'meta.json');

      console.log('\n[claude-workflow] 安装状态\n');

      if (await fs.pathExists(metaFile)) {
        const meta = await fs.readJson(metaFile);
        console.log(`  已安装版本: v${meta.version}`);
        console.log(`  安装时间: ${meta.installedAt}`);
        console.log(`  当前包版本: v${pkg.version}`);

        if (semver.lt(meta.version, pkg.version)) {
          console.log(`\n  [提示] 有新版本可用，运行 npm update @pic/claude-workflow 更新`);
        }
      } else {
        console.log('  状态: 未安装');
        console.log('  运行 npm install @pic/claude-workflow 安装');
      }

      // 检查文件数量
      const dirs = ['commands', 'agents', 'docs', 'utils'];
      console.log('\n  文件统计:');
      for (const dir of dirs) {
        const dirPath = path.join(claudeDir, dir);
        if (await fs.pathExists(dirPath)) {
          const files = await fs.readdir(dirPath);
          console.log(`    ${dir}: ${files.length} 个文件`);
        }
      }

      console.log(`\n  安装位置: ${claudeDir}\n`);

    } catch (err) {
      console.error(`[claude-workflow] status 失败: ${err.message}`);
      process.exitCode = 1;
    }
  });

// doctor 命令：诊断问题
program
  .command('doctor')
  .description('诊断工作流配置问题')
  .action(async () => {
    try {
      const homeDir = os.homedir();
      const claudeDir = path.join(homeDir, '.claude');
      const issues = [];
      const ok = [];

      console.log('\n[claude-workflow] 诊断中...\n');

      // 检查 ~/.claude 目录
      if (await fs.pathExists(claudeDir)) {
        ok.push('~/.claude 目录存在');
      } else {
        issues.push('~/.claude 目录不存在');
      }

      // 检查必要子目录
      const requiredDirs = ['commands', 'agents'];
      for (const dir of requiredDirs) {
        const dirPath = path.join(claudeDir, dir);
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
      const metaFile = path.join(claudeDir, '.claude-workflow', 'meta.json');
      if (await fs.pathExists(metaFile)) {
        ok.push('元信息文件存在');
      } else {
        issues.push('元信息文件不存在，可能需要重新安装');
      }

      // 输出结果
      if (ok.length > 0) {
        console.log('  ✅ 正常:');
        ok.forEach(item => console.log(`     - ${item}`));
      }

      if (issues.length > 0) {
        console.log('\n  ❌ 问题:');
        issues.forEach(item => console.log(`     - ${item}`));
        console.log('\n  建议运行: npx claude-workflow sync --force');
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
