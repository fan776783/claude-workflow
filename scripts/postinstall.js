#!/usr/bin/env node
/** @file npm postinstall 钩子，自动检测已安装的 Agent 并同步工作流模板 */

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const semver = require('semver');
const { spawnSync } = require('child_process');

const pkg = require('../package.json');
const {
  installForAgents,
  getInstallationStatus,
} = require('../lib/installer');
const {
  agents,
  detectInstalledAgents,
  getCanonicalDir,
  parseAgentArg,
} = require('../lib/agents');
const { AUMID: NOTIFY_AUMID } = require('../core/hooks/notify-backends');

const CLI_NAME = 'agent-workflow';
const LOG_PREFIX = '[agent-workflow]';
const LEGACY_META_DIR = '.claude-workflow';
const SKIP_ENV = 'AGENT_WORKFLOW_SKIP_POSTINSTALL';
const LEGACY_SKIP_ENV = 'CLAUDE_WORKFLOW_SKIP_POSTINSTALL';
const AGENTS_ENV = 'AGENT_WORKFLOW_AGENTS';
const LEGACY_AGENTS_ENV = 'CLAUDE_WORKFLOW_AGENTS';

/**
 * 检测指定命令是否可用
 * @param {string} command - 要检测的命令名
 * @returns {boolean} 命令是否存在且可执行
 */
function hasCommand(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: false,
  });
  return !result.error && result.status === 0;
}

/**
 * Windows 上一次性注册 AppUserModelID，保证 notify.js 的 WinRT toast
 * 能正常显示应用名；幂等（/f 覆盖）。非 Windows 环境 / 失败都静默。
 */
