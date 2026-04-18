#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const VALID_BATCH_ID = /^B-\d{1,6}$/
const VALID_PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/

function validateBatchId(batchId) {
  if (!batchId || !VALID_BATCH_ID.test(batchId)) {
    throw new Error(`Invalid batchId: ${batchId}. Must match ${VALID_BATCH_ID}`)
  }
}

function validateProjectId(projectId) {
  if (projectId !== null && projectId !== undefined && !VALID_PROJECT_ID.test(String(projectId))) {
    throw new Error(`Invalid projectId: ${projectId}. Must match ${VALID_PROJECT_ID}`)
  }
}

function batchNamespace(batchId, projectId) {
  validateBatchId(batchId)
  validateProjectId(projectId)
  return projectId ? `${projectId}-${batchId}` : batchId
}

function integrationBranchName(batchId, projectId) {
  return `workflow/integrate-${batchNamespace(batchId, projectId)}`
}

function runGit(args, cwd) {
  return spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
}

function getHead(cwd) {
  const result = runGit(['rev-parse', 'HEAD'], cwd)
  return result.status === 0 ? String(result.stdout || '').trim() : null
}

function getRepoRoot(cwd) {
  const result = runGit(['rev-parse', '--show-toplevel'], cwd)
  return result.status === 0 ? String(result.stdout || '').trim() : null
}

function getIntegrationWorktreeDir(repoRoot, batchId, projectId = null) {
  const namespaced = batchNamespace(batchId, projectId)
  const baseDir = path.join(path.dirname(repoRoot), `.${path.basename(repoRoot)}-worktrees`)
  const worktreePath = path.join(baseDir, `_integrate-${namespaced}`)
  const resolved = path.resolve(worktreePath)
  const resolvedBase = path.resolve(baseDir)
  if (!resolved.startsWith(`${resolvedBase}${path.sep}`) && resolved !== resolvedBase) {
    throw new Error(`Path traversal detected: ${resolved} escapes ${resolvedBase}`)
  }
  return resolved
}

function createIntegrationWorktree(repoRoot, batchId, baseBranch, projectId = null) {
  const worktreePath = getIntegrationWorktreeDir(repoRoot, batchId, projectId)
  const branch = integrationBranchName(batchId, projectId)
  const base = baseBranch || 'HEAD'

  if (fs.existsSync(worktreePath)) {
    // 复用前核对：worktree 必须属于本批次的分支，且其 base ancestor 必须与当前 base 一致
    const existingBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)
    const existingBranchName = existingBranch.status === 0 ? String(existingBranch.stdout || '').trim() : ''
    if (existingBranchName !== branch) {
      return { error: `Existing integration worktree at ${worktreePath} belongs to branch '${existingBranchName}', expected '${branch}'` }
    }
    if (base !== 'HEAD') {
      const isAncestor = runGit(['merge-base', '--is-ancestor', base, branch], repoRoot)
      if (isAncestor.status !== 0) {
        return { error: `Existing integration branch '${branch}' does not descend from base '${base}'; refusing to reuse stale worktree` }
      }
    }
    return { exists: true, path: worktreePath, branch }
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
  let result = runGit(['worktree', 'add', '-b', branch, worktreePath, base], repoRoot)
  if (result.status !== 0) {
    result = runGit(['worktree', 'add', worktreePath, branch], repoRoot)
    if (result.status !== 0) {
      return { error: `Failed to create integration worktree: ${String(result.stderr || '').trim()}` }
    }
  }

  return { created: true, path: worktreePath, branch }
}

function mergeWorktreeBranches(integrationPath, branches) {
  const results = []

  for (const { branch, taskId } of branches) {
    const result = runGit(['merge', '--no-ff', '-m', `batch-merge: ${taskId} from ${branch}`, branch], integrationPath)
    if (result.status !== 0) {
      runGit(['merge', '--abort'], integrationPath)
      results.push({
        taskId,
        branch,
        merged: false,
        error: String(result.stderr || '').trim().slice(0, 300),
      })
      continue
    }

    results.push({ taskId, branch, merged: true })
  }

  const mergedCount = results.filter((r) => r.merged).length
  const failedCount = results.filter((r) => !r.merged).length

  return {
    ok: failedCount === 0,
    results,
    merged_count: mergedCount,
    failed_count: failedCount,
    head: getHead(integrationPath),
  }
}

