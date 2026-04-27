/**
 * Claude Code Plugin 分支的核心模块。
 *
 * Claude Code 不再走 installer 的复制/link/settings 注入流程，而是通过
 * Claude Code 原生的 Plugin 机制分发：
 *   ~/.agents/agent-workflow/               ← canonical 目录（同时是 marketplace 根）
 *   ├── .claude-plugin/marketplace.json       声明 marketplace
 *   └── core/                                 plugin 根，由 marketplace 指向 "./core"
 *
 * 本模块对外暴露：
 *   ensurePluginInstalled: sync/link 调用的主入口（清理旧残留 + 自动装 Plugin）
 *   detectLegacyResidue  : 检测 v5.x installer 留下的 hooks/目录残留
 *   cleanupLegacyResidue : 清理 v5.x 残留
 *   inspectStatus        : status 命令用的查询
 *   diagnose             : doctor 命令用的综合诊断
 *   printGuidance        : claude CLI 不可用时的手动指引
 */

'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const claudeCli = require('../scripts/claude-cli');

const PLUGIN_NAME = 'agent-workflow';
const MARKETPLACE_NAME = 'agent-workflow-marketplace';

// 受管 hook 脚本名 —— 清理 settings.json 时按这些名字识别 v5.x 的注入
const MANAGED_HOOK_SCRIPTS = [
  'session-start.js',
  'pre-execute-inject.js',
  'team-idle.js',
  'team-task-guard.js',
  'notify.js',
];

// v5.x 用到的 event 集合 —— 清理只扫这些 event，不动用户可能用于其他目的的 event
const MANAGED_HOOK_EVENTS = [
  'SessionStart',
  'PreToolUse',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Stop',
  'Notification',
];

// v5.x 在 ~/.claude/.agent-workflow/ 下的受管子目录
const MANAGED_LEGACY_DIRS = ['hooks', 'utils', 'specs', 'agents'];

// ============================================================
// 工具函数
// ============================================================

function getClaudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function getSettingsPath() {
  return path.join(getClaudeHome(), 'settings.json');
}

function getAgentWorkflowDir() {
  return path.join(getClaudeHome(), '.agent-workflow');
}

function getMigrationLogPath() {
  return path.join(getClaudeHome(), '.claude-workflow', 'migration.log');
}

async function readJsonSafe(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
}

async function appendMigrationLog(entry) {
  const logPath = getMigrationLogPath();
  try {
    await fs.ensureDir(path.dirname(logPath));
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n';
    await fs.appendFile(logPath, line, 'utf8');
  } catch (err) {
    process.stderr.write(`[claude-code-plugin] migration log write failed: ${err.message}\n`);
  }
}

/**
 * 判断某个 hook 条目的 command 是否引用了受管脚本。
 */
function isManagedHookCommand(command) {
  if (typeof command !== 'string') return false;
  return MANAGED_HOOK_SCRIPTS.some((script) => command.includes(script));
}

/**
 * 扫描 settings.json 中的某 event 数组，把引用受管脚本的 hook 条目剔除。
 * 返回 { cleaned, removed }：cleaned 是清理后的数组；removed 是被剔除的条目数。
 */
function filterManagedHooksInEvent(eventEntries) {
  let removed = 0;
  const cleaned = [];

  for (const entry of eventEntries) {
    if (!entry || typeof entry !== 'object') {
      cleaned.push(entry);
      continue;
    }

    const hookConfigs = Array.isArray(entry.hooks) ? entry.hooks : null;
    if (!hookConfigs) {
      // 旧格式（{type, command}）直接在顶层
      if (isManagedHookCommand(entry.command)) {
        removed += 1;
        continue;
      }
      cleaned.push(entry);
      continue;
    }

    const survivingHooks = hookConfigs.filter((hookConfig) => {
      if (hookConfig && isManagedHookCommand(hookConfig.command)) {
        removed += 1;
        return false;
      }
      return true;
    });

    if (survivingHooks.length === 0) continue; // 整个 entry 没 hook 了，删掉
    cleaned.push({ ...entry, hooks: survivingHooks });
  }

  return { cleaned, removed };
}

