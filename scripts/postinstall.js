#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const semver = require('semver');

const pkg = require('../package.json');
const { ensureClaudeHome, installFresh, upgradeFrom } = require('../lib/installer');

async function main() {
  // 检查是否在 CI 环境或全局安装时跳过
  if (process.env.CLAUDE_WORKFLOW_SKIP_POSTINSTALL === '1') {
    console.log('[claude-workflow] 跳过 postinstall (CLAUDE_WORKFLOW_SKIP_POSTINSTALL=1)');
    return;
  }

  try {
    const homeDir = os.homedir();
    const claudeDir = path.join(homeDir, '.claude');
    const metaDir = path.join(claudeDir, '.claude-workflow');
    const metaFile = path.join(metaDir, 'meta.json');
    const templatesDir = path.join(__dirname, '..', 'templates');
    const currentVersion = pkg.version;

    console.log(`\n[claude-workflow] 安装 v${currentVersion}...`);

    await ensureClaudeHome(claudeDir, metaDir);

    let previousVersion = null;
    if (await fs.pathExists(metaFile)) {
      try {
        const meta = await fs.readJson(metaFile);
        previousVersion = meta.version || null;
      } catch {
        previousVersion = null;
      }
    }

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

    // 更新元信息
    await fs.writeJson(metaFile, {
      version: currentVersion,
      installedAt: new Date().toISOString(),
      npmPackage: pkg.name
    }, { spaces: 2 });

    console.log(`[claude-workflow] 安装位置: ${claudeDir}`);
    console.log(`[claude-workflow] 完成!\n`);

  } catch (err) {
    console.error(`[claude-workflow] postinstall 失败: ${err.message}`);
    console.error(`[claude-workflow] 可稍后运行: npx claude-workflow sync`);
    // 不阻塞整体安装
  }
}

main();
