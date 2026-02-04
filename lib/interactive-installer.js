/**
 * 交互式安装模块
 * 参考 vercel-labs/skills 项目的交互式安装体验
 */

const p = require('@clack/prompts');
const pc = require('picocolors');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const {
  agents,
  detectInstalledAgents,
  getCanonicalDir,
  getAllAgentNames,
  parseAgentArg,
} = require('./agents');

const {
  installForAgents,
  getInstallationStatus,
  SYMLINK_DIRS,
} = require('./installer');

// 颜色常量
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

// Logo
const LOGO_LINES = [
  '╔═╗╦  ╔═╗╦ ╦╔╦╗╔═╗',
  '║  ║  ╠═╣║ ║ ║║║╣ ',
  '╚═╝╩═╝╩ ╩╚═╝═╩╝╚═╝',
  '╦ ╦╔═╗╦═╗╦╔═╔═╗╦  ╔═╗╦ ╦',
  '║║║║ ║╠╦╝╠╩╗╠╣ ║  ║ ║║║║',
  '╚╩╝╚═╝╩╚═╩ ╩╚  ╩═╝╚═╝╚╩╝',
];

const GRAYS = [
  '\x1b[38;5;250m',
  '\x1b[38;5;248m',
  '\x1b[38;5;245m',
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m',
];

/**
 * 显示 Logo
 */