function registerWindowsAumid() {
  if (process.platform !== 'win32') return;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${NOTIFY_AUMID}`;
  try {
    spawnSync(
      'reg',
      ['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'Claude Code', '/f'],
      { stdio: 'ignore', windowsHide: true }
    );
  } catch {
    // best-effort，注册失败不阻塞安装
  }
}

/**
 * 检测系统中可用的 Python 命令
 * @returns {string|null} 可用的 Python 命令名（python3/python/py），未找到返回 null
 */
function detectPythonCommand() {
  return ['python3', 'python', 'py'].find(hasCommand) || null;
}

/**
 * 收集运行时依赖的警告信息（Python、Codex CLI 等）
 * @returns {{ warnings: string[], pythonCommand: string|null }} 警告列表和检测到的 Python 命令
 */
function collectRuntimeWarnings() {
  const warnings = [];
  const pythonCommand = detectPythonCommand();

  if (!pythonCommand) {
    warnings.push('Runtime dependency missing: python3/python/py');
  }

  if (!hasCommand('codex')) {
    warnings.push('Runtime dependency missing: codex CLI');
  }

  return { warnings, pythonCommand };
}

/**
 * postinstall 主流程：检测 Agent、处理版本升级/降级、安装模板并写入元信息
 * @returns {Promise<void>}
 */
async function main() {
  const skipPostinstall = process.env[SKIP_ENV] === '1' || process.env[LEGACY_SKIP_ENV] === '1';
  if (skipPostinstall) {
    const envName = process.env[SKIP_ENV] === '1' ? SKIP_ENV : LEGACY_SKIP_ENV;
    console.log(`${LOG_PREFIX} 跳过 postinstall (${envName}=1)`);
    return;
  }

  const homeDir = os.homedir();
  const repoRoot = path.join(__dirname, '..');
  const packageDir = path.join(__dirname, '..');
  const currentVersion = pkg.version;

  const installStatus = {
    version: currentVersion,
    installedAt: new Date().toISOString(),
    npmPackage: pkg.name,
    templatesInstalled: false,
    agents: {},
    errors: []
  };

  try {
    console.log(`\n${LOG_PREFIX} 安装 v${currentVersion}...`);

    let targetAgents = [];
    const configuredAgents = process.env[AGENTS_ENV] || process.env[LEGACY_AGENTS_ENV];

    if (configuredAgents) {
      targetAgents = parseAgentArg(configuredAgents);
      console.log(`${LOG_PREFIX} 使用环境变量指定的 Agent: ${targetAgents.join(', ')}`);
    } else {
      // Claude Code 从 v6.0.0 起通过 Plugin 分发，不再参与 installer 自动路径。
      // postinstall 只为其他 8 个工具复制模板；Claude Code 需要用户显式执行
      // `agent-workflow sync -a claude-code` 触发 Plugin 安装。
      targetAgents = detectInstalledAgents().filter(a => a !== 'claude-code');
      if (targetAgents.length === 0) {
        console.log(`${LOG_PREFIX} 未检测到需要自动 sync 的 Agent`);
      } else {
        console.log(`${LOG_PREFIX} 检测到 ${targetAgents.length} 个 Agent: ${targetAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
      }
    }

    const claudeDir = path.join(homeDir, '.claude');
    const oldMetaFile = path.join(claudeDir, LEGACY_META_DIR, 'meta.json');
    let previousVersion = null;
    let requiresMigration = false;

    // v6.0.0 起 Claude Code 走 Plugin 机制。postinstall 只检测 v5.x 残留并打印迁移提示，
    // 不自动触发 sync（避免 npm install 时未经用户同意改动 ~/.claude/）
    if (await fs.pathExists(oldMetaFile)) {
      try {
        const oldMeta = await fs.readJson(oldMetaFile);
        previousVersion = oldMeta.version || null;
      } catch {
        previousVersion = null;
      }

      // 残留检测：用 claudeCodePlugin.detectLegacyResidue 统一判断
      try {
        const claudeCodePlugin = require('../lib/claude-code-plugin');
        const residue = await claudeCodePlugin.detectLegacyResidue();
        if (residue.hasResidue) {
          console.log('');
          console.log(`${LOG_PREFIX} ⚠️  检测到 Claude Code v5.x 残留安装${previousVersion ? ` (v${previousVersion})` : ''}`);
          console.log(`${LOG_PREFIX}    v6.0.0 起 Claude Code 已迁移到 Plugin 机制`);
          console.log(`${LOG_PREFIX}    运行 \`${CLI_NAME} sync -a claude-code\` 清理残留并安装 Plugin`);
          console.log(`${LOG_PREFIX}    详见 CHANGELOG.md 的 v6.0.0 条目`);
          console.log('');
        }
      } catch {
        // 残留检测失败不阻塞 postinstall
      }
    }

    const canonicalDir = getCanonicalDir(true);
    const newMetaFile = path.join(canonicalDir, '.meta', 'meta.json');
    let canonicalVersion = null;

    if (await fs.pathExists(newMetaFile)) {
      try {
        const newMeta = await fs.readJson(newMetaFile);
        canonicalVersion = newMeta.version || null;
      } catch {
        canonicalVersion = null;
      }
    }

    const effectiveVersion = canonicalVersion || previousVersion;
    const runtimeCheck = collectRuntimeWarnings();

    if (effectiveVersion && semver.gt(effectiveVersion, currentVersion)) {
      console.log(`${LOG_PREFIX} 检测到降级: v${effectiveVersion} → v${currentVersion}`);
      console.log(`${LOG_PREFIX} 跳过自动安装，如需手动同步请运行: npx ${CLI_NAME} sync`);
      installStatus.errors.push('Downgrade detected, skipped');
    } else if (effectiveVersion && semver.eq(effectiveVersion, currentVersion) && !requiresMigration) {
      console.log(`${LOG_PREFIX} 版本相同 (v${currentVersion})，跳过模板复制`);
      installStatus.templatesInstalled = true;
    } else {
      try {
        const result = await installForAgents({
          templatesDir: repoRoot,
          agents: targetAgents,
          global: true,
        });

        installStatus.templatesInstalled = true;
        installStatus.canonicalDir = result.canonicalDir;
        installStatus.agents = result.meta?.agents || {};

        if (result.errors.length > 0) {
          installStatus.errors.push(...result.errors);
        }

        console.log(`${LOG_PREFIX} Canonical: ${result.canonicalDir}`);
        for (const [name, agentResult] of Object.entries(result.agents)) {
          const displayName = agents[name]?.displayName || name;
          const status = agentResult.success ? '✓' : '✗';
          const mode = agentResult.skills?.rootMode || 'unknown';
          console.log(`  ${status} ${displayName} (${mode})`);
        }
      } catch (templateErr) {
        installStatus.errors.push(`Templates: ${templateErr.message}`);
        console.error(`${LOG_PREFIX} 模板安装失败: ${templateErr.message}`);
      }
    }



    if (runtimeCheck.warnings.length > 0) {
      installStatus.errors.push(...runtimeCheck.warnings);
      console.log(`\n${LOG_PREFIX} 运行时依赖检查:`);
      runtimeCheck.warnings.forEach(warning => console.log(`${LOG_PREFIX} 警告: ${warning}`));
      if (runtimeCheck.pythonCommand) {
        console.log(`${LOG_PREFIX} 检测到 Python 解释器: ${runtimeCheck.pythonCommand}`);
      }
    }

    const metaDir = path.join(claudeDir, LEGACY_META_DIR);
    await fs.ensureDir(metaDir);
    await fs.writeJson(path.join(metaDir, 'meta.json'), {
      version: currentVersion,
      installedAt: installStatus.installedAt,
      npmPackage: pkg.name,
      canonicalDir: installStatus.canonicalDir,
      migratedToCanonical: true,
      runtimeWarnings: runtimeCheck.warnings,
      pythonCommand: runtimeCheck.pythonCommand,
    }, { spaces: 2 });

    registerWindowsAumid();

    console.log(`\n${LOG_PREFIX} 安装位置: ${installStatus.canonicalDir || canonicalDir}`);
    if (installStatus.errors.length > 0) {
      console.log(`${LOG_PREFIX} 完成 (有 ${installStatus.errors.length} 个警告)\n`);
    } else {
      console.log(`${LOG_PREFIX} 完成!\n`);
    }

  } catch (err) {
    installStatus.errors.push(`Fatal: ${err.message}`);
    try {
      const metaDir = path.join(homeDir, '.claude', LEGACY_META_DIR);
      await fs.ensureDir(metaDir);
      await fs.writeJson(path.join(metaDir, 'meta.json'), installStatus, { spaces: 2 });
    } catch {}
    console.error(`${LOG_PREFIX} postinstall 失败: ${err.message}`);
    console.error(`${LOG_PREFIX} 可稍后运行: npx ${CLI_NAME} sync`);
  }
}

main();
