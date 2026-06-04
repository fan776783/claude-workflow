#!/usr/bin/env node
/**
 * @file index.js — readiness_checks dispatcher。
 *
 * registry 为字面量 map（仅两个静态 check，无需目录扫描）。
 * 导出 `runReadiness(checkNames, projectRoot, options)`：按声明顺序逐项执行 check，
 * 汇总 missing。未注册的 check name → throw 带 `code: 'CHECK_NOT_REGISTERED'` 的 Error。
 *
 * CommonJS。
 */

const nodeModulesCheck = require('./node_modules')
const commandRunnableCheck = require('./command_runnable')

const REGISTRY = {
  [nodeModulesCheck.name]: { check: nodeModulesCheck.check },
  [commandRunnableCheck.name]: { check: commandRunnableCheck.check },
}

/**
 * 按声明顺序执行 readiness check。
 *
 * @param {string[]} checkNames  project-config workflow.readiness 数组
 * @param {string} projectRoot  项目根绝对路径
 * @param {object} [options]  每 check 的 options，形如 `{ [checkName]: {...} }`
 * @returns {{ready:boolean, missing:Array<{check:string, reason:string, suggested_fix:string}>}}
 * @throws {Error} 当某 check name 未注册时，error.code === 'CHECK_NOT_REGISTERED'，error.check === name
 */
function runReadiness(checkNames, projectRoot, options) {
  if (!Array.isArray(checkNames) || checkNames.length === 0) {
    return { ready: true, missing: [] }
  }

  const missing = []
  for (const name of checkNames) {
    const entry = REGISTRY[name]
    if (!entry) {
      const error = new Error(`readiness check not registered: ${name}`)
      error.code = 'CHECK_NOT_REGISTERED'
      error.check = name
      throw error
    }
    const result = entry.check(projectRoot, options && options[name]) || {}
    if (!result.ok) {
      missing.push({
        check: name,
        reason: result.reason || '',
        suggested_fix: result.suggested_fix || '',
      })
    }
  }

  return { ready: missing.length === 0, missing }
}

module.exports = { runReadiness, REGISTRY }
