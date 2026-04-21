#!/usr/bin/env node
/** @file agent-workflow CLI 主入口，提供 sync / link / init / status / doctor 等子命令 */

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
  installForAgents,
  linkRepoToAgents,
  getInstallationStatus,
  MANAGED_DIRS,
  COMMANDS_DIR,
  SKILLS_DIR,
  INSTALL_MODE_REPO_LINK,
} = require('../lib/installer');
const {
  agents,
  detectInstalledAgents,
  getCanonicalDir,
  parseAgentArg,
} = require('../lib/agents');
const {
  runInteractiveInstall,
  runInteractiveStatus,
} = require('../lib/interactive-installer');

const CLI_NAME = 'agent-workflow';
const LOG_PREFIX = '[agent-workflow]';
const APP_DISPLAY_NAME = 'Agent Workflow';
const LEGACY_META_DIR = '.claude-workflow';

/**
 * 将 hook 注册结果格式化为可读字符串
 * @param {object|null} result - hook 操作返回的结果对象
 * @param {string} [fallbackMessage='未注册'] - result 为空时的默认提示
 * @returns {string} 格式化后的状态描述
 */
function formatHookResult(result, fallbackMessage = '未注册') {
  if (!result) return fallbackMessage;
  if (result.error) return `异常: ${result.error}`;
  if (result.injected) return `已注册: ${(result.events || []).join(', ')}`;
  if ((result.skipped || []).length > 0 && result.skipped.every((item) => String(item).includes('已注册'))) {
    return `已注册: ${(result.skipped || []).join(', ')}`;
  }
  return `未注册: ${((result.skipped || ['无']).join('; '))}`;
}

/**
 * 将 hook 检查摘要格式化为可读字符串
 * @param {object|null} summary - hook 检查摘要，包含 complete / configured / issues 等字段
 * @param {object} [options] - 选项
 * @param {boolean} [options.optional=false] - 是否为可选 hook，影响未检测时的提示文案
 * @returns {string} 格式化后的检查状态
 */
function formatHookInspection(summary, { optional = false } = {}) {
  if (!summary) return optional ? '未检测（可选）' : '未检测';
  if (summary.complete) return '已注册';
  if (summary.configured) return `异常: ${(summary.issues || []).join('; ')}`;
  return optional ? '未注册（可选）' : '未注册';
}

/**
 * 将 Agent 文件同步结果格式化为可读字符串
 * @param {object|null} result - 文件同步结果，包含 synced / count / error / issues 等字段
 * @param {string} [fallbackMessage='未检测'] - result 为空时的默认提示
 * @returns {string} 格式化后的同步状态
 */
function formatAgentFilesResult(result, fallbackMessage = '未检测') {
  if (!result) return fallbackMessage;
  if (result.synced) return `已同步 (${result.count} 个)`;
  const detail = result.error || (result.issues || []).join('; ') || '未知错误';
  return `异常: ${detail}`;
}

