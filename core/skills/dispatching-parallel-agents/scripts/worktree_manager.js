#!/usr/bin/env node

/** Git worktree 管理器 —— 负责 worktree 的创建、列举、移除和清理，带文件锁防并发竞争 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const LOCK_FILENAME = 'worktree-provision.lock'
const LOCK_TIMEOUT_SECONDS = 10.0
const LOCK_RETRY_INTERVAL_SECONDS = 0.2

/**
 * 同步阻塞式休眠
 * @param {number} ms - 休眠毫秒数
 */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 执行 git 命令的封装，支持通过末尾 options 对象指定 cwd
 * @param {...string|object} args - git 子命令参数，最后一个可为 { cwd } 选项
 * @returns {object} spawnSync 返回的结果对象
 */
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

/**
 * 获取 git 仓库根目录的绝对路径
 * @param {string|null} cwd - 起始目录
 * @returns {string|null} 仓库根目录，非 git 仓库时返回 null
 */
function getRepoRoot(cwd = null) {
  const result = runGit('rev-parse', '--show-toplevel', { cwd: cwd || process.cwd() })
  if (result.status === 0) return (result.stdout || '').trim()
  return null
}

/**
 * 根据仓库根目录计算 worktree 存放的基础目录
 * @param {string} repoRoot - 仓库根目录
 * @returns {string} worktree 基础目录路径
 */
function getWorktreeBaseDir(repoRoot) {
  return path.join(path.dirname(repoRoot), `.${path.basename(repoRoot)}-worktrees`)
}

/**
 * 将路径规范化为真实绝对路径
 * @param {string} targetPath - 目标路径
 * @returns {string} 规范化后的绝对路径
 */
function normalizePath(targetPath) {
  try {
    return fs.realpathSync.native(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

/**
 * 获取 worktree 配置锁文件路径
 * @param {string} repoRoot - 仓库根目录
 * @returns {string} 锁文件路径
 */
function getLockPath(repoRoot) {
  return path.join(repoRoot, '.git', LOCK_FILENAME)
}

/**
 * 以排他文件锁保护 worktree 配置操作，超时后抛出异常
 * @param {string} repoRoot - 仓库根目录
 * @param {Function} callback - 锁内执行的回调
 * @returns {*} 回调的返回值
 */
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

/**
 * 列出当前仓库的所有 git worktree（porcelain 格式解析）
 * @param {string|null} cwd - 工作目录
 * @returns {object[]} worktree 列表，每项含 path、head、branch 等字段
 */
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

/**
 * 获取所有活跃 worktree 的规范化路径集合
 * @param {string|null} cwd - 工作目录
 * @returns {Set<string>} 活跃 worktree 路径集合
 */
function activeWorktreePaths(cwd = null) {
  return new Set(listWorktrees(cwd).map((worktree) => worktree.path).filter(Boolean).map((worktreePath) => normalizePath(worktreePath)))
}

/**
 * 移除位于 baseDir 下的过期 worktree 目录
 * @param {string} worktreePath - worktree 目录路径
 * @param {string} baseDir - worktree 基础目录
 * @returns {boolean} 是否成功移除或目录已不存在
 */
function removeStaleWorktreeDir(worktreePath, baseDir) {
  const normalizedPath = normalizePath(worktreePath)
  const normalizedBase = normalizePath(baseDir)
  if (!(normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}${path.sep}`))) return false
  if (!fs.existsSync(worktreePath) || !fs.statSync(worktreePath).isDirectory()) return true
  fs.rmSync(worktreePath, { recursive: true, force: true })
  return true
}

/**
 * 创建 git worktree，已存在时复用，带文件锁保护
 * @param {string} branch - 分支名
 * @param {string} taskId - 任务 ID（用作目录名）
 * @param {string} baseBranch - 基础分支，默认 HEAD
 * @param {string|null} cwd - 工作目录
 * @returns {object} 创建结果，含 path 和 branch，或 error
 */
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

/**
 * 移除指定任务的 worktree，带文件锁保护
 * @param {string} taskId - 任务 ID
 * @param {boolean} force - 是否强制移除
 * @param {string|null} cwd - 工作目录
 * @returns {object} 移除结果或 error
 */
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

/**
 * 清理所有过期 worktree：先 git prune，再删除不在活跃列表中的残留目录
 * @param {string|null} cwd - 工作目录
 * @returns {object} 清理结果，含 removed_stale_dirs 和 failed_stale_dirs
 */
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
