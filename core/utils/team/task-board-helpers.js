const { buildTeamTaskBoard, readTaskBoard, writeTaskBoard, summarizeTaskBoard } = require('./task-board')

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