if (process.argv.length === 2) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { run } = require('../lib/menu');
    run();
  } else {
    console.log(`${APP_DISPLAY_NAME} v${pkg.version}`);
    console.log(`\n使用: ${CLI_NAME} <command>\n`);
    console.log('可用命令:');
    console.log('  sync     同步 Skills 到 AI 编码工具');
    console.log('  init     初始化项目配置');
    console.log('  status   查看安装状态');
    console.log('  doctor   诊断配置问题');
    console.log('\n示例:');
    console.log(`  ${CLI_NAME} sync`);
    console.log(`  ${CLI_NAME} sync -a claude-code,cursor`);
  }
} else {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description('多 AI 编码工具通用工作流系统 - Skills 架构')
    .version(pkg.version);

  program
    .command('sync')
    .description('同步工作流模板到 AI 编码工具')
    .option('-a, --agent <agents>', '指定目标 Agent（逗号分隔，* 表示全部）')
    .option('--project', '项目级安装（当前目录）')
    .option('--legacy', '使用旧版安装模式（仅 Claude Code）')
    .option('-i, --interactive', '交互式安装模式')
    .option('-y, --yes', '跳过确认提示')

    .action(async (options) => {
      try {
        const repoRoot = path.join(__dirname, '..');
        const currentVersion = pkg.version;

        if (options.interactive || (process.stdin.isTTY && !options.agent && !options.yes && !options.legacy)) {
          await runInteractiveInstall({ templatesDir: repoRoot });
          return;
        }

        if (options.legacy) {
          const claudeDir = path.join(homeDir, '.claude');
          const metaDir = path.join(claudeDir, LEGACY_META_DIR);
          const metaFile = path.join(metaDir, 'meta.json');

          await ensureClaudeHome(claudeDir, metaDir);

          let previousVersion = null;
          if (await fs.pathExists(metaFile)) {
            const meta = await fs.readJson(metaFile);
            previousVersion = meta.version || null;
          }

          if (!previousVersion) {
            await installFresh({ claudeDir, metaDir, templatesDir: repoRoot, version: currentVersion });
          } else {
            await upgradeFrom({
              fromVersion: previousVersion,
              toVersion: currentVersion,
              claudeDir,
              metaDir,
              templatesDir: repoRoot,
            });
          }

          await fs.writeJson(metaFile, {
            version: currentVersion,
            installedAt: new Date().toISOString(),
            npmPackage: pkg.name,
          }, { spaces: 2 });

          console.log(`${LOG_PREFIX} sync 完成（旧版模式）`);
          return;
        }

        const global = !options.project;
        const targetAgents = parseAgentArg(options.agent);

        if (targetAgents.length === 0) {
          console.log(`${LOG_PREFIX} 未检测到已安装的 Agent，将安装到 Claude Code`);
          targetAgents.push('claude-code');
        }

        console.log(`${LOG_PREFIX} 同步到 ${targetAgents.length} 个 Agent...`);
        console.log(`  目标: ${targetAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
        console.log(`  作用域: ${global ? '全局' : '项目级'}`);

        const result = await installForAgents({
          templatesDir: repoRoot,
          agents: targetAgents,
          global,
          cwd: process.cwd(),

        });

        console.log(`\n${LOG_PREFIX} Canonical 位置: ${result.canonicalDir}`);

        if (result.canonical) {
          console.log(`  已复制: ${result.canonical.copied.join(', ') || '无'}`);
        }

        console.log('\n  Agent 状态:');
        for (const [name, agentResult] of Object.entries(result.agents)) {
          const displayName = agents[name]?.displayName || name;
          const status = agentResult.success ? '✓' : '✗';
          const mode = agentResult.skills?.rootMode || 'unknown';
          console.log(`    ${status} ${displayName} (${mode})`);
          if (agentResult.workflowHooks) {
            console.log(`      workflow hooks -> ${formatHookResult(agentResult.workflowHooks)}`);
          }
          if (agentResult.agentFiles) {
            console.log(`      subagent 文件 -> ${formatAgentFilesResult(agentResult.agentFiles)}`);
          }
        }

        if (result.errors.length > 0) {
          console.log('\n  错误:');
          result.errors.forEach(err => console.log(`    - ${err}`));
        }

        console.log(`\n${LOG_PREFIX} sync 完成`);
      } catch (err) {
        console.error(`${LOG_PREFIX} sync 失败: ${err.message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('link')
    .description('将受管目录直接链接到当前仓库，便于本地调试 skills')
    .option('-a, --agent <agents>', '指定目标 Agent（逗号分隔，* 表示全部）')
    .option('--project', '项目级安装（当前目录）')

    .action(async (options) => {
      try {
        const repoRoot = path.join(__dirname, '..');
        const global = !options.project;
        const targetAgents = parseAgentArg(options.agent);

        if (targetAgents.length === 0) {
          console.log(`${LOG_PREFIX} 未检测到已安装的 Agent，将安装到 Claude Code`);
          targetAgents.push('claude-code');
        }

        console.log(`${LOG_PREFIX} 链接到 ${targetAgents.length} 个 Agent...`);
        console.log(`  目标: ${targetAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
        console.log(`  作用域: ${global ? '全局' : '项目级'}`);
        console.log(`  源目录: ${path.join(repoRoot, 'core')}`);

        const result = await linkRepoToAgents({
          templatesDir: repoRoot,
          agents: targetAgents,
          global,
          cwd: process.cwd(),

        });

        console.log(`\n${LOG_PREFIX} Canonical 位置: ${result.canonicalDir}`);
        console.log(`  模式: ${result.mode}`);
        console.log(`  Source: ${result.sourceRoot}`);

        console.log('\n  Agent 状态:');
        for (const [name, agentResult] of Object.entries(result.agents)) {
          const displayName = agents[name]?.displayName || name;
          const status = agentResult.success ? '✓' : '✗';
          const mode = agentResult.skills?.rootMode || 'unknown';
          console.log(`    ${status} ${displayName} (${mode})`);
          if (agentResult.workflowHooks) {
            console.log(`      workflow hooks -> ${formatHookResult(agentResult.workflowHooks)}`);
          }
          if (agentResult.agentFiles) {
            console.log(`      subagent 文件 -> ${formatAgentFilesResult(agentResult.agentFiles)}`);
          }
        }

        if (result.errors.length > 0) {
          console.log('\n  错误:');
          result.errors.forEach(err => console.log(`    - ${err}`));
        }

        console.log(`\n${LOG_PREFIX} link 完成`);
      } catch (err) {
        console.error(`${LOG_PREFIX} link 失败: ${err.message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('init')
    .description('在当前项目中初始化 Agent Workflow 配置')
    .option('-f, --force', '覆盖已存在的配置')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const claudeDir = path.join(cwd, '.claude');
        const configDir = path.join(claudeDir, 'config');
        const configFile = path.join(configDir, 'project-config.json');

        const projectName = path.basename(cwd);
        const hasPackageJson = await fs.pathExists(path.join(cwd, 'package.json'));

        let projectType = 'unknown';
        let packageManager = 'unknown';
        let framework = 'unknown';

        if (hasPackageJson) {
          const pkgJson = await fs.readJson(path.join(cwd, 'package.json'));

          if (await fs.pathExists(path.join(cwd, 'pnpm-workspace.yaml')) || pkgJson.workspaces) {
            projectType = 'monorepo';
          } else {
            projectType = 'single';
          }

          if (await fs.pathExists(path.join(cwd, 'pnpm-lock.yaml'))) {
            packageManager = 'pnpm';
          } else if (await fs.pathExists(path.join(cwd, 'yarn.lock'))) {
            packageManager = 'yarn';
          } else if (await fs.pathExists(path.join(cwd, 'package-lock.json'))) {
            packageManager = 'npm';
          }

          const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
          if (deps.react && deps.vue) framework = 'react+vue';
          else if (deps.react) framework = 'react';
          else if (deps.vue) framework = 'vue';
          else if (deps.next) framework = 'nextjs';
          else if (deps.nuxt) framework = 'nuxtjs';
        }

        if (await fs.pathExists(configFile) && !options.force) {
          console.log(`${LOG_PREFIX} 配置已存在，使用 --force 覆盖`);
          process.exitCode = 1;
          return;
        }

        await fs.ensureDir(configDir);

        const config = {
          $schema: 'https://json-schema.org/draft-07/schema#',
          $comment: 'Agent Workflow 项目配置文件',
          project: {
            name: projectName,
            type: projectType,
            rootDir: '.',
            description: '项目描述',
          },
          tech: {
            packageManager,
            framework,
            testing: {
              framework: 'vitest',
              coverage: true,
            },
          },
          workflow: {
            defaultModel: 'sonnet',
            enableBKMCP: false,
            enableFigmaMCP: false,
            bkProjectId: '',
          },
          conventions: {
            commitPrefix: ['feat', 'fix', 'chore', 'refactor', 'perf', 'docs', 'style', 'test', 'revert'],
            commitFormat: 'prefix: content',
            language: 'zh-CN',
            pathAlias: '@/',
          },
          metadata: {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            autoDetected: true,
          },
        };

        await fs.writeJson(configFile, config, { spaces: 2 });

        console.log(`${LOG_PREFIX} 项目初始化完成`);
        console.log(`  项目类型: ${projectType}`);
        console.log(`  包管理器: ${packageManager}`);
        console.log(`  框架: ${framework}`);
        console.log(`  配置文件: ${configFile}`);
        console.log('\n下一步:');
        console.log('  1. 编辑 .claude/config/project-config.json 完善配置');
        console.log('  2. 创建 CLAUDE.md 添加项目规范');
        console.log('  3. 开始使用工作流: /workflow start "功能描述"');
      } catch (err) {
        console.error(`${LOG_PREFIX} init 失败: ${err.message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('status')
    .description('查看工作流安装状态')
    .option('--project', '查看项目级安装状态')
    .option('-i, --interactive', '交互式状态显示')
    .action(async (options) => {
      try {
        if (options.interactive || process.stdin.isTTY) {
          await runInteractiveStatus({
            global: !options.project,
            cwd: process.cwd(),
          });
          return;
        }

        const global = !options.project;
        const status = await getInstallationStatus(global, process.cwd());

        console.log(`\n${LOG_PREFIX} 安装状态\n`);

        if (status.installed) {
          console.log(`  Canonical: ${status.canonicalDir}`);
          console.log(`  模式: ${status.mode}`);
          console.log(`  Source: ${status.sourceRoot}`);
          console.log(`  版本: v${status.version || '未知'}`);
          if (status.installedAt) {
            console.log(`  安装时间: ${status.installedAt}`);
          }
          console.log(`  当前包版本: v${pkg.version}`);

          if (status.version && semver.lt(status.version, pkg.version)) {
            console.log(`\n  [提示] 有新版本可用，运行 ${CLI_NAME} sync 更新`);
          }

          console.log('\n  Agent 状态:');
          for (const [name, agentStatus] of Object.entries(status.agents)) {
            const displayName = agents[name]?.displayName || name;
            let statusIcon = '  ';
            let statusText = '';

            if (agentStatus.installed) {
              if (agentStatus.valid) {
                statusIcon = '✓';
                statusText = `(${agentStatus.mode}, ${agentStatus.skillCount}/${Object.keys(agentStatus.skills).length} skills)`;
              } else {
                statusIcon = '!';
                const brokenSummary = agentStatus.brokenSkills.length > 0
                  ? `skills 异常: ${agentStatus.brokenSkills.join(', ')}`
                  : agentStatus.brokenCommands.length > 0
                    ? `commands 异常: ${agentStatus.brokenCommands.join(', ')}`
                    : agentStatus.managedDirIssues.length > 0
                      ? `受管目录异常: ${agentStatus.managedDirIssues.join(', ')}`
                      : agentStatus.agentFiles && !agentStatus.agentFiles.synced
                        ? `subagent 异常: ${(agentStatus.agentFiles.issues || ['未同步']).join(', ')}`
                      : '安装异常';
                statusText = `(${brokenSummary})`;
              }
            } else if (agentStatus.detected) {
              statusIcon = '○';
              statusText = '(未安装)';
            } else {
              statusIcon = '✗';
              statusText = '(未检测到)';
            }

            console.log(`    ${statusIcon} ${displayName.padEnd(16)} ${statusText}`);
            if (name === 'claude-code') {
              const hooksInstalled = agentStatus.managedDirs?.hooks?.installed === true;
              console.log(`      hooks managed dir -> ${hooksInstalled ? '已同步' : '未同步'}`);
              if (global) {
                console.log(`      workflow hooks -> ${formatHookInspection(agentStatus.workflowHooks)}`);
              } else {
                console.log('      hooks 注册 -> 项目级安装不修改 settings.json');
              }
              if (agentStatus.agentFiles) {
                const af = agentStatus.agentFiles;
                console.log(`      subagent 文件 -> ${formatAgentFilesResult(af)}`);
              }
            }
          }
        } else {
          console.log('  状态: 未安装');
          console.log(`  运行 npm install ${pkg.name} 安装`);

          const homeDir = os.homedir();
          const oldMetaFile = path.join(homeDir, '.claude', LEGACY_META_DIR, 'meta.json');
          if (await fs.pathExists(oldMetaFile)) {
            console.log(`\n  [提示] 检测到旧版安装，运行 ${CLI_NAME} sync 迁移到新架构`);
          }
        }

        const detectedAgents = detectInstalledAgents();
        if (detectedAgents.length > 0) {
          console.log(`\n  检测到的 Agent: ${detectedAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
        }

        console.log('');
      } catch (err) {
        console.error(`${LOG_PREFIX} status 失败: ${err.message}`);
        process.exitCode = 1;
      }
    });

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

        console.log(`\n${LOG_PREFIX} 诊断中...\n`);

        const status = await getInstallationStatus(global, process.cwd());
        const isRepoLinkMode = status.mode === INSTALL_MODE_REPO_LINK;
        const sourceRoot = status.sourceRoot;
        const sourceDirs = [COMMANDS_DIR, SKILLS_DIR, ...MANAGED_DIRS];
        const canonicalRoot = sourceRoot;
        const installedAgents = Object.entries(status.agents).filter(([_, s]) => s.installed);

        if (await fs.pathExists(canonicalRoot)) {
          ok.push(`${isRepoLinkMode ? 'Repo link 源' : 'Canonical package root'}存在: ${canonicalRoot}`);

          for (const dir of sourceDirs) {
            const dirPath = path.join(canonicalRoot, dir);
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
        } else {
          issues.push(`${isRepoLinkMode ? 'Repo link 源' : 'Canonical package root'}不存在: ${canonicalRoot}`);
        }

        const metaFile = path.join(getCanonicalDir(global, process.cwd()), '.meta', 'meta.json');
        if (await fs.pathExists(metaFile)) {
          ok.push('元信息文件存在');
        } else {
          issues.push('元信息文件不存在');
        }

        if (installedAgents.length > 0) {
          ok.push(`已安装到 ${installedAgents.length} 个 Agent`);
        }

        for (const [name, agentStatus] of installedAgents) {
          if (agentStatus.brokenSkills.length > 0) {
            issues.push(`${agents[name]?.displayName || name}: skills 异常 (${agentStatus.brokenSkills.join(', ')})`);
          }
          if (agentStatus.brokenCommands.length > 0) {
            issues.push(`${agents[name]?.displayName || name}: commands 异常 (${agentStatus.brokenCommands.join(', ')})`);
          }
          if (agentStatus.managedDirIssues.length > 0) {
            issues.push(`${agents[name]?.displayName || name}: 受管目录异常 (${agentStatus.managedDirIssues.join(', ')})`);
          }
          if (!agentStatus.skillsRoot.valid) {
            issues.push(`${agents[name]?.displayName || name}: skills 根目录异常 (${agentStatus.skillsRoot.path})`);
          }
          if (!agentStatus.commandsRoot.valid && agentStatus.commandsRoot.mode) {
            issues.push(`${agents[name]?.displayName || name}: commands 命名空间异常 (${agentStatus.commandsRoot.path})`);
          }
          if (!agentStatus.managedRoot.valid && agentStatus.managedRoot.mode) {
            issues.push(`${agents[name]?.displayName || name}: 受管根目录异常 (${agentStatus.managedRoot.path})`);
          }
          if (name === 'claude-code') {
            if (!global) {
              ok.push('Claude Code: 项目级安装按契约跳过 hooks 注册检查');
            } else {
              if (!agentStatus.workflowHooks?.complete) {
                issues.push(`Claude Code: workflow hooks 未完整注册 (${(agentStatus.workflowHooks?.issues || ['未注册']).join('; ')})`);
              } else {
                ok.push('Claude Code: workflow hooks 已注册');
              }

              if (agentStatus.agentFiles) {
                if (agentStatus.agentFiles.synced) {
                  ok.push(`Claude Code: subagent 文件已同步 (${agentStatus.agentFiles.count} 个)`);
                } else {
                  issues.push(`Claude Code: subagent 文件异常 (${(agentStatus.agentFiles.issues || ['未同步']).join('; ')})`);
                }
              } else {
                issues.push('Claude Code: subagent 文件未检测到');
              }
            }
          }
        }

        const oldClaudeDir = path.join(homeDir, '.claude');
        const oldMetaFile = path.join(oldClaudeDir, LEGACY_META_DIR, 'meta.json');
        if (await fs.pathExists(oldMetaFile)) {
          const skillsDir = path.join(oldClaudeDir, 'skills');
          if (await fs.pathExists(skillsDir)) {
            const stats = await fs.lstat(skillsDir);
            if (!stats.isSymbolicLink()) {
              issues.push(`检测到旧版安装，建议运行 ${CLI_NAME} sync 迁移`);
            }
          }
        }

        if (ok.length > 0) {
          console.log('  ✅ 正常:');
          ok.forEach(item => console.log(`     - ${item}`));
        }

        if (issues.length > 0) {
          console.log('\n  ❌ 问题:');
          issues.forEach(item => console.log(`     - ${item}`));
          console.log(`\n  建议运行: ${isRepoLinkMode ? `${CLI_NAME} link` : `${CLI_NAME} sync`}`);
        } else {
          console.log('\n  所有检查通过!');
        }

        console.log('');
      } catch (err) {
        console.error(`${LOG_PREFIX} doctor 失败: ${err.message}`);
        process.exitCode = 1;
      }
    });

  program.parse(process.argv);
}
