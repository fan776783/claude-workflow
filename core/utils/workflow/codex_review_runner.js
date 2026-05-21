#!/usr/bin/env node
/**
 * codex_review_runner — workflow 自动触发 codex spec/plan review 的 consumer。
 *
 * 解决问题：plan_composer 把 review_status.codex_*_review.status 设为 "pending" + 写入
 * trigger_reason，但历史上 runtime 没有 consumer 真去拉 codex job，等于 dead config。
 *
 * 设计：
 *   - trigger 走 spawn codex-bridge.mjs --background (fire-and-forget)，立即拿 jobId 写回 state
 *   - scan 直接同步读 ~/.claude/tmp/codex-jobs/<bucket>/<jobId>.json（避免 ESM/CJS 跨模块导入）
 *   - 入口（plan / status / execute）调 scanCodexJobsForResume，无 codex review 时 short-circuit
 *   - 单 job halted > 120min → status=manual_review_required，由用户手动决策
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled'])
const CODEX_BRIDGE_PATH = path.resolve(__dirname, '../../skills/collaborating-with-codex/scripts/codex-bridge.mjs')
const CODEX_JOB_TTL_MS = 120 * 60 * 1000 // 120 min
const CODEX_BUCKET_ROOT = path.join(os.homedir(), '.claude/tmp/codex-jobs')

// 复用 codex-bridge lib/state.mjs:resolveBucketDir 的算法：
// slugify(basename(canonical)) + '-' + sha256(canonical).slice(0,8)。
// 避免 import ESM —— 这里手写同样的逻辑。任何上游变更应同步更新此函数。
function slugifyBasename(basename) {
  const slug = String(basename || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'workspace'
}

function bucketDirForCwd(cwd) {
  let canonical
  try { canonical = fs.realpathSync.native ? fs.realpathSync.native(cwd) : fs.realpathSync(cwd) } catch { canonical = path.resolve(cwd) }
  const slug = slugifyBasename(path.basename(canonical))
  const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 8)
  return path.join(CODEX_BUCKET_ROOT, `${slug}-${hash}`)
}

function readJobJsonSync(bucket, jobId) {
  if (!bucket || !jobId) return null
  const p = path.join(bucket, `${jobId}.json`)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function isJobTerminal(job) {
  return Boolean(job && TERMINAL_STATES.has(job.status))
}

// short-circuit：是否有任何 codex review 处于 active 状态。无则跳过 scan。
function hasActiveCodexReview(state) {
  const rs = (state && state.review_status) || {}
  const spec = rs.codex_spec_review || {}
  const plan = rs.codex_plan_review || {}
  const active = new Set(['pending', 'in_progress'])
  return active.has(spec.status) || active.has(plan.status)
}

// 触发一次 codex review job：spawn codex-bridge.mjs --background fire-and-forget。
// 不阻塞主线 — 立即拿 jobId 写回 state，由后续入口 scan 续接终态。
function triggerCodexReview(state, phase, options = {}) {
  const projectRoot = options.projectRoot || state.project_root || process.cwd()
  const reviewKey = `codex_${phase}_review`
  const reviewStatus = (state.review_status || {})
  const review = reviewStatus[reviewKey]
  if (!review) return { triggered: false, reason: 'no-review-record' }
  if (review.status !== 'pending') return { triggered: false, reason: `status:${review.status}` }
  if (!review.trigger_reason) return { triggered: false, reason: 'no-trigger-reason' }

  // 用 codex-bridge --review working-tree --background 触发只读 review。
  const args = [CODEX_BRIDGE_PATH, '--cd', projectRoot, '--review', 'working-tree', '--background']
  let result
  try {
    result = spawnSync('node', args, { encoding: 'utf8', timeout: 30000 })
  } catch (err) {
    return { triggered: false, reason: 'spawn-error', error: String(err) }
  }
  if (!result || result.status !== 0) {
    return { triggered: false, reason: `bridge-exit-${result && result.status}`, stderr: result && result.stderr }
  }
  let payload = {}
  try { payload = JSON.parse(result.stdout) } catch {
    return { triggered: false, reason: 'invalid-json-from-bridge', stdout: result.stdout }
  }
  if (!payload.jobId) return { triggered: false, reason: 'no-job-id', payload }

  review.job_id = payload.jobId
  review.log_file = payload.logFile || null
  review.bucket = bucketDirForCwd(projectRoot)
  review.dispatched_at = new Date().toISOString()
  review.status = 'in_progress'
  return { triggered: true, jobId: payload.jobId, logFile: payload.logFile }
}

// 入口扫描：遍历所有 in_progress codex review，pull job 终态写回；> 120min TTL → manual。
// 调用方应在主入口（workflow-status / workflow-execute / workflow-plan）读 state 后立即调用。
function scanCodexJobsForResume(state, options = {}) {
  if (!hasActiveCodexReview(state)) return { scanned: 0, resumed: 0, expired: 0, short_circuit: true }
  const now = Date.now()
  let scanned = 0, resumed = 0, expired = 0
  for (const phase of ['spec', 'plan']) {
    const reviewKey = `codex_${phase}_review`
    const review = ((state.review_status || {})[reviewKey])
    if (!review || review.status !== 'in_progress' || !review.job_id || !review.bucket) continue
    scanned++
    const job = readJobJsonSync(review.bucket, review.job_id)
    if (isJobTerminal(job)) {
      review.status = (job.status === 'completed') ? 'completed' : 'failed'
      review.completed_at = new Date().toISOString()
      review.codex_status = job.status
      review.session_id = job.sessionId || null
      review.reviewed_at = review.completed_at
      review.attempt = Number(review.attempt || 0) + 1
      // issues 从 job.agentMessages / job.reviewText 解析交给上游（这里只记 raw status）。
      resumed++
      continue
    }
    // 仍未终态：检查 TTL
    const dispatchedAt = review.dispatched_at ? Date.parse(review.dispatched_at) : now
    if (now - dispatchedAt > CODEX_JOB_TTL_MS) {
      review.status = 'manual_review_required'
      review.expired_at = new Date().toISOString()
      expired++
    }
  }
  return { scanned, resumed, expired, short_circuit: false }
}

module.exports = {
  TERMINAL_STATES,
  CODEX_JOB_TTL_MS,
  CODEX_BUCKET_ROOT,
  bucketDirForCwd,
  hasActiveCodexReview,
  triggerCodexReview,
  scanCodexJobsForResume,
  readJobJsonSync,
}
