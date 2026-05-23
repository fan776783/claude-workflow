import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  CURRENT_SCHEMA_VERSION,
  registerMigration,
  getMigrationPath,
  migrate,
  SchemaMigrator,
  PlanSchemaMigrator,
} = require('../schema-migration.js')

test('getMigrationPath: same version returns [n]', () => {
  // 注意: 0->1 已在模块加载时注册，无法纯隔离
  const p = getMigrationPath(1, 1)
  assert.deepEqual(p, [1])
})

test('getMigrationPath: 0->1 走已注册的路径', () => {
  const p = getMigrationPath(0, 1)
  assert.deepEqual(p, [0, 1])
})

test('getMigrationPath: 找不到路径抛错', () => {
  assert.throws(() => getMigrationPath(0, 99), /No migration path/)
})

test('migrate: 同版本透传', () => {
  const data = { schemaVersion: 1, foo: 'bar' }
  const out = migrate(data, 1, 1)
  assert.deepEqual(out, data)
})

test('migrate: 高版本数据按兼容模式透传 + warn', () => {
  const data = { schemaVersion: 99, foo: 'bar' }
  const out = migrate(data, 99, 1)
  assert.equal(out.foo, 'bar')
})

test('migrate: 0->1 输出包含 schemaVersion=1（注意多个 0->1 migrator 注册时后者覆盖前者）', () => {
  const out = migrate({}, 0, 1)
  assert.equal(out.schemaVersion, 1)
})

test('SchemaMigrator.validate: 空数据无效', () => {
  const m = new SchemaMigrator({ currentVersion: 1 })
  const r = m.validate(null)
  assert.equal(r.valid, false)
})

test('SchemaMigrator.validate: 缺 schemaVersion 标 needsMigration', () => {
  const m = new SchemaMigrator({ currentVersion: 1 })
  const r = m.validate({ foo: 'bar' })
  assert.equal(r.valid, false)
  assert.equal(r.needsMigration, true)
  assert.equal(r.fromVersion, 0)
})

test('SchemaMigrator.validate: 低版本 valid + needsMigration', () => {
  const m = new SchemaMigrator({ currentVersion: 2 })
  const r = m.validate({ schemaVersion: 1 })
  assert.equal(r.valid, true)
  assert.equal(r.needsMigration, true)
})

test('SchemaMigrator.validate: 高版本 valid + warning', () => {
  const m = new SchemaMigrator({ currentVersion: 1 })
  const r = m.validate({ schemaVersion: 5 })
  assert.equal(r.valid, true)
  assert.equal(r.needsMigration, false)
  assert.ok(r.warning)
})

test('SchemaMigrator.ensureVersion: 缺字段时补齐', () => {
  const m = new SchemaMigrator({ currentVersion: 7 })
  const out = m.ensureVersion({ foo: 'bar' })
  assert.equal(out.schemaVersion, 7)
  assert.equal(out.foo, 'bar')
})

test('SchemaMigrator.ensureVersion: 已有则保留', () => {
  const m = new SchemaMigrator({ currentVersion: 7 })
  const out = m.ensureVersion({ schemaVersion: 3 })
  assert.equal(out.schemaVersion, 3)
})

test('SchemaMigrator.readAndMigrate: 老格式读后写回新版', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-'))
  try {
    const file = path.join(dir, 'data.json')
    await fs.writeFile(file, JSON.stringify({ foo: 'bar' }))
    const m = new SchemaMigrator({ currentVersion: 1 })
    const out = await m.readAndMigrate(file, null)
    assert.equal(out.schemaVersion, 1)
    const written = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(written.schemaVersion, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('SchemaMigrator.readAndMigrate: 文件不存在 + null default → 返回 null（不写盘）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sm2-'))
  try {
    const m = new SchemaMigrator({ currentVersion: 1 })
    const out = await m.readAndMigrate(path.join(dir, 'missing.json'), null)
    assert.equal(out, null)
    // 确认没写出文件
    const entries = await fs.readdir(dir)
    assert.deepEqual(entries, [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('PlanSchemaMigrator 是 SchemaMigrator 子类，dataType=plan', () => {
  const m = new PlanSchemaMigrator()
  assert.equal(m.dataType, 'plan')
  assert.equal(m.currentVersion, CURRENT_SCHEMA_VERSION)
})