// ============================================================
// Public API
// ============================================================

/**
 * 检测 v5.x installer 留下的残留。
 */
async function detectLegacyResidue() {
  const residue = {
    settingsHooks: [],
    legacyDirs: [],
    hasResidue: false,
  };

  const settings = await readJsonSafe(getSettingsPath());
  if (settings && settings.hooks && typeof settings.hooks === 'object') {
    for (const eventName of MANAGED_HOOK_EVENTS) {
      const entries = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : [];
      for (const entry of entries) {
        if (!entry) continue;
        const hookConfigs = Array.isArray(entry.hooks) ? entry.hooks : [entry];
        for (const hookConfig of hookConfigs) {
          if (hookConfig && isManagedHookCommand(hookConfig.command)) {
            residue.settingsHooks.push({
              event: eventName,
              command: hookConfig.command,
            });
          }
        }
      }
    }
  }

  const agentWorkflowDir = getAgentWorkflowDir();
  for (const dir of MANAGED_LEGACY_DIRS) {
    const dirPath = path.join(agentWorkflowDir, dir);
    if (await fs.pathExists(dirPath)) {
      residue.legacyDirs.push(dir);
    }
  }

  residue.hasResidue = residue.settingsHooks.length > 0 || residue.legacyDirs.length > 0;
  return residue;
}

/**
 * 清理 v5.x installer 留下的残留。
 * 用户自定义 hook（command 不含受管脚本名）保留。
 * CLAUDE.md 和 notify.config.json 等用户文件不动。
 */
