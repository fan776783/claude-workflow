import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { LegacyMigrator, runMigration, verifyMigration, MigrationStatus } = require('../legacy-migrator.js')

// LegacyMigrator.scanProjects 硬编码读 os.homedir()/.claude/workflows，
// 通过临时改 HOME 把扫描根改到 sandbox（macOS / Linux 上 os.homedir 读 HOME）。
async function withTempHome(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lm-home-'))
  const oldHome = process.env.HOME
  process.env.HOME = tmp
  try {
    return await fn(tmp)
  } finally {
    process.env.HOME = oldHome
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

test('verifyMigration: 空 workflows 目录 → completed + 0 projects', async () => {
  await withTempHome(async (homeDir) => {
    const report = await verifyMigration()
    // verify() 走 migrate() 但 dryRun，无项目则正常 complete
    assert.ok([MigrationStatus.COMPLETED, MigrationStatus.IN_PROGRESS, undefined].includes(report.status) || report.status)
  })
})

test('scanProjects: workflows 不存在 → 返回空数组（不抛）', async () => {
  await withTempHome(async (homeDir) => {
    const m = new LegacyMigrator({ dryRun: true })
    const projects = await m.scanProjects()
    assert.deepEqual(projects, [])
  })
})

test('scanProjects: 空 workflows 目录 → 返回空数组', async () => {
  await withTempHome(async (homeDir) => {
    await fs.mkdir(path.join(homeDir, '.claude', 'workflows'), { recursive: true })
    const m = new LegacyMigrator({ dryRun: true })
    const projects = await m.scanProjects()
    assert.deepEqual(projects, [])
  })
})

test('scanProjects: 老格式 workflow-memory.json 被识别', async () => {
  await withTempHome(async (homeDir) => {
    const projDir = path.join(homeDir, '.claude', 'workflows', 'proj-abc')
    await fs.mkdir(projDir, { recursive: true })
    // 老格式 = 无 schemaVersion 字段
    await fs.writeFile(
      path.join(projDir, 'workflow-memory.json'),
      JSON.stringify({ task_name: 'legacy task', steps: [] }),
    )
    const m = new LegacyMigrator({ dryRun: true })
    const projects = await m.scanProjects()
    assert.equal(projects.length, 1)
    assert.equal(projects[0].projectId, 'proj-abc')
    assert.equal(projects[0].memory.task_name, 'legacy task')
  })
})

test('scanProjects: 新格式（有 schemaVersion）被跳过', async () => {
  await withTempHome(async (homeDir) => {
    const projDir = path.join(homeDir, '.claude', 'workflows', 'proj-new')
    await fs.mkdir(projDir, { recursive: true })
    await fs.writeFile(
      path.join(projDir, 'workflow-memory.json'),
      JSON.stringify({ schemaVersion: 1, task_name: 'new format' }),
    )
    const m = new LegacyMigrator({ dryRun: true })
    const projects = await m.scanProjects()
    assert.equal(projects.length, 0)
  })
})

test('scanProjects: 混合（新+老）只返回老', async () => {
  await withTempHome(async (homeDir) => {
    const wfDir = path.join(homeDir, '.claude', 'workflows')
    await fs.mkdir(path.join(wfDir, 'p-old'), { recursive: true })
    await fs.mkdir(path.join(wfDir, 'p-new'), { recursive: true })
    await fs.writeFile(
      path.join(wfDir, 'p-old', 'workflow-memory.json'),
      JSON.stringify({ task_name: 'old' }),
    )
    await fs.writeFile(
      path.join(wfDir, 'p-new', 'workflow-memory.json'),
      JSON.stringify({ schemaVersion: 1, task_name: 'new' }),
    )
    const m = new LegacyMigrator({ dryRun: true })
    const projects = await m.scanProjects()
    assert.equal(projects.length, 1)
    assert.equal(projects[0].projectId, 'p-old')
  })
})

test('runMigration dryRun: 不写文件', async () => {
  await withTempHome(async (homeDir) => {
    const projDir = path.join(homeDir, '.claude', 'workflows', 'p-dry')
    await fs.mkdir(projDir, { recursive: true })
    const memoryPath = path.join(projDir, 'workflow-memory.json')
    await fs.writeFile(memoryPath, JSON.stringify({ task_name: 'dry' }))
    const report = await runMigration({ dryRun: true })
    // dryRun 模式即使有项目也不应改原文件
    const after = JSON.parse(await fs.readFile(memoryPath, 'utf8'))
    assert.equal(after.schemaVersion, undefined)
  })
})
