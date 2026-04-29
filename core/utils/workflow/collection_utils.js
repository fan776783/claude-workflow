#!/usr/bin/env node
/** @file 通用集合/字符串小工具 - 与状态领域解耦 */

function addUnique(arr, item) {
  if (!arr.includes(item)) arr.push(item)
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  addUnique,
  escapeRegExp,
}
