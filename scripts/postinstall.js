#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const semver = require('semver');
const readline = require('readline');

const pkg = require('../package.json');
const { ensureClaudeHome, installFresh, upgradeFrom, installBinary } = require('../lib/installer');

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
  // 检查是否在 CI 环境或全局安装时跳过
  if (process.env.CLAUDE_WORKFLOW_SKIP_POSTINSTALL === '1') {
    console.log('[claude-workflow] 跳过 postinstall (CLAUDE_WORKFLOW_SKIP_POSTINSTALL=1)');
    return;
  }

  const homeDir = os.homedir();
  const claudeDir = path.join(homeDir, '.claude');
  const metaDir = path.join(claudeDir, '.claude-workflow');
  const metaFile = path.join(metaDir, 'meta.json');
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
    errors: []
  };

  try {
    console.log(`\n[claude-workflow] 安装 v${currentVersion}...`);

    // 1. 首先确保目录存在并写入初始 meta.json
    await ensureClaudeHome(claudeDir, metaDir);
    await fs.writeJson(metaFile, installStatus, { spaces: 2 });

    // 2. 安装模板
    let previousVersion = null;
    if (await fs.pathExists(metaFile)) {
      try {
        const meta = await fs.readJson(metaFile);
        previousVersion = meta.version || null;
      } catch {
        previousVersion = null;
      }
    }

    try {
      if (!previousVersion) {
        await installFresh({ claudeDir, metaDir, templatesDir, version: currentVersion });
      } else if (semver.lt(previousVersion, currentVersion)) {
        await upgradeFrom({
          fromVersion: previousVersion,
          toVersion: currentVersion,
          claudeDir,
          metaDir,
          templatesDir
        });
      } else if (semver.gt(previousVersion, currentVersion)) {
        console.log(`[claude-workflow] 检测到降级: v${previousVersion} → v${currentVersion}`);
        console.log(`[claude-workflow] 跳过自动复制，如需强制同步请运行: npx claude-workflow sync --force`);
      } else {
        console.log(`[claude-workflow] 版本相同 (v${currentVersion})，跳过复制`);
      }
      installStatus.templatesInstalled = true;
    } catch (templateErr) {
      installStatus.errors.push(`Templates: ${templateErr.message}`);
      console.error(`[claude-workflow] 模板安装失败: ${templateErr.message}`);
    }

    // 3. 安装 codeagent-wrapper 二进制文件
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

    // 4. 更新最终元信息
    await fs.writeJson(metaFile, installStatus, { spaces: 2 });

    console.log(`\n[claude-workflow] 安装位置: ${claudeDir}`);
    if (installStatus.errors.length > 0) {
      console.log(`[claude-workflow] 完成 (有 ${installStatus.errors.length} 个警告)\n`);
    } else {
      console.log(`[claude-workflow] 完成!\n`);
    }

  } catch (err) {
    installStatus.errors.push(`Fatal: ${err.message}`);
    // 尝试保存错误状态
    try {
      await fs.ensureDir(metaDir);
      await fs.writeJson(metaFile, installStatus, { spaces: 2 });
    } catch {}
    console.error(`[claude-workflow] postinstall 失败: ${err.message}`);
    console.error(`[claude-workflow] 可稍后运行: npx claude-workflow sync`);
    // 不阻塞整体安装
  }
}

main();
