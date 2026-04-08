#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const LOCK_FILENAME = 'worktree-provision.lock'
const LOCK_TIMEOUT_SECONDS = 10.0
const LOCK_RETRY_INTERVAL_SECONDS = 0.2

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function runGit(...args) {
  let cwd = process.cwd()
  if (args.length > 0 && args[args.length - 1] && typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1])) {
    const options = args.pop()
    cwd = options.cwd || cwd
  }
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
}

function getRepoRoot(cwd = null) {
  const result = runGit('rev-parse', '--show-toplevel', { cwd: cwd || process.cwd() })
  if (result.status === 0) return (result.stdout || '').trim()
  return null
}

function getWorktreeBaseDir(repoRoot) {
  return path.join(path.dirname(repoRoot), `.${path.basename(repoRoot)}-worktrees`)
}

function normalizePath(targetPath) {
  try {
    return fs.realpathSync.native(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

function getLockPath(repoRoot) {
  return path.join(repoRoot, '.git', LOCK_FILENAME)
}

function withWorktreeProvisionLock(repoRoot, callback) {
  const lockPath = getLockPath(repoRoot)
  const deadline = Date.now() + LOCK_TIMEOUT_SECONDS * 1000
  let fd = null

  while (true) {
    try {
      fd = fs.openSync(lockPath, 'wx')
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for worktree provisioning lock after ${LOCK_TIMEOUT_SECONDS.toFixed(1)}s: ${lockPath}`)
      }
      sleep(LOCK_RETRY_INTERVAL_SECONDS * 1000)
    }
  }

  try {
    fs.writeFileSync(fd, `pid=${process.pid}\nacquired_at=${new Date().toISOString()}\n`, 'utf8')
    return callback()
  } finally {
    if (fd !== null) fs.closeSync(fd)
    try {
      fs.unlinkSync(lockPath)
    } catch {
    }
  }
}

function listWorktrees(cwd = null) {
  const result = runGit('worktree', 'list', '--porcelain', { cwd: cwd || process.cwd() })
  if (result.status !== 0) return []

  const worktrees = []
  let current = {}

  for (const rawLine of String(result.stdout || '').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      if (Object.keys(current).length > 0) {
        worktrees.push(current)
        current = {}
      }
      continue
    }
    if (line.startsWith('worktree ')) current.path = line.slice(9)
    else if (line.startsWith('HEAD ')) current.head = line.slice(5)
    else if (line.startsWith('branch ')) current.branch = line.slice(7)
    else if (line === 'bare') current.bare = 'true'
    else if (line === 'detached') current.detached = 'true'
  }

  if (Object.keys(current).length > 0) worktrees.push(current)
  return worktrees
}

function activeWorktreePaths(cwd = null) {
  return new Set(listWorktrees(cwd).map((worktree) => worktree.path).filter(Boolean).map((worktreePath) => normalizePath(worktreePath)))
}

function removeStaleWorktreeDir(worktreePath, baseDir) {
  const normalizedPath = normalizePath(worktreePath)
  const normalizedBase = normalizePath(baseDir)
  if (!(normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}${path.sep}`))) return false
  if (!fs.existsSync(worktreePath) || !fs.statSync(worktreePath).isDirectory()) return true
  fs.rmSync(worktreePath, { recursive: true, force: true })
  return true
}

function createWorktree(branch, taskId, baseBranch = 'HEAD', cwd = null) {
  const root = cwd || process.cwd()
  const repoRoot = getRepoRoot(root)
  if (!repoRoot) return { error: 'Not in a git repository' }

  try {
    return withWorktreeProvisionLock(repoRoot, () => {
      const baseDir = getWorktreeBaseDir(repoRoot)
      const worktreePath = path.join(baseDir, taskId)

      if (fs.existsSync(worktreePath) && fs.statSync(worktreePath).isDirectory()) {
        if (activeWorktreePaths(root).has(normalizePath(worktreePath))) {
          return { exists: true, path: worktreePath, branch, task_id: taskId }
        }

        try {
          removeStaleWorktreeDir(worktreePath, baseDir)
        } catch (error) {
          return { error: `Failed to clean stale worktree directory ${worktreePath}: ${error.message}` }
        }
      }

      fs.mkdirSync(baseDir, { recursive: true })

      let result = runGit('worktree', 'add', '-b', branch, worktreePath, baseBranch, { cwd: root })
      if (result.status !== 0) {
        result = runGit('worktree', 'add', worktreePath, branch, { cwd: root })
        if (result.status !== 0) {
          return { error: `Failed to create worktree: ${String(result.stderr || '').trim()}` }
        }
      }

      return {
        created: true,
        path: worktreePath,
        branch,
        task_id: taskId,
        created_at: new Date().toISOString(),
      }
    })
  } catch (error) {
    return { error: error.message, task_id: taskId, branch }
  }
}

function removeWorktree(taskId, force = false, cwd = null) {
  const root = cwd || process.cwd()
  const repoRoot = getRepoRoot(root)
  if (!repoRoot) return { error: 'Not in a git repository' }

  try {
    return withWorktreeProvisionLock(repoRoot, () => {
      const worktreePath = path.join(getWorktreeBaseDir(repoRoot), taskId)
      if (!fs.existsSync(worktreePath) || !fs.statSync(worktreePath).isDirectory()) {
        return { error: `Worktree for ${taskId} not found` }
      }

      const args = ['worktree', 'remove']
      if (force) args.push('--force')
      args.push(worktreePath)

      const result = runGit(...args, { cwd: root })
      if (result.status !== 0) {
        return { error: `Failed to remove worktree: ${String(result.stderr || '').trim()}` }
      }

      return { removed: true, task_id: taskId, path: worktreePath }
    })
  } catch (error) {
    return { error: error.message, task_id: taskId }
  }
}

function cleanupWorktrees(cwd = null) {
  const root = cwd || process.cwd()
  const repoRoot = getRepoRoot(root)
  if (!repoRoot) return { error: 'Not in a git repository' }

  try {
    return withWorktreeProvisionLock(repoRoot, () => {
      const pruneResult = runGit('worktree', 'prune', { cwd: root })
      const removed = []
      const failed = []
      const baseDir = getWorktreeBaseDir(repoRoot)

      if (fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
        const active = activeWorktreePaths(root)
        for (const entry of fs.readdirSync(baseDir)) {
          const fullPath = path.join(baseDir, entry)
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory() && !active.has(normalizePath(fullPath))) {
            try {
              removeStaleWorktreeDir(fullPath, baseDir)
              removed.push(entry)
            } catch (error) {
              failed.push({ path: fullPath, error: error.message })
            }
          }
        }
      }

      return {
        pruned: pruneResult.status === 0,
        removed_stale_dirs: removed,
        failed_stale_dirs: failed,
      }
    })
  } catch (error) {
    return { error: error.message }
  }
}

function parseOption(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function main() {
  const args = process.argv.slice(2)
  const command = args.shift()
  let result

  if (command === 'create') {
    if (!hasFlag(args, '--branch') || !hasFlag(args, '--task-id')) {
      process.stderr.write('Missing required arguments\n')
      process.exitCode = 1
      return
    }
    result = createWorktree(parseOption(args, '--branch'), parseOption(args, '--task-id'), parseOption(args, '--base') || 'HEAD')
  } else if (command === 'list') {
    const worktrees = listWorktrees()
    result = { worktrees, count: worktrees.length }
  } else if (command === 'remove') {
    if (!hasFlag(args, '--task-id')) {
      process.stderr.write('Missing required arguments\n')
      process.exitCode = 1
      return
    }
    result = removeWorktree(parseOption(args, '--task-id'), hasFlag(args, '--force'))
  } else if (command === 'cleanup') {
    result = cleanupWorktrees()
  } else {
    process.stderr.write('Usage: node worktree_manager.js <create|list|remove|cleanup> ...\n')
    process.exitCode = 1
    return
  }

  printJson(result)
}

const _run_git = runGit
const get_repo_root = getRepoRoot
const get_worktree_base_dir = getWorktreeBaseDir
const list_worktrees = listWorktrees
const create_worktree = createWorktree
const remove_worktree = removeWorktree
const cleanup_worktrees = cleanupWorktrees

module.exports = {
  LOCK_FILENAME,
  LOCK_TIMEOUT_SECONDS,
  LOCK_RETRY_INTERVAL_SECONDS,
  runGit,
  getRepoRoot,
  getWorktreeBaseDir,
  listWorktrees,
  createWorktree,
  removeWorktree,
  cleanupWorktrees,
  _run_git,
  get_repo_root,
  get_worktree_base_dir,
  list_worktrees,
  create_worktree,
  remove_worktree,
  cleanup_worktrees,
}

if (require.main === module) main()