function finalMergeToMain(repoRoot, integrationPath, batchId, projectId = null, expectedBase = null) {
  const integrationHead = getHead(integrationPath)
  if (!integrationHead) return { error: 'Cannot resolve integration worktree HEAD' }

  const mainHead = getHead(repoRoot)
  const integrationBranch = integrationBranchName(batchId, projectId)

  // 核对 integration 分支是否确实来自 expectedBase（防止跨工作流复用陈旧分支）
  if (expectedBase) {
    const check = runGit(['merge-base', '--is-ancestor', expectedBase, integrationBranch], repoRoot)
    if (check.status !== 0) {
      return {
        error: `Integration branch '${integrationBranch}' does not descend from expected base '${expectedBase}'`,
        main_head_before: mainHead,
      }
    }
  }

  const result = runGit(['merge', '--ff-only', integrationBranch], repoRoot)
  if (result.status !== 0) {
    const fallback = runGit(['merge', '--no-ff', '-m', `batch-merge: ${batchNamespace(batchId, projectId)}`, integrationBranch], repoRoot)
    if (fallback.status !== 0) {
      return {
        error: `Merge to main failed: ${String(fallback.stderr || '').trim().slice(0, 300)}`,
        main_head_before: mainHead,
      }
    }
  }

  return {
    merged: true,
    main_head_before: mainHead,
    main_head_after: getHead(repoRoot),
    integration_commit: integrationHead,
  }
}

function discardIntegrationWorktree(repoRoot, batchId, { forceDeleteBranch = false, projectId = null } = {}) {
  const worktreePath = getIntegrationWorktreeDir(repoRoot, batchId, projectId)
  const branch = integrationBranchName(batchId, projectId)
  const errors = []

  if (fs.existsSync(worktreePath)) {
    const rmResult = runGit(['worktree', 'remove', '--force', worktreePath], repoRoot)
    if (rmResult.status !== 0) {
      errors.push(`worktree remove failed: ${String(rmResult.stderr || '').trim().slice(0, 200)}`)
    }
  }

  const branchFlag = forceDeleteBranch ? '-D' : '-d'
  const brResult = runGit(['branch', branchFlag, branch], repoRoot)
  if (brResult.status !== 0) {
    errors.push(`branch delete failed: ${String(brResult.stderr || '').trim().slice(0, 200)}`)
  }

  return { discarded: errors.length === 0, path: worktreePath, branch, errors: errors.length ? errors : undefined }
}

function countChangedFiles(cwd, fromCommit, toCommit) {
  const result = runGit(['diff', '--name-only', `${fromCommit}..${toCommit || 'HEAD'}`], cwd)
  if (result.status !== 0) return 0
  return String(result.stdout || '').trim().split('\n').filter(Boolean).length
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function main() {
  const args = [...process.argv.slice(2)]
  const command = args.shift()
  const option = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : null
  }

  if (command === 'create-integration') {
    const root = getRepoRoot(option('--cwd') || process.cwd())
    if (!root) { printJson({ error: 'Not in a git repository' }); process.exitCode = 1; return }
    printJson(createIntegrationWorktree(root, option('--batch-id') || 'test', option('--base') || 'HEAD', option('--project-id')))
    return
  }

  if (command === 'discard-integration') {
    const root = getRepoRoot(option('--cwd') || process.cwd())
    if (!root) { printJson({ error: 'Not in a git repository' }); process.exitCode = 1; return }
    printJson(discardIntegrationWorktree(root, option('--batch-id') || 'test', { projectId: option('--project-id') }))
    return
  }

  if (command === 'merge-integration') {
    const batchId = option('--batch-id')
    if (!batchId) { printJson({ error: 'merge-integration requires --batch-id' }); process.exitCode = 1; return }
    const root = getRepoRoot(option('--cwd') || process.cwd())
    if (!root) { printJson({ error: 'Not in a git repository' }); process.exitCode = 1; return }
    const projectId = option('--project-id')
    let integrationPath
    try { integrationPath = getIntegrationWorktreeDir(root, batchId, projectId) }
    catch (err) { printJson({ error: err.message }); process.exitCode = 1; return }
    const result = finalMergeToMain(root, integrationPath, batchId, projectId, option('--expected-base'))
    printJson(result)
    if (result.error) process.exitCode = 1
    return
  }

  process.stderr.write('Usage: node merge_strategist.js <create-integration|discard-integration|merge-integration> ...\n')
  process.exitCode = 1
}

module.exports = {
  runGit,
  getHead,
  getRepoRoot,
  getIntegrationWorktreeDir,
  createIntegrationWorktree,
  mergeWorktreeBranches,
  finalMergeToMain,
  discardIntegrationWorktree,
  countChangedFiles,
  batchNamespace,
  integrationBranchName,
}

if (require.main === module) main()
