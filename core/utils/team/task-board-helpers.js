/**
 * @file 任务看板辅助模块 - 提供看板 Markdown 构建及 task-board 核心方法的统一导出
 */
const { buildTeamTaskBoard, readTaskBoard, writeTaskBoard, summarizeTaskBoard } = require('./task-board')

/**
 * 将计划内容包装为 Markdown 格式的任务看板文档
 * @param {string} planContent - 计划文本内容
 * @returns {string} Markdown 格式的任务看板字符串
 */
function buildTaskBoardMarkdown(planContent) {
  return `# Team Task Board\n\n${planContent.trim()}\n`
}

module.exports = {
  buildTaskBoardMarkdown,
  buildTeamTaskBoard,
  readTaskBoard,
  writeTaskBoard,
  summarizeTaskBoard,
}