async function cleanupLegacyResidue({ dryRun = false } = {}) {
  const summary = {
    settingsHooksRemoved: 0,
    settingsHooksPreserved: 0,
    dirsRemoved: [],
    eventsCleared: [],
    dryRun,
  };

  // --- 清理 settings.json ---
  const settingsPath = getSettingsPath();
  const settings = await readJsonSafe(settingsPath);
  if (settings && settings.hooks && typeof settings.hooks === 'object') {
    let mutated = false;
    for (const eventName of MANAGED_HOOK_EVENTS) {
      const entries = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : null;
      if (!entries || entries.length === 0) continue;

      const originalCount = entries.reduce((sum, entry) => {
        const hookConfigs = Array.isArray(entry?.hooks) ? entry.hooks : (entry ? [entry] : []);
        return sum + hookConfigs.length;
      }, 0);

      const { cleaned, removed } = filterManagedHooksInEvent(entries);
      if (removed === 0) continue;

      summary.settingsHooksRemoved += removed;
      summary.settingsHooksPreserved += originalCount - removed;
      mutated = true;

      if (cleaned.length === 0) {
        delete settings.hooks[eventName];
        summary.eventsCleared.push(eventName);
      } else {
        settings.hooks[eventName] = cleaned;
      }
    }

    // 若 hooks 对象整体空了，删掉 hooks 键保持 settings.json 干净
    if (mutated && settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    if (mutated && !dryRun) {
      await fs.writeJson(settingsPath, settings, { spaces: 2 });
    }
  }

  // --- 清理 .agent-workflow/ 下的受管目录 ---
  const agentWorkflowDir = getAgentWorkflowDir();
  for (const dir of MANAGED_LEGACY_DIRS) {
    const dirPath = path.join(agentWorkflowDir, dir);
    if (await fs.pathExists(dirPath)) {
      summary.dirsRemoved.push(dir);
      if (!dryRun) {
        await fs.remove(dirPath);
      }
    }
  }

  // --- 清理 .agent-workflow-managed-agents.json manifest（若存在） ---
  const managedAgentsManifest = path.join(getClaudeHome(), '.agent-workflow-managed-agents.json');
  if (await fs.pathExists(managedAgentsManifest)) {
    if (!dryRun) await fs.remove(managedAgentsManifest);
    summary.managedAgentsManifestRemoved = true;
  }

  if (!dryRun) {
    await appendMigrationLog({ action: 'cleanup-legacy', summary });
  }

  return summary;
}

/**
 * 同步 core/CLAUDE.md 到 ~/.claude/CLAUDE.md。
 *
 * 策略：
 *   - 源不存在 / 内容完全相同 → 跳过
 *   - 目标不存在 → 直接写入（action: 'create'）
 *   - 目标存在且不同 → 备份到 ~/.claude/CLAUDE.md.bak.<timestamp>（每次覆盖生成新备份，历史不丢），再覆盖（action: 'overwrite'）
 *
 * Plugin 机制本身不能写用户 home，所以这一步由我们在 sync 流程里显式做。
 */
function buildBackupTimestamp(date = new Date()) {
  // 2026-04-27T02-04-10-123Z：ISO 格式但冒号和句点替换为短横线，
  // Windows 和所有 POSIX FS 都安全；保留毫秒精度避免同秒内两次 sync 碰撞
  return date.toISOString().replace(/[:.]/g, '-');
}

async function syncClaudeMd({ canonicalDir, logger = console } = {}) {
  const srcPath = path.join(canonicalDir, 'core', 'CLAUDE.md');
  const destPath = path.join(getClaudeHome(), 'CLAUDE.md');

  if (!(await fs.pathExists(srcPath))) {
    return { skipped: true, reason: 'source-not-found', srcPath };
  }

  const srcContent = await fs.readFile(srcPath, 'utf8');
  let action = 'create';
  let backupPath = null;

  if (await fs.pathExists(destPath)) {
    const destContent = await fs.readFile(destPath, 'utf8');
    if (srcContent === destContent) {
      return { skipped: true, reason: 'identical', destPath };
    }
    action = 'overwrite';
    backupPath = `${destPath}.bak.${buildBackupTimestamp()}`;
    await fs.copy(destPath, backupPath, { overwrite: false });
  }

  await fs.ensureDir(path.dirname(destPath));
  await fs.writeFile(destPath, srcContent, 'utf8');

  await appendMigrationLog({
    action: 'sync-claude-md',
    operation: action,
    srcPath,
    destPath,
    backup: backupPath,
  });

  return { skipped: false, action, destPath, backup: backupPath };
}

/**
 * 打印 claude CLI 不可用时的手动指引。
 */
function printGuidance({ canonicalDir, logger = console }) {
  const lines = [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Claude Code 通过 Plugin 机制管理（v6.0.0 起）',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '未检测到 `claude` CLI，无法自动安装 Plugin。请手动执行：',
    '',
    '  方式 1 —— 在 Claude Code 会话中：',
    `    /plugin marketplace add ${canonicalDir}`,
    `    /plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
    '',
    '  方式 2 —— 命令行（需要 claude CLI 在 PATH）：',
    `    claude plugin marketplace add ${canonicalDir}`,
    `    claude plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
    '',
  ];
  for (const line of lines) logger.log(line);
}

/**
 * sync / link 命令 claude-code 分支的主入口。
 *
 * @param {Object} opts
 * @param {string} opts.canonicalDir   - canonical marketplace 目录（已由调用方 ensureCanonicalInstalled 准备）
 * @param {Object} [opts.options]      - CLI options（yes, dryRun 等）
 * @param {Object} [opts.logger]       - 替代 console，方便测试
 * @param {Function} [opts.confirm]    - 非 -y 模式的确认钩子 async (msg) => boolean
 */
async function ensurePluginInstalled({ canonicalDir, options = {}, logger = console, confirm } = {}) {
  const result = {
    success: false,
    residueDetected: null,
    cleanupSummary: null,
    cliDetected: null,
    marketplaceAdded: null,
    pluginInstalled: null,
    reason: null,
  };

  // 1. 残留检测
  const residue = await detectLegacyResidue();
  result.residueDetected = residue;

  // 2. 清理残留
  if (residue.hasResidue) {
    logger.log('');
    logger.log('[claude-code-plugin] 检测到 v5.x 残留：');
    if (residue.settingsHooks.length > 0) {
      logger.log(`  - ~/.claude/settings.json 含 ${residue.settingsHooks.length} 个受管 hook 条目`);
    }
    if (residue.legacyDirs.length > 0) {
      logger.log(`  - ~/.claude/.agent-workflow/{${residue.legacyDirs.join(',')}} 存在`);
    }

    const shouldClean = options.dryRun
      ? false
      : options.yes
        ? true
        : typeof confirm === 'function'
          ? await confirm('是否清理 v5.x 残留？清理后用户自定义 hook 保留，CLAUDE.md / notify.config.json 不动')
          : false;

    if (options.dryRun) {
      result.cleanupSummary = await cleanupLegacyResidue({ dryRun: true });
      logger.log('  [dry-run] 将清理以上内容');
    } else if (shouldClean) {
      result.cleanupSummary = await cleanupLegacyResidue({ dryRun: false });
      logger.log(
        `  [cleanup] removed ${result.cleanupSummary.settingsHooksRemoved} hooks, ` +
        `${result.cleanupSummary.dirsRemoved.length} dirs (preserved ${result.cleanupSummary.settingsHooksPreserved} user hooks)`
      );
    } else {
      result.reason = 'cleanup-declined';
      logger.log('  [skip] 残留清理被跳过；Plugin 可能与旧 hooks 重复触发，请手动处理');
    }
  }

  // 3. 探测 claude CLI
  const cli = await claudeCli.detectClaudeCli();
  result.cliDetected = cli;

  if (!cli.available) {
    printGuidance({ canonicalDir, logger });
    result.reason = 'cli-not-found';
    return result;
  }

  // 4. marketplace add（幂等 —— 已添加会被 claude 报错，我们当作成功）
  const addResult = await claudeCli.marketplaceAdd(canonicalDir, 'user');
  result.marketplaceAdded = addResult;
  if (!addResult.success) {
    // 判断是否是"已存在"场景（不同 claude 版本错误文案可能不同，宽松匹配）
    const stderr = (addResult.stderr || '').toLowerCase();
    const alreadyAdded = stderr.includes('already') && (stderr.includes('exist') || stderr.includes('add'));
    if (!alreadyAdded) {
      logger.log(`[claude-code-plugin] marketplace add failed: ${addResult.stderr || addResult.code}`);
      result.reason = 'marketplace-add-failed';
      return result;
    }
    logger.log(`[claude-code-plugin] marketplace 已存在，跳过 add`);
  }

  // 5. plugin install
  const installResult = await claudeCli.pluginInstall(PLUGIN_NAME, MARKETPLACE_NAME, { scope: 'user' });
  result.pluginInstalled = installResult;
  if (!installResult.success) {
    const stderr = (installResult.stderr || '').toLowerCase();
    const alreadyInstalled = stderr.includes('already') && stderr.includes('install');
    if (!alreadyInstalled) {
      logger.log(`[claude-code-plugin] plugin install failed: ${installResult.stderr || installResult.code}`);
      result.reason = 'install-failed';
      return result;
    }
    logger.log(`[claude-code-plugin] plugin 已安装，跳过 install`);
  }

  await appendMigrationLog({
    action: 'plugin-install',
    marketplace: MARKETPLACE_NAME,
    plugin: PLUGIN_NAME,
    canonicalDir,
  });

  logger.log(`[claude-code-plugin] ✓ Plugin 已通过 Claude Code CLI 安装`);

  // Plugin 无法写 ~/.claude/CLAUDE.md，安装成功后显式同步一次全局 memory
  try {
    const mdResult = await syncClaudeMd({ canonicalDir, logger });
    result.claudeMd = mdResult;
    if (mdResult.skipped) {
      if (mdResult.reason === 'identical') {
        logger.log(`[claude-code-plugin] ~/.claude/CLAUDE.md 与 Plugin 版本一致，跳过`);
      }
    } else if (mdResult.action === 'create') {
      logger.log(`[claude-code-plugin] ~/.claude/CLAUDE.md 已创建`);
    } else if (mdResult.action === 'overwrite') {
      logger.log(`[claude-code-plugin] ~/.claude/CLAUDE.md 已覆盖（旧版本备份到 ${mdResult.backup}）`);
    }
  } catch (err) {
    result.claudeMd = { skipped: true, reason: 'error', error: err.message };
    logger.log(`[claude-code-plugin] ⚠️  ~/.claude/CLAUDE.md 同步失败: ${err.message}（不阻塞）`);
  }

  result.success = true;
  return result;
}

/**
 * 查询 Plugin 安装状态。
 */
async function inspectStatus({ canonicalDir } = {}) {
  const state = {
    installed: false,
    version: null,
    scope: null,
    marketplaceRegistered: false,
    residue: null,
  };

  const cli = await claudeCli.detectClaudeCli();
  state.cliAvailable = cli.available;

  if (cli.available) {
    const listed = await claudeCli.pluginList();
    if (listed.success && Array.isArray(listed.parsed)) {
      const entry = listed.parsed.find((item) =>
        item && (item.name === PLUGIN_NAME || item.id === PLUGIN_NAME || item.plugin === PLUGIN_NAME)
      );
      if (entry) {
        state.installed = Boolean(entry.enabled !== false);
        state.version = entry.version || entry.installedVersion || null;
        state.scope = entry.scope || null;
        state.marketplaceRegistered = true;
      }
    }
  }

  // 回退路径：直接读 ~/.claude/plugins/cache/...
  if (!state.installed) {
    const cacheRoot = path.join(getClaudeHome(), 'plugins', 'cache', MARKETPLACE_NAME, PLUGIN_NAME);
    if (await fs.pathExists(cacheRoot)) {
      try {
        const versions = (await fs.readdir(cacheRoot)).filter((name) => !name.startsWith('.'));
        if (versions.length > 0) {
          const latest = versions[versions.length - 1];
          const manifestPath = path.join(cacheRoot, latest, '.claude-plugin', 'plugin.json');
          const manifest = await readJsonSafe(manifestPath);
          if (manifest) {
            state.installed = true;
            state.version = manifest.version || null;
            state.marketplaceRegistered = true;
            state.scope = 'user';
          }
        }
      } catch {
        // 忽略，保持 installed=false
      }
    }
  }

  state.residue = await detectLegacyResidue();
  return state;
}

/**
 * doctor 命令的综合诊断。
 */
async function diagnose({ canonicalDir } = {}) {
  const result = { ok: [], issues: [], suggestions: [] };

  const cli = await claudeCli.detectClaudeCli();
  if (cli.available) {
    result.ok.push(`claude CLI 可用 (${cli.version})`);
  } else {
    result.issues.push('claude CLI 不在 PATH');
    result.suggestions.push('安装 Claude Code 并确保 `claude` 命令可用，或在 Claude Code 会话中手动 /plugin install');
  }

  const status = await inspectStatus({ canonicalDir });
  if (status.installed) {
    result.ok.push(`Claude Code Plugin 已安装 (v${status.version || 'unknown'})`);
  } else {
    result.issues.push('Claude Code Plugin 未安装');
    result.suggestions.push('运行 `agent-workflow sync -a claude-code` 自动安装 Plugin');
  }

  const residue = status.residue || await detectLegacyResidue();
  if (residue.hasResidue) {
    result.issues.push(
      `检测到 v5.x 残留：${residue.settingsHooks.length} 个 settings.json hook 条目、` +
      `${residue.legacyDirs.length} 个 legacy 目录`
    );
    result.suggestions.push('运行 `agent-workflow sync -a claude-code -y` 自动清理并装 Plugin');
  } else {
    result.ok.push('v5.x 残留：无');
  }

  return result;
}

module.exports = {
  PLUGIN_NAME,
  MARKETPLACE_NAME,
  MANAGED_HOOK_SCRIPTS,
  MANAGED_HOOK_EVENTS,
  MANAGED_LEGACY_DIRS,
  detectLegacyResidue,
  cleanupLegacyResidue,
  ensurePluginInstalled,
  syncClaudeMd,
  inspectStatus,
  diagnose,
  printGuidance,
};
