#!/usr/bin/env node

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

const CLI_NAME = 'agent-workflow';
const LOG_PREFIX = '[agent-workflow]';
const LEGACY_META_DIR = '.claude-workflow';
const SKIP_ENV = 'AGENT_WORKFLOW_SKIP_POSTINSTALL';
const LEGACY_SKIP_ENV = 'CLAUDE_WORKFLOW_SKIP_POSTINSTALL';
const AGENTS_ENV = 'AGENT_WORKFLOW_AGENTS';
const LEGACY_AGENTS_ENV = 'CLAUDE_WORKFLOW_AGENTS';

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: false,
  });
  return !result.error && result.status === 0;
}

function detectPythonCommand() {
  return ['python3', 'python', 'py'].find(hasCommand) || null;
}

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
      targetAgents = detectInstalledAgents();
      if (targetAgents.length === 0) {
        targetAgents = ['claude-code'];
        console.log(`${LOG_PREFIX} 未检测到已安装的 Agent，默认安装到 Claude Code`);
      } else {
        console.log(`${LOG_PREFIX} 检测到 ${targetAgents.length} 个 Agent: ${targetAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
      }
    }

    const claudeDir = path.join(homeDir, '.claude');
    const oldMetaFile = path.join(claudeDir, LEGACY_META_DIR, 'meta.json');
    let previousVersion = null;
    let requiresMigration = false;

    if (await fs.pathExists(oldMetaFile)) {
      try {
        const oldMeta = await fs.readJson(oldMetaFile);
        previousVersion = oldMeta.version || null;

        const status = await getInstallationStatus(true);
        const claudeStatus = status.agents['claude-code'];
        const skillsDir = path.join(claudeDir, 'skills');
        if (await fs.pathExists(skillsDir)) {
          const stats = await fs.lstat(skillsDir);
          requiresMigration = !claudeStatus?.installed
            || claudeStatus.mode === 'legacy-root-symlink'
            || !stats.isSymbolicLink();
          if (requiresMigration) {
            console.log(`${LOG_PREFIX} 检测到旧版安装 v${previousVersion}，将迁移到新架构`);
          }
        }
      } catch {
        previousVersion = null;
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
