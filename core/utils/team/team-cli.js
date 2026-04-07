#!/usr/bin/env node

const { cmdTeamArchive, cmdTeamExecute, cmdTeamStart, cmdTeamStatus } = require('./lifecycle')

function parseArgs(argv) {
  const args = [...argv]
  const options = { projectId: undefined, projectRoot: undefined, teamId: undefined, force: false, noDiscuss: false, summary: false, teamName: undefined }
  while (args.length && args[0].startsWith('--')) {
    const flag = args.shift()
    if (flag === '--project-id') options.projectId = args.shift()
    else if (flag === '--project-root') options.projectRoot = args.shift()
    else if (flag === '--team-id') options.teamId = args.shift()
    else if (flag === '--team-name') options.teamName = args.shift()
    else if (flag === '--force') options.force = true
    else if (flag === '--no-discuss') options.noDiscuss = true
    else if (flag === '--summary') options.summary = true
    else throw new Error(`Unknown flag: ${flag}`)
  }
  const command = args.shift()
  const requirement = args.shift()
  return { options, command, requirement }
}

function printHelp() {
  process.stdout.write(`team CLI\n\nUsage:\n  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] start <requirement> [--force] [--no-discuss] [--team-name NAME]\n  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] execute\n  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] status\n  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] archive [--summary]\n`)
}

function main() {
  try {
    const { options, command, requirement } = parseArgs(process.argv.slice(2))
    let result
    if (command === 'start') {
      if (!requirement) throw new Error('start requires a requirement')
      result = cmdTeamStart(requirement, options)
    } else if (command === 'execute') {
      result = cmdTeamExecute(options)
    } else if (command === 'status') {
      result = cmdTeamStatus(options)
    } else if (command === 'archive') {
      result = cmdTeamArchive(options)
    } else {
      printHelp()
      process.exitCode = command ? 1 : 0
      return
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

main()
