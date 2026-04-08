#!/usr/bin/env node

const { cmdTeamArchive, cmdTeamCleanup, cmdTeamExecute, cmdTeamStart, cmdTeamStatus } = require('./lifecycle')

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
  if (['start', 'execute', 'status', 'archive', 'cleanup'].includes(candidate)) {
    const requirement = positionals.join(' ').trim()
    return { options, command: candidate, requirement: requirement || undefined }
  }
  return { options, command: 'start', requirement: [candidate, ...positionals].join(' ').trim() }
}

function printHelp() {
  process.stdout.write(`team CLI

Usage:
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] start <requirement|path> [--force] [--no-discuss] [--team-name NAME]
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] execute
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] status
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] archive [--summary]
  node team-cli.js [--project-id ID] [--project-root DIR] [--team-id ID] cleanup

Notes:
  start bootstraps a dedicated team runtime and writes team-specific planning artifacts.
  execute/status/archive/cleanup operate on that team runtime only.
`)
}

function main() {
  try {
    const { options, command, requirement } = parseArgs(process.argv.slice(2))
    let result
    if (command === 'start') {
      if (!requirement) throw new Error('start requires a requirement or requirement file')
      result = cmdTeamStart(requirement, { ...options, invocationSource: 'team-command' })
    } else if (command === 'execute') {
      result = cmdTeamExecute({ ...options, invocationSource: 'team-command', allowActiveFallback: true })
    } else if (command === 'status') {
      result = cmdTeamStatus({ ...options, invocationSource: 'team-command', allowActiveFallback: true })
    } else if (command === 'archive') {
      result = cmdTeamArchive({ ...options, invocationSource: 'team-command', allowActiveFallback: true })
    } else if (command === 'cleanup') {
      result = cmdTeamCleanup({ ...options, invocationSource: 'team-command' })
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
