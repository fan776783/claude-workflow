/**
 * 交互式菜单模块
 */

const inquirer = require('inquirer');
const { spawn } = require('child_process');
const path = require('path');
const pkg = require('../package.json');

/**
 * 显示主菜单
 */
async function showMenu() {
  console.log();
  console.log('  Claude Workflow 多模型协作工具');
  console.log(`  v${pkg.version}`);
  console.log();

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: '选择操作：',
    choices: [
      { name: '➜ 同步模板到 ~/.claude (sync)', value: 'sync' },
      { name: '➜ 初始化项目配置 (init)', value: 'init' },
      { name: '➜ 查看安装状态 (status)', value: 'status' },
      { name: '⚙ 诊断配置问题 (doctor)', value: 'doctor' },
      new inquirer.Separator(),
      { name: '✕ 退出', value: 'exit' }
    ]
  }]);

  return action;
}

/**
 * 执行菜单选择的操作（使用子进程避免模块缓存问题）
 */
async function executeAction(action) {
  if (action === 'exit') {
    console.log('  Goodbye!');
    return;
  }

  const cliPath = path.join(__dirname, '..', 'bin', 'claude-workflow.js');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, action], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('close', (code) => {
      if (code !== 0) {
        process.exitCode = code;
      }
      resolve();
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 运行交互式菜单
 */
async function run() {
  try {
    const action = await showMenu();
    await executeAction(action);
  } catch (err) {
    if (err.isTtyError) {
      console.error('[claude-workflow] 交互式菜单需要 TTY 环境');
      console.log('使用: claude-workflow <command>');
      console.log('可用命令: sync, init, status, doctor');
    } else {
      console.error(`[claude-workflow] 菜单错误: ${err.message}`);
    }
    process.exitCode = 1;
  }
}

module.exports = { showMenu, executeAction, run };
