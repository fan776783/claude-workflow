#!/usr/bin/env node
/**
 * autogen 响应类型 vs 最近一次 NDJSON 日志里的实际响应 → diff。
 * 只报告字段偏差,不改代码。
 *
 * 占位实现:skill 生成时按项目 autogen 结构调整。
 *   1. 读 logs 最新 ndjson,按 url 归并每个接口的首个成功响应
 *   2. 读 autogen/*.ts(简单正则抓接口名 + 响应类型声明)
 *   3. diff: autogen 有但响应无 / 响应有但 autogen 无 / 类型明显不符(string vs number)
 *   4. 输出 markdown 表格,追加到 report.md 的 "contract-drift" 段
 */
console.log('contract-check: 占位脚本,按项目 autogen 结构定制后启用');
