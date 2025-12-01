// @pic/claude-workflow
// Claude Code 工作流工具包

const installer = require('./installer');

module.exports = {
  ...installer,
  version: require('../package.json').version
};
