const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const repoRoot = path.resolve(__dirname, '..')
const sourceEnvModule = path.join(repoRoot, 'core', 'skills', 'api-smoke', 'assets', '_shared', 'env.mjs')

function snapshotSmokeEnv() {
  const snapshot = {}
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SMOKE_')) snapshot[key] = process.env[key]
  }
  return snapshot
}

function restoreSmokeEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SMOKE_')) delete process.env[key]
  }
  for (const [key, value] of Object.entries(snapshot)) process.env[key] = value
}

async function importEnv({ vars = {}, envFile = null } = {}) {
  const snapshot = snapshotSmokeEnv()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'api-smoke-env-'))
  const sharedDir = path.join(tmp, '_shared')
  fs.mkdirSync(sharedDir, { recursive: true })
  const envModule = path.join(sharedDir, 'env.mjs')
  fs.copyFileSync(sourceEnvModule, envModule)
  if (envFile !== null) fs.writeFileSync(path.join(tmp, '.env.smoke'), envFile)

  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SMOKE_')) delete process.env[key]
    }
    if (envFile === null) {
      process.env.SMOKE_HOST = 'api.example.com'
      process.env.SMOKE_COOKIE = 'sid=abc; token=def'
    }
    for (const [key, value] of Object.entries(vars)) process.env[key] = value

    const imported = await import(`${pathToFileURL(envModule).href}?case=${Date.now()}-${Math.random()}`)
    return { env: imported.env, extractCookieValue: imported.extractCookieValue, warnings, tmp }
  } finally {
    console.warn = originalWarn
    restoreSmokeEnv(snapshot)
  }
}

test('SMOKE_HEADER_* converts env names to canonical headers', async () => {
  const { env } = await importEnv({
    vars: {
      SMOKE_HEADER_X_FOO_BAR: 'baz',
      SMOKE_HEADER_AUTHORIZATION: 'Bearer secret',
    },
  })

  assert.deepEqual(env.extraHeaders, {
    Authorization: 'Bearer secret',
    'X-Foo-Bar': 'baz',
  })
  assert.deepEqual(env.sensitiveHeaders, [])
})

test('plain empty SMOKE_HEADER_* values are skipped', async () => {
  const { env } = await importEnv({
    vars: {
      SMOKE_HEADER_X_EMPTY: '',
      SMOKE_HEADER_X_PRESENT: '1',
    },
  })

  assert.deepEqual(env.extraHeaders, { 'X-Present': '1' })
})

test('@cookie header values are extracted and marked sensitive', async () => {
  const { env } = await importEnv({
    vars: {
      SMOKE_HEADER_X_SN: '@cookie:sid',
      SMOKE_HEADER_X_MISSING: '@cookie:not_there',
    },
  })

  assert.deepEqual(env.extraHeaders, {
    'X-Missing': '',
    'X-Sn': 'abc',
  })
  assert.deepEqual(env.sensitiveHeaders, ['X-Missing', 'X-Sn'])
})

test('@secret header values strip the prefix and are marked sensitive', async () => {
  const { env } = await importEnv({
    vars: {
      SMOKE_HEADER_X_API_KEY: '@secret:super-secret',
      SMOKE_HEADER_X_SPACE_ID: '123',
    },
  })

  assert.deepEqual(env.extraHeaders, {
    'X-Api-Key': 'super-secret',
    'X-Space-Id': '123',
  })
  assert.deepEqual(env.sensitiveHeaders, ['X-Api-Key'])
})

test('SMOKE_HEADER_HOST and SMOKE_HEADER_COOKIE are rejected', async () => {
  const { env, warnings } = await importEnv({
    vars: {
      SMOKE_HEADER_HOST: 'evil.example.com',
      SMOKE_HEADER_COOKIE: 'sid=leak',
      SMOKE_HEADER_X_SAFE: 'ok',
    },
  })

  assert.deepEqual(env.extraHeaders, { 'X-Safe': 'ok' })
  assert.equal(warnings.length, 2)
  assert.match(warnings.join('\n'), /SMOKE_HEADER_HOST/)
  assert.match(warnings.join('\n'), /SMOKE_HEADER_COOKIE/)
})

test('.env.smoke parser strips unquoted inline comments', async () => {
  const { env } = await importEnv({
    vars: {},
    envFile: [
      'SMOKE_HOST=env.example.com # comment',
      'SMOKE_COOKIE=sid=abc; token=def # comment',
      'SMOKE_HEADER_X_INLINE=abc # comment',
      'SMOKE_HEADER_X_QUOTED="a#b" # comment',
      'SMOKE_HEADER_X_EMPTY= # comment',
      '',
    ].join('\n'),
  })

  assert.equal(env.host, 'env.example.com')
  assert.equal(env.cookie, 'sid=abc; token=def')
  assert.deepEqual(env.extraHeaders, {
    'X-Inline': 'abc',
    'X-Quoted': 'a#b',
  })
})

test('extractCookieValue returns an empty string for missing cookie keys', async () => {
  const { extractCookieValue } = await importEnv()

  assert.equal(extractCookieValue('sid=abc; token=def', 'token'), 'def')
  assert.equal(extractCookieValue('sid=abc; token=def', 'missing'), '')
})
