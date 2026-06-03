#!/usr/bin/env node
/** @file agent-workflow CLI 主入口，提供 sync / link / init / status / doctor 等子命令 */

const { Command } = require('commander');
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const semver = require('semver');

const pkg = require('../package.json');
const {
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
} = require('../lib/agents');
const {
  runInteractiveInstall,
  runInteractiveStatus,
} = require('../lib/interactive-installer');
const claudeCodePlugin = require('../lib/claude-code-plugin');
const qoderPlugin = require('../lib/qoder-plugin');
const antigravityPlugin = require('../lib/antigravity-plugin');
const { syncAgentMemories } = require('../lib/memory-sync');

/**
 * 把目标 agent 列表拆成 [claude-code-targets, other-targets]。
 * Claude Code 走 Plugin 分支；其他 8 个工具走 installer。
 */
function partitionAgents(targetAgents) {
  const ccTargets = [];
  const qoderTargets = [];
  const antigravityTargets = [];
  const otherTargets = [];
  for (const name of targetAgents) {
    if (name === 'claude-code') ccTargets.push(name);
    else if (name === 'qoder') qoderTargets.push(name);
    else if (name === 'antigravity') antigravityTargets.push(name);
    else otherTargets.push(name);
  }
  return { ccTargets, qoderTargets, antigravityTargets, otherTargets };
}

/**
 * 打印 Claude Code Plugin 安装结果。
 */
function printPluginResult(ccResult) {
  if (!ccResult) return;
  if (ccResult.success) {
    console.log(`    ✓ Claude Code (via Plugin)`);
    return;
  }
  const reasonMap = {
    'cli-not-found': '未检测到 claude CLI，已打印手动指引',
    'marketplace-add-failed': 'marketplace add 失败',
    'install-failed': 'plugin install 失败',
    'cleanup-declined': '用户跳过了残留清理',
  };
  const reason = reasonMap[ccResult.reason] || ccResult.reason || '未知原因';
  console.log(`    ✗ Claude Code (via Plugin): ${reason}`);
}

/**
 * 打印 Qoder Plugin 安装结果。
 */
function printQoderPluginResult(qoderResult) {
  if (!qoderResult) return;
  if (qoderResult.success) {
    console.log(`    ✓ Qoder (via Plugin)`);
    return;
  }
  const reasonMap = {
    'cli-not-found': '未检测到 qodercli CLI，已打印手动指引',
    'install-failed': 'plugin install 失败',
  };
  const reason = reasonMap[qoderResult.reason] || qoderResult.reason || '未知原因';
  console.log(`    ✗ Qoder (via Plugin): ${reason}`);
}

/**
 * 打印 Antigravity Plugin 安装结果。
 */
function printAntigravityPluginResult(antigravityResult) {
  if (!antigravityResult) return;
  if (antigravityResult.success) {
    console.log(`    ✓ Antigravity (via Plugin)`);
    return;
  }
  const reasonMap = {
    'cli-not-found': '未检测到 agy CLI，已打印手动指引',
    'install-failed': 'plugin install 失败',
  };
  const reason = reasonMap[antigravityResult.reason] || antigravityResult.reason || '未知原因';
  console.log(`    ✗ Antigravity (via Plugin): ${reason}`);
}

/**
 * 打印 agent memory 文件分发结果（syncAgentMemories 的返回）。
 */
