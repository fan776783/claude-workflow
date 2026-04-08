#!/usr/bin/env node

const { cmdTeamArchive, cmdTeamExecute, cmdTeamStart, cmdTeamStatus } = require('./lifecycle')

function parseArgs(argv) {
  const args = [...argv]
  const options = { projectId: undefined, projectRoot: undefined, teamId: undefined, force: false, noDiscuss: false, summary: false, teamName: undefined }
  const positionals = []

  while (args.length) {
    const token = args.shift()
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    if (token === '--project-id') options.projectId = args.shift()
    else if (token === '--project-root') options.projectRoot = args.shift()
    else if (token === '--team-id') options.teamId = args.shift()
    else if (token === '--team-name') options.teamName = args.shift()
    else if (token === '--force') options.force = true
    else if (token === '--no-discuss') options.noDiscuss = true
    else if (token === '--summary') options.summary = true
    else throw new Error(`Unknown flag: ${token}`)
  }

  const candidate = positionals.shift()
  if (!candidate) return { options, command: undefined, requirement: undefined }
  if (['start', 'execute', 'status', 'archive'].includes(candidate)) {
    const requirement = positionals.join(' ').trim()
    return { options, command: candidate, requirement: requirement || undefined }
  }
  return { options, command: 'start', requirement: [candidate, ...positionals].join(' ').trim() }
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
