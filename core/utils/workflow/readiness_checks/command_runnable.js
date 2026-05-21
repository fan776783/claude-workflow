#!/usr/bin/env node
/**
 * @file command_runnable.js — readiness check：某命令可执行（跑 `<command> --help` 不报错）。
 *
 * 通过 project-config.json 的 `workflow.readinessOptions.command_runnable = { command: "pnpm" }`
 * 配置目标命令。本期实现并预留扩展，不在默认 readiness 列表启用。
 *
 * 单文件单 named export `{ name, check }`。由 readiness_checks/index.js 自动扫描注册。
 * CommonJS。
 */

const { spawnSync } = require('child_process')

/**
 * 检查 options.command 指定的命令是否可执行。
 *
 * @param {string} projectRoot  项目根绝对路径（作为 spawnSync cwd）
 * @param {object} [options]  `{ command: string }`
 * @returns {{ok:boolean, reason?:string, suggested_fix?:string}}
 */
function check(projectRoot, options) {
  const command = options && typeof options.command === 'string' ? options.command.trim() : ''
  if (!command) {
    return {
      ok: false,
      reason: 'command_runnable 缺少 command 配置',
      suggested_fix: '在 project-config.json 设置 workflow.readinessOptions.command_runnable.command',
    }
  }

  const result = spawnSync(command, ['--help'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 10000,
  })

  // spawnSync 找不到可执行文件 → result.error（ENOENT 等）。
  if (result.error) {
    return {
      ok: false,
      reason: `命令 ${command} 不可执行: ${result.error.message}`,
      suggested_fix: `安装 ${command} 或确认其在 PATH 中`,
    }
  }
  // 命令存在但 `--help` 退出非 0 —— 视为可执行（部分 CLI 对 --help 返回非 0），不阻塞。
  return { ok: true }
}

module.exports = { name: 'command_runnable', check }