function printMemoryResults(records) {
  if (!records || records.length === 0) return;
  console.log(`\n  Agent memory:`);
  for (const { agent, source, result } of records) {
    const displayName = agents[agent]?.displayName || agent;
    if (result.skipped) {
      if (result.reason === 'source-not-found') {
        console.log(`    ⚠ ${displayName}: 源 ${source} 缺失，跳过`);
      } else {
        console.log(`    = ${displayName}: ${source} 已是最新`);
      }
      continue;
    }
    const verb = result.action === 'create' ? '已写入' : '已更新';
    const bak = result.backup ? `（旧版备份 ${path.basename(result.backup)}）` : '';
    console.log(`    ✓ ${displayName}: ${source} ${verb} → ${result.destPath}${bak}`);
  }
}

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
    console.log('  update   更新到最新版本并重新同步（全局安装）');
    console.log('  init     初始化项目配置');
    console.log('  status   查看安装状态');
    console.log('  doctor   诊断配置问题');
    console.log('\n示例:');
    console.log(`  ${CLI_NAME} sync`);
    console.log(`  ${CLI_NAME} update`);
    console.log(`  ${CLI_NAME} sync --project`);
  }
} else {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description('多 AI 编码工具通用工作流系统 - Skills 架构')
    .version(pkg.version);

  program
    .command('sync')
    .description('同步工作流模板到所有已检测到的 AI 编码工具')
    .option('--project', '项目级安装（当前目录）')
    .option('-i, --interactive', '交互式安装模式')
    .option('-y, --yes', '跳过确认提示')

    .action(async (options) => {
      try {
        const repoRoot = path.join(__dirname, '..');

        if (options.interactive || (process.stdin.isTTY && !options.yes)) {
          await runInteractiveInstall({ templatesDir: repoRoot });
          return;
        }

        const global = !options.project;
        let targetAgents = detectInstalledAgents();

        // CI / 容器环境跳过 Claude Code Plugin 自动安装
        if (process.env.AGENT_WORKFLOW_SKIP_CC_PLUGIN === '1' && targetAgents.includes('claude-code')) {
          console.log(`${LOG_PREFIX} AGENT_WORKFLOW_SKIP_CC_PLUGIN=1 已设置，跳过 Claude Code Plugin 分支`);
          targetAgents = targetAgents.filter(a => a !== 'claude-code');
        }

        if (targetAgents.length === 0) {
          console.log(`${LOG_PREFIX} 未检测到任何支持的 AI 编码工具`);
          console.log('  请先安装 Claude Code / Cursor / Codex / GitHub Copilot / OpenCode / Antigravity / Droid 中的任一个');
          return;
        }

        const { ccTargets, qoderTargets, antigravityTargets, otherTargets } = partitionAgents(targetAgents);

        console.log(`${LOG_PREFIX} 同步到 ${targetAgents.length} 个 Agent...`);
        console.log(`  目标: ${targetAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
        console.log(`  作用域: ${global ? '全局' : '项目级'}`);

        let installResult = null;
        let ccResult = null;
        let qoderResult = null;
        let antigravityResult = null;

        // installer-mount 类工具：走 installer；同时会触发 ensureCanonicalInstalled 把 marketplace.json 复制到 canonical
        if (otherTargets.length > 0) {
          installResult = await installForAgents({
            templatesDir: repoRoot,
            agents: otherTargets,
            global,
            cwd: process.cwd(),
          });

          console.log(`\n${LOG_PREFIX} Canonical 位置: ${installResult.canonicalDir}`);
          if (installResult.canonical) {
            console.log(`  已复制: ${installResult.canonical.copied.join(', ') || '无'}`);
          }

          console.log('\n  Agent 状态:');
          for (const [name, agentResult] of Object.entries(installResult.agents)) {
            const displayName = agents[name]?.displayName || name;
            const status = agentResult.success ? '✓' : '✗';
            const mode = agentResult.skills?.rootMode || 'unknown';
            console.log(`    ${status} ${displayName} (${mode})`);
          }

          if (installResult.errors.length > 0) {
            console.log('\n  错误:');
            installResult.errors.forEach(err => console.log(`    - ${err}`));
          }
        }

        // Claude Code：Plugin 分支
        if (ccTargets.length > 0) {
          const canonicalDir = getCanonicalDir(global, process.cwd());
          // 如果 otherTargets 为空，installer 没触发过 ensureCanonicalInstalled，需要手动确保
          if (otherTargets.length === 0) {
            await installForAgents({
              templatesDir: repoRoot,
              agents: [],
              global,
              cwd: process.cwd(),
            });
          }

          console.log(`\n  Claude Code Plugin:`);
          ccResult = await claudeCodePlugin.ensurePluginInstalled({
            canonicalDir,
            options: { yes: options.yes, dryRun: options.dryRun },
          });
          printPluginResult(ccResult);
        }

        // Qoder：Plugin 分支（与 Claude Code 同款机制）
        if (qoderTargets.length > 0) {
          const canonicalDir = getCanonicalDir(global, process.cwd());
          // 若 otherTargets 与 ccTargets 都为空，前面没触发过 ensureCanonicalInstalled，需手动确保
          if (otherTargets.length === 0 && ccTargets.length === 0) {
            await installForAgents({
              templatesDir: repoRoot,
              agents: [],
              global,
              cwd: process.cwd(),
            });
          }

          console.log(`\n  Qoder Plugin:`);
          qoderResult = await qoderPlugin.ensureQoderPluginInstalled({
            canonicalDir,
            options: { yes: options.yes, dryRun: options.dryRun },
          });
          printQoderPluginResult(qoderResult);
        }

        // Antigravity：Plugin 分支（agy plugin install，Gemini CLI 后继者）
        if (antigravityTargets.length > 0) {
          const canonicalDir = getCanonicalDir(global, process.cwd());
          // 若前面几类目标都为空，installer 没触发过 ensureCanonicalInstalled，需手动确保
          if (otherTargets.length === 0 && ccTargets.length === 0 && qoderTargets.length === 0) {
            await installForAgents({
              templatesDir: repoRoot,
              agents: [],
              global,
              cwd: process.cwd(),
            });
          }

          console.log(`\n  Antigravity Plugin:`);
          antigravityResult = await antigravityPlugin.ensureAntigravityPluginInstalled({
            canonicalDir,
            options: { yes: options.yes, dryRun: options.dryRun },
          });
          printAntigravityPluginResult(antigravityResult);
        }

        // Agent memory 分发：canonical 下的 AGENTS.md / GEMINI.md 按各工具原生文件名
        // 写到对应 config home（CLAUDE.md → ~/.claude 仍由上面 Claude Plugin 分支负责）。
        // 此时 canonical 已被某个安装分支 populate。失败不阻塞 sync（对齐 syncClaudeMd）。
        if (options.dryRun) {
          console.log(`\n  [dry-run] Agent memory 分发已跳过`);
        } else {
          try {
            const memoryRecords = await syncAgentMemories({
              canonicalDir: getCanonicalDir(global, process.cwd()),
              agentNames: targetAgents,
            });
            printMemoryResults(memoryRecords);
          } catch (err) {
            console.log(`\n  ⚠️  Agent memory 分发失败: ${err.message}（不阻塞）`);
          }
        }

        console.log(`\n${LOG_PREFIX} sync 完成`);

        // 退出码：任一分支失败则 exit 1（但 CLI 缺失打印指引不算失败，由用户决定）
        const installFailed = installResult && installResult.errors.length > 0;
        const ccFailed = ccResult && !ccResult.success && ccResult.reason !== 'cli-not-found';
        const qoderFailed = qoderResult && !qoderResult.success && qoderResult.reason !== 'cli-not-found';
        const antigravityFailed = antigravityResult && !antigravityResult.success && antigravityResult.reason !== 'cli-not-found';
        if (installFailed || ccFailed || qoderFailed || antigravityFailed) {
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} sync 失败: ${err.message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('update')
    .description('更新到最新版本并重新同步（全局安装场景：npm i -g 最新版 + sync）')
    .option('-r, --registry <url>', '指定 npm registry（首次提供后会记住，之后可省略）')
    .option('-t, --tag <tag>', 'dist-tag（默认 latest）', 'latest')
    .option('--project', 'sync 阶段使用项目级作用域')
    .option('--dry-run', '只打印将执行的命令，不实际更新')
    .action(async (options) => {
      try {
        const pkgName = pkg.name; // @justinfan/agent-workflow
        const tag = options.tag || 'latest';
        const scope = pkgName.startsWith('@') ? pkgName.split('/')[0] : null;
        const isWin = process.platform === 'win32';

        // registry 解析优先级：本次 flag > 持久化 > npm scoped 配置
        const canonicalDir = getCanonicalDir(true);
        const updateCfgPath = path.join(canonicalDir, '.meta', 'update.json');
        let persisted = null;
        try {
          const cfg = await fs.readJson(updateCfgPath);
          persisted = cfg && cfg.registry ? cfg.registry : null;
        } catch { /* 无持久化记录 */ }

        let registry = options.registry || persisted || null;
        if (!registry && scope) {
          const probe = spawnSync('npm', ['config', 'get', `${scope}:registry`], {
            encoding: 'utf8',
            shell: isWin,
          });
          const val = (probe.stdout || '').trim();
          if (/^https?:\/\//.test(val)) registry = val;
        }

        const installArgs = ['install', '-g', `${pkgName}@${tag}`];
        if (registry) installArgs.push('--registry', registry);

        const syncArgs = ['sync', '-y'];
        if (options.project) syncArgs.splice(1, 0, '--project');

        console.log(`${LOG_PREFIX} 更新到 ${tag}: npm ${installArgs.join(' ')}`);
        if (options.dryRun) {
          console.log(`${LOG_PREFIX} [dry-run] 接着执行: ${CLI_NAME} ${syncArgs.join(' ')}`);
          return;
        }

        // 仅当本次显式传入 registry 时持久化，下次 update 可省略 --registry
        if (options.registry) {
          try {
            await fs.ensureDir(path.dirname(updateCfgPath));
            await fs.writeJson(updateCfgPath, { registry: options.registry }, { spaces: 2 });
          } catch { /* 持久化失败不阻塞 */ }
        }

        // 1. 全局安装最新版（触发新版本 postinstall，为 installer-mount 类工具复制模板）
        const inst = spawnSync('npm', installArgs, { stdio: 'inherit', shell: isWin });
        if (inst.status !== 0) {
          console.error(`${LOG_PREFIX} npm 安装失败 (exit ${inst.status ?? (inst.error && inst.error.message)})`);
          if (!registry) {
            console.error(`${LOG_PREFIX} 若使用私有源，先指定一次: ${CLI_NAME} update --registry <url>`);
          }
          process.exitCode = 1;
          return;
        }

        // 2. 用刚装好的版本重新 sync —— spawn 新 bin 保证跑的是新代码 + 新模板，
        //    并补齐 postinstall 不处理的 Plugin 类工具（Claude Code / Qoder）与 v5 残留清理
        console.log(`\n${LOG_PREFIX} 重新同步: ${CLI_NAME} ${syncArgs.join(' ')}`);
        const sync = spawnSync(CLI_NAME, syncArgs, { stdio: 'inherit', shell: isWin });
        if (sync.status !== 0) {
          console.error(`${LOG_PREFIX} sync 失败 (exit ${sync.status})，可手动重试: ${CLI_NAME} ${syncArgs.join(' ')}`);
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} update 失败: ${err.message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('link')
    .description('将受管目录直接链接到当前仓库，便于本地调试 skills（除 Claude Code 外的所有已检测工具）')
    .option('--project', '项目级安装（当前目录）')

    .action(async (options) => {
      try {
        const repoRoot = path.join(__dirname, '..');
        const global = !options.project;

        // link 不支持 Plugin 分发的工具 (Claude Code / Qoder)，检测到时只打开发者提示
        const detected = detectInstalledAgents();
        if (detected.includes('qoder')) {
          console.log(`${LOG_PREFIX} Qoder 不支持 link 模式 (Plugin 分发)`);
          console.log(`  开发者请使用：qodercli --plugin-dir ${path.join(repoRoot, 'core')}`);
          console.log('');
        }
        if (detected.includes('claude-code')) {
          console.log(`${LOG_PREFIX} Claude Code 不支持 link 模式 (Plugin 缓存分发)`);
          console.log(`  开发者请使用：claude --plugin-dir ${path.join(repoRoot, 'core')}`);
          console.log('');
        }
        const targetAgents = detected.filter(a => a !== 'claude-code' && a !== 'qoder');

        if (targetAgents.length === 0) {
          console.log(`${LOG_PREFIX} 未检测到可 link 的 Agent`);
          return;
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
            // Plugin 机制管理的 agent（claude-code / qoder）由专门的 Plugin 状态块展示
            if (agentStatus.managedViaPlugin) continue;
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
          }

          // Claude Code Plugin 状态单独查询
          const pluginStatus = await claudeCodePlugin.inspectStatus({
            canonicalDir: status.canonicalDir,
          });
          console.log('\n  Claude Code Plugin:');
          if (pluginStatus.installed) {
            console.log(`    ✓ 已安装 (v${pluginStatus.version || '未知'}${pluginStatus.scope ? `, ${pluginStatus.scope}` : ''})`);
          } else if (pluginStatus.cliAvailable === false) {
            console.log(`    ○ claude CLI 未在 PATH，无法查询 Plugin 状态`);
          } else {
            console.log(`    ✗ 未安装 - 运行 ${CLI_NAME} sync 安装`);
          }
          if (pluginStatus.residue?.hasResidue) {
            const r = pluginStatus.residue;
            console.log(
              `    ⚠️  检测到 v5.x 残留：${r.settingsHooks.length} 个 settings.json hook、${r.legacyDirs.length} 个 legacy 目录`
            );
            console.log(`       运行 ${CLI_NAME} sync -y 自动清理`);
          }

          // Qoder Plugin 状态单独查询
          const qoderStatus = await qoderPlugin.inspectStatus({
            canonicalDir: status.canonicalDir,
          });
          console.log('\n  Qoder Plugin:');
          if (qoderStatus.installed) {
            console.log(`    ✓ 已安装 (v${qoderStatus.version || '未知'}${qoderStatus.scope ? `, ${qoderStatus.scope}` : ''})`);
          } else if (qoderStatus.cliAvailable === false) {
            console.log(`    ○ qodercli CLI 未在 PATH，无法查询 Plugin 状态`);
          } else {
            console.log(`    ✗ 未安装 - 运行 ${CLI_NAME} sync 安装`);
          }

          // Antigravity Plugin 状态单独查询
          const antigravityStatus = await antigravityPlugin.inspectStatus({
            canonicalDir: status.canonicalDir,
          });
          console.log('\n  Antigravity Plugin:');
          if (antigravityStatus.installed) {
            console.log(`    ✓ 已安装`);
          } else if (antigravityStatus.cliAvailable === false) {
            console.log(`    ○ agy CLI 未在 PATH，无法查询 Plugin 状态`);
          } else {
            console.log(`    ✗ 未安装 - 运行 ${CLI_NAME} sync 安装`);
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
          // Claude Code 迁移到 Plugin 后，诊断由 claudeCodePlugin.diagnose() 负责
        }

        // Claude Code Plugin 诊断
        const pluginDiag = await claudeCodePlugin.diagnose({ canonicalDir: status.canonicalDir });
        for (const line of pluginDiag.ok) ok.push(`Claude Code: ${line}`);
        for (const line of pluginDiag.issues) issues.push(`Claude Code: ${line}`);
        if (pluginDiag.suggestions.length > 0) {
          for (const line of pluginDiag.suggestions) {
            issues.push(`  建议: ${line}`);
          }
        }

        // Qoder Plugin 诊断
        const qoderDiag = await qoderPlugin.diagnose({ canonicalDir: status.canonicalDir });
        for (const line of qoderDiag.ok) ok.push(`Qoder: ${line}`);
        for (const line of qoderDiag.issues) issues.push(`Qoder: ${line}`);
        if (qoderDiag.suggestions.length > 0) {
          for (const line of qoderDiag.suggestions) {
            issues.push(`  建议: ${line}`);
          }
        }

        // Antigravity Plugin 诊断
        const antigravityDiag = await antigravityPlugin.diagnose({ canonicalDir: status.canonicalDir });
        for (const line of antigravityDiag.ok) ok.push(`Antigravity: ${line}`);
        for (const line of antigravityDiag.issues) issues.push(`Antigravity: ${line}`);
        if (antigravityDiag.suggestions.length > 0) {
          for (const line of antigravityDiag.suggestions) {
            issues.push(`  建议: ${line}`);
          }
        }

        // v6.0.0 起 Claude Code 走 Plugin 机制，旧版 installer 的 ~/.claude/skills
        // symlink 不再期望存在——只有在既没装 Plugin 又没走 Plugin 清理流程时才提示。
        const pluginInstalled = pluginDiag.ok.some((line) => line.includes('Plugin 已安装'));
        if (!pluginInstalled) {
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
