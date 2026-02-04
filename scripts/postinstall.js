#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const semver = require('semver');
const readline = require('readline');

const pkg = require('../package.json');
const {
  ensureClaudeHome,
  installFresh,
  upgradeFrom,
  installBinary,
  installForAgents,
  migrateFromLegacy,
  getInstallationStatus,
} = require('../lib/installer');
const {
  agents,
  detectInstalledAgents,
  getCanonicalDir,
  parseAgentArg,
} = require('../lib/agents');

// 询问用户是否自动配置 PATH
async function askAutoConfigurePath() {
  // 非交互模式直接返回 false
  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('[claude-workflow] 是否自动配置 PATH? (Y/n) ', (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}

// 配置 PATH 到 shell 配置文件
async function configurePathForUnix(installDir) {
  const homeDir = os.homedir();
  const shell = process.env.SHELL || '';
  const shellRc = shell.includes('zsh') ? path.join(homeDir, '.zshrc') : path.join(homeDir, '.bashrc');
  const shellRcDisplay = shell.includes('zsh') ? '~/.zshrc' : '~/.bashrc';
  const exportCommand = `export PATH="${installDir}:$PATH"`;

  try {
    // 检查是否已配置
    let rcContent = '';
    if (await fs.pathExists(shellRc)) {
      rcContent = await fs.readFile(shellRc, 'utf-8');
    }

    if (rcContent.includes(installDir) || rcContent.includes('/.local/bin')) {
      console.log(`[claude-workflow] ✓ PATH 已配置在 ${shellRcDisplay}`);
      return { success: true, alreadyConfigured: true };
    }

    // 追加到 shell 配置
    const configLine = `\n# Claude Workflow - codeagent-wrapper\n${exportCommand}\n`;
    await fs.appendFile(shellRc, configLine, 'utf-8');
    console.log(`[claude-workflow] ✓ 已添加 PATH 到 ${shellRcDisplay}`);
    console.log(`[claude-workflow] 请运行: source ${shellRcDisplay}`);
    return { success: true, alreadyConfigured: false };
  } catch (error) {
    console.log(`[claude-workflow] ✗ PATH 配置失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// 显示 Windows PATH 配置说明
function showWindowsPathInstructions(installDir) {
  const winPath = installDir.replace(/\//g, '\\');
  console.log(`\n[claude-workflow] Windows PATH 配置说明:`);
  console.log(`  方法 1 - 图形界面:`);
  console.log(`    1. Win+X → 系统 → 高级系统设置`);
  console.log(`    2. 环境变量 → 用户变量 → Path → 编辑`);
  console.log(`    3. 新建 → 添加: ${winPath}`);
  console.log(`    4. 确定保存，重启终端`);
  console.log(`\n  方法 2 - PowerShell (管理员):`);
  console.log(`    [System.Environment]::SetEnvironmentVariable('PATH', "$env:PATH;${winPath}", 'User')`);
}

async function main() {
  // 检查是否跳过 postinstall
  if (process.env.CLAUDE_WORKFLOW_SKIP_POSTINSTALL === '1') {
    console.log('[claude-workflow] 跳过 postinstall (CLAUDE_WORKFLOW_SKIP_POSTINSTALL=1)');
    return;
  }

  const homeDir = os.homedir();
  const templatesDir = path.join(__dirname, '..', 'templates');
  const packageDir = path.join(__dirname, '..');
  const currentVersion = pkg.version;

  // 安装状态跟踪
  const installStatus = {
    version: currentVersion,
    installedAt: new Date().toISOString(),
    npmPackage: pkg.name,
    templatesInstalled: false,
    binaryInstalled: false,
    binaryPath: null,
    binaryDir: null,
    agents: {},
    errors: []
  };

  try {
    console.log(`\n[claude-workflow] 安装 v${currentVersion}...`);

    // 1. 确定目标 Agent
    let targetAgents = [];

    // 支持通过环境变量指定目标 Agent
    if (process.env.CLAUDE_WORKFLOW_AGENTS) {
      targetAgents = parseAgentArg(process.env.CLAUDE_WORKFLOW_AGENTS);
      console.log(`[claude-workflow] 使用环境变量指定的 Agent: ${targetAgents.join(', ')}`);
    } else {
      // 检测已安装的 Agent
      targetAgents = detectInstalledAgents();
      if (targetAgents.length === 0) {
        // 默认安装到 Claude Code
        targetAgents = ['claude-code'];
        console.log('[claude-workflow] 未检测到已安装的 Agent，默认安装到 Claude Code');
      } else {
        console.log(`[claude-workflow] 检测到 ${targetAgents.length} 个 Agent: ${targetAgents.map(a => agents[a]?.displayName || a).join(', ')}`);
      }
    }

    // 2. 检查是否需要从旧版迁移
    const claudeDir = path.join(homeDir, '.claude');
    const oldMetaFile = path.join(claudeDir, '.claude-workflow', 'meta.json');
    let previousVersion = null;

    if (await fs.pathExists(oldMetaFile)) {
      try {
        const oldMeta = await fs.readJson(oldMetaFile);
        previousVersion = oldMeta.version || null;

        // 检查是否为旧版安装（非 symlink 模式）
        const skillsDir = path.join(claudeDir, 'skills');
        if (await fs.pathExists(skillsDir)) {
          const stats = await fs.lstat(skillsDir);
          if (!stats.isSymbolicLink()) {
            console.log(`[claude-workflow] 检测到旧版安装 v${previousVersion}，将迁移到新架构`);
          }
        }
      } catch {
        previousVersion = null;
      }
    }

    // 3. 检查新版元信息
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

    // 4. 决定安装策略
    const effectiveVersion = canonicalVersion || previousVersion;

    if (effectiveVersion && semver.gt(effectiveVersion, currentVersion)) {
      console.log(`[claude-workflow] 检测到降级: v${effectiveVersion} → v${currentVersion}`);
      console.log(`[claude-workflow] 跳过自动安装，如需强制同步请运行: npx claude-workflow sync --force`);
      installStatus.errors.push('Downgrade detected, skipped');
    } else if (effectiveVersion && semver.eq(effectiveVersion, currentVersion)) {
      console.log(`[claude-workflow] 版本相同 (v${currentVersion})，跳过模板复制`);
      installStatus.templatesInstalled = true;
    } else {
      // 执行安装
      try {
        const result = await installForAgents({
          templatesDir,
          agents: targetAgents,
          global: true,
          force: false,
        });

        installStatus.templatesInstalled = true;
        installStatus.canonicalDir = result.canonicalDir;
        installStatus.agents = result.meta?.agents || {};

        if (result.errors.length > 0) {
          installStatus.errors.push(...result.errors);
        }

        // 输出安装结果
        console.log(`[claude-workflow] Canonical: ${result.canonicalDir}`);
        for (const [name, agentResult] of Object.entries(result.agents)) {
          const displayName = agents[name]?.displayName || name;
          const status = agentResult.success ? '✓' : '✗';
          const mode = agentResult.links?.skills?.mode || 'unknown';
          console.log(`  ${status} ${displayName} (${mode})`);
        }
      } catch (templateErr) {
        installStatus.errors.push(`Templates: ${templateErr.message}`);
        console.error(`[claude-workflow] 模板安装失败: ${templateErr.message}`);
      }
    }

    // 5. 安装 codeagent-wrapper 二进制文件
    console.log(`\n[claude-workflow] 安装 codeagent-wrapper...`);
    const binaryResult = await installBinary(packageDir);
    if (!binaryResult.success) {
      console.log(`[claude-workflow] codeagent-wrapper 安装跳过: ${binaryResult.reason}`);
      if (binaryResult.reason === 'binary_not_found') {
        console.log(`[claude-workflow] 当前平台无预编译二进制，请从 https://github.com/anthropics/claude-code 下载`);
      } else if (binaryResult.reason === 'verification_failed') {
        console.log(`[claude-workflow] 二进制文件无法执行，可能是平台不兼容`);
      }
      installStatus.errors.push(`Binary: ${binaryResult.reason}`);
    } else {
      installStatus.binaryInstalled = true;
      installStatus.binaryPath = binaryResult.path;
      installStatus.binaryDir = binaryResult.installDir;

      if (!binaryResult.inPath) {
        // 二进制安装成功但不在 PATH 中，提供自动配置
        const platform = os.platform();
        if (platform === 'win32') {
          showWindowsPathInstructions(binaryResult.installDir);
        } else {
          // macOS/Linux: 询问是否自动配置
          const autoConfig = await askAutoConfigurePath();
          if (autoConfig) {
            await configurePathForUnix(binaryResult.installDir);
          } else {
            const shell = process.env.SHELL || '';
            const shellRc = shell.includes('zsh') ? '~/.zshrc' : '~/.bashrc';
            console.log(`[claude-workflow] 手动配置 PATH:`);
            console.log(`  export PATH="${binaryResult.installDir}:$PATH"`);
            console.log(`  # 添加到 ${shellRc} 后运行: source ${shellRc}`);
          }
        }
      }
    }

    // 6. 保存兼容性元信息到旧位置（向后兼容）
    const metaDir = path.join(claudeDir, '.claude-workflow');
    await fs.ensureDir(metaDir);
    await fs.writeJson(path.join(metaDir, 'meta.json'), {
      version: currentVersion,
      installedAt: installStatus.installedAt,
      npmPackage: pkg.name,
      canonicalDir: installStatus.canonicalDir,
      migratedToCanonical: true,
    }, { spaces: 2 });

    console.log(`\n[claude-workflow] 安装位置: ${installStatus.canonicalDir || canonicalDir}`);
    if (installStatus.errors.length > 0) {
      console.log(`[claude-workflow] 完成 (有 ${installStatus.errors.length} 个警告)\n`);
    } else {
      console.log(`[claude-workflow] 完成!\n`);
    }

  } catch (err) {
    installStatus.errors.push(`Fatal: ${err.message}`);
    // 尝试保存错误状态
    try {
      const metaDir = path.join(homeDir, '.claude', '.claude-workflow');
      await fs.ensureDir(metaDir);
      await fs.writeJson(path.join(metaDir, 'meta.json'), installStatus, { spaces: 2 });
    } catch {}
    console.error(`[claude-workflow] postinstall 失败: ${err.message}`);
    console.error(`[claude-workflow] 可稍后运行: npx claude-workflow sync`);
    // 不阻塞整体安装
  }
}

main();
