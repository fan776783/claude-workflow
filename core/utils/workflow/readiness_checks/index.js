#!/usr/bin/env node
/**
 * @file index.js — readiness_checks dispatcher。
 *
 * 自动扫描同目录 `.js` 文件（排除自身），按各模块导出的 `name` 建 registry。
 * 导出 `runReadiness(checkNames, projectRoot, options)`：按声明顺序逐项执行 check，
 * 汇总 missing。未注册的 check name → throw 带 `code: 'CHECK_NOT_REGISTERED'` 的 Error。
 *
 * CommonJS。
 */

const fs = require('fs')
const path = require('path')

/**
 * 自动扫描同目录 .js 文件（排除 index.js）→ registry `{ [name]: { check, fix? } }`。
 *
 * @returns {Object<string, {check:Function, fix?:Function}>}
 */
function buildRegistry() {
  const registry = {}
  const entries = fs.readdirSync(__dirname, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.js')) continue
    if (entry.name === 'index.js') continue
    const mod = require(path.join(__dirname, entry.name))
    if (!mod || typeof mod.name !== 'string' || typeof mod.check !== 'function') continue
    registry[mod.name] = { check: mod.check, fix: typeof mod.fix === 'function' ? mod.fix : undefined }
  }
  return registry
}

const REGISTRY = buildRegistry()

/**
 * 按声明顺序执行 readiness check。
 *
 * @param {string[]} checkNames  project-config workflow.readiness 数组
 * @param {string} projectRoot  项目根绝对路径
 * @param {object} [options]  每 check 的 options，形如 `{ [checkName]: {...} }`
 * @returns {{ready:boolean, missing:Array<{check:string, reason:string, suggested_fix:string}>, applied:string[]}}
 * @throws {Error} 当某 check name 未注册时，error.code === 'CHECK_NOT_REGISTERED'，error.check === name
 */
function runReadiness(checkNames, projectRoot, options) {
  if (!Array.isArray(checkNames) || checkNames.length === 0) {
    return { ready: true, missing: [], applied: [] }
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

  return { ready: missing.length === 0, missing, applied: [] }
}

module.exports = { runReadiness, REGISTRY }