function showLogo() {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i % GRAYS.length]}${line}${RESET}`);
  });
}

/**
 * 缩短路径显示
 */
function shortenPath(fullPath, cwd = process.cwd()) {
  const home = os.homedir();
  const sep = path.sep;
  if (fullPath === home || fullPath.startsWith(home + sep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + sep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * 格式化列表
 */
function formatList(items, maxShow = 5) {
  if (items.length <= maxShow) {
    return items.join(', ');
  }
  const shown = items.slice(0, maxShow);
  const remaining = items.length - maxShow;
  return `${shown.join(', ')} +${remaining} more`;
}

/**
 * 交互式选择 Agent
 */
async function selectAgentsInteractive(options = {}) {
  const { global = true, preselected = [] } = options;
  const allAgents = getAllAgentNames();
  const detectedAgents = detectInstalledAgents();

  const agentChoices = allAgents.map(name => {
    const config = agents[name];
    const detected = detectedAgents.includes(name);
    const skillsDir = global ? config.globalSkillsDir : config.skillsDir;
    return {
      value: name,
      label: config.displayName,
      hint: detected ? pc.green('detected') : pc.dim(shortenPath(skillsDir)),
    };
  });

  // 默认预选检测到的 Agent
  const initialValues = preselected.length > 0
    ? preselected
    : detectedAgents.length > 0
      ? detectedAgents
      : ['claude-code'];

  const selected = await p.multiselect({
    message: `选择要安装到的 Agent ${pc.dim('(空格切换)')}`,
    options: agentChoices,
    initialValues,
    required: true,
  });

  if (p.isCancel(selected)) {
    return null;
  }

  return selected;
}

/**
 * 交互式安装流程
 */
async function runInteractiveInstall(options = {}) {
  const {
    templatesDir,
    version,
    force = false,
    clean = false,
  } = options;

  showLogo();
  console.log();
  console.log(`${DIM}Claude Code 多 Agent 工作流安装器${RESET}`);
  console.log();

  p.intro(pc.bgCyan(pc.black(' claude-workflow ')));

  const spinner = p.spinner();

  // 1. 检测已安装的 Agent
  spinner.start('检测已安装的 Agent...');
  const detectedAgents = detectInstalledAgents();
  const totalAgents = getAllAgentNames().length;
  spinner.stop(`检测到 ${pc.green(detectedAgents.length)} / ${totalAgents} 个 Agent`);

  if (detectedAgents.length > 0) {
    p.log.info(`已检测到: ${detectedAgents.map(a => pc.cyan(agents[a].displayName)).join(', ')}`);
  }

  // 2. 选择目标 Agent
  let targetAgents;

  if (detectedAgents.length === 0) {
    p.log.warn('未检测到已安装的 Agent，请选择要安装到的 Agent');
    targetAgents = await selectAgentsInteractive({ global: true });
  } else if (detectedAgents.length === 1) {
    targetAgents = detectedAgents;
    p.log.info(`将安装到: ${pc.cyan(agents[detectedAgents[0]].displayName)}`);
  } else {
    // 多个 Agent，询问用户
    const useDetected = await p.confirm({
      message: `安装到所有检测到的 Agent (${detectedAgents.length} 个)?`,
      initialValue: true,
    });

    if (p.isCancel(useDetected)) {
      p.cancel('安装已取消');
      process.exit(0);
    }

    if (useDetected) {
      targetAgents = detectedAgents;
    } else {
      targetAgents = await selectAgentsInteractive({
        global: true,
        preselected: detectedAgents,
      });
    }
  }

  if (!targetAgents || targetAgents.length === 0) {
    p.cancel('安装已取消');
    process.exit(0);
  }

  // 3. 选择安装作用域
  let installGlobally = true;

  const scope = await p.select({
    message: '安装作用域',
    options: [
      {
        value: true,
        label: '全局',
        hint: '安装到 home 目录，所有项目可用',
      },
      {
        value: false,
        label: '项目级',
        hint: '安装到当前目录，随项目提交',
      },
    ],
    initialValue: true,
  });

  if (p.isCancel(scope)) {
    p.cancel('安装已取消');
    process.exit(0);
  }

  installGlobally = scope;

  // 4. 选择安装模式
  let cleanInstall = clean;

  if (!clean) {
    const installMode = await p.select({
      message: '安装模式',
      options: [
        {
          value: false,
          label: '增量更新',
          hint: '保留现有文件，只更新变更的内容',
        },
        {
          value: true,
          label: '清理安装',
          hint: '删除旧文件后重新安装（用于移除已删除的 skill）',
        },
      ],
      initialValue: false,
    });

    if (p.isCancel(installMode)) {
      p.cancel('安装已取消');
      process.exit(0);
    }

    cleanInstall = installMode;
  }

  // 5. 显示安装摘要
  const cwd = process.cwd();
  const canonicalDir = getCanonicalDir(installGlobally, cwd);
  const summaryLines = [];

  summaryLines.push(`${pc.cyan('Canonical 位置:')} ${shortenPath(canonicalDir)}`);
  summaryLines.push('');
  summaryLines.push(`${pc.cyan('目标 Agent:')}`);

  for (const agentName of targetAgents) {
    const config = agents[agentName];
    const skillsDir = installGlobally ? config.globalSkillsDir : path.join(cwd, config.skillsDir);
    summaryLines.push(`  ${pc.green('→')} ${config.displayName}`);
    summaryLines.push(`    ${pc.dim(shortenPath(skillsDir))}`);
  }

  summaryLines.push('');
  summaryLines.push(`${pc.cyan('安装内容:')}`);
  summaryLines.push(`  ${SYMLINK_DIRS.join(', ')}`);
  summaryLines.push('');
  summaryLines.push(`${pc.cyan('安装模式:')} ${cleanInstall ? pc.yellow('清理安装') : '增量更新'}`);

  console.log();
  p.note(summaryLines.join('\n'), '安装摘要');

  // 6. 确认安装
  const confirmed = await p.confirm({
    message: '确认安装?',
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('安装已取消');
    process.exit(0);
  }

  // 7. 执行安装
  spinner.start('正在安装...');

  try {
    const result = await installForAgents({
      templatesDir,
      agents: targetAgents,
      global: installGlobally,
      cwd,
      force,
      clean: cleanInstall,
    });

    spinner.stop('安装完成');

    // 8. 显示结果
    console.log();
    const resultLines = [];

    if (result.canonical) {
      resultLines.push(`${pc.green('✓')} Canonical: ${shortenPath(result.canonicalDir)}`);
      if (result.canonical.cleaned && result.canonical.cleaned.length > 0) {
        resultLines.push(`  ${pc.yellow('已清理:')} ${result.canonical.cleaned.join(', ')}`);
      }
      if (result.canonical.copied.length > 0) {
        resultLines.push(`  ${pc.dim('已复制:')} ${result.canonical.copied.join(', ')}`);
      }
    }

    resultLines.push('');
    resultLines.push(`${pc.cyan('Agent 状态:')}`);

    let successCount = 0;
    let failCount = 0;

    for (const [name, agentResult] of Object.entries(result.agents)) {
      const displayName = agents[name]?.displayName || name;
      if (agentResult.success) {
        successCount++;
        const mode = agentResult.links?.skills?.mode || 'unknown';
        resultLines.push(`  ${pc.green('✓')} ${displayName} (${mode})`);
      } else {
        failCount++;
        resultLines.push(`  ${pc.red('✗')} ${displayName}: ${agentResult.error || 'unknown error'}`);
      }
    }

    const title = pc.green(`安装了 ${successCount} 个 Agent`);
    p.note(resultLines.join('\n'), title);

    if (result.errors.length > 0) {
      console.log();
      p.log.warn('安装过程中有警告:');
      result.errors.forEach(err => p.log.message(pc.dim(`  - ${err}`)));
    }

    console.log();
    p.outro(pc.green('完成!'));

    return result;
  } catch (err) {
    spinner.stop(pc.red('安装失败'));
    p.log.error(err.message);
    p.outro(pc.red('安装失败'));
    process.exit(1);
  }
}

/**
 * 交互式状态查看
 */
async function runInteractiveStatus(options = {}) {
  const { global = true, cwd = process.cwd() } = options;

  showLogo();
  console.log();

  p.intro(pc.bgCyan(pc.black(' claude-workflow status ')));

  const spinner = p.spinner();
  spinner.start('获取安装状态...');

  const status = await getInstallationStatus(global, cwd);

  spinner.stop('状态获取完成');

  const lines = [];

  if (status.installed) {
    lines.push(`${pc.green('✓')} 已安装`);
    lines.push(`  ${pc.cyan('Canonical:')} ${shortenPath(status.canonicalDir)}`);
    lines.push(`  ${pc.cyan('版本:')} v${status.version || '未知'}`);
    if (status.installedAt) {
      lines.push(`  ${pc.cyan('安装时间:')} ${status.installedAt}`);
    }
  } else {
    lines.push(`${pc.yellow('○')} 未安装`);
    lines.push(`  运行 ${pc.cyan('claude-workflow sync')} 安装`);
  }

  lines.push('');
  lines.push(`${pc.cyan('Agent 状态:')}`);

  for (const [name, agentStatus] of Object.entries(status.agents)) {
    const displayName = agents[name]?.displayName || name;
    let icon, statusText;

    if (agentStatus.installed) {
      if (agentStatus.valid) {
        icon = pc.green('✓');
        statusText = pc.dim(`(${agentStatus.mode})`);
      } else {
        icon = pc.yellow('!');
        statusText = pc.yellow('(symlink 断开)');
      }
    } else if (agentStatus.detected) {
      icon = pc.blue('○');
      statusText = pc.dim('(未安装)');
    } else {
      icon = pc.dim('·');
      statusText = pc.dim('(未检测到)');
    }

    lines.push(`  ${icon} ${displayName.padEnd(16)} ${statusText}`);
  }

  console.log();
  p.note(lines.join('\n'), '安装状态');

  // 检测到的 Agent
  const detectedAgents = detectInstalledAgents();
  if (detectedAgents.length > 0) {
    console.log();
    p.log.info(`检测到的 Agent: ${detectedAgents.map(a => pc.cyan(agents[a].displayName)).join(', ')}`);
  }

  console.log();
  p.outro('');
}

module.exports = {
  showLogo,
  shortenPath,
  formatList,
  selectAgentsInteractive,
  runInteractiveInstall,
  runInteractiveStatus,
};
