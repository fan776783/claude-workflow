const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const CLI = path.join(repoRoot, 'core', 'skills', 'figma-data', 'cli', 'figma.mjs')

// Minimal mock of the Figma Desktop MCP Server (Streamable HTTP, JSON responses):
// initialize → result + mcp-session-id header; notifications → 202; tools/call → text content.
// Records tools/call arguments per tool name so tests can assert forward-not-inject semantics.
function startMockMcpServer() {
  const calls = {}
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw) } catch {}
      if (body.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'mock-session' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            serverInfo: { name: 'mock-figma', version: '0.0.1' },
          },
        }))
        return
      }
      if (!('id' in body)) {
        res.writeHead(202)
        res.end()
        return
      }
      if (body.method === 'tools/call') {
        calls[body.params.name] = body.params.arguments || {}
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'mock design context' }] },
        }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}/mcp` })
    })
  })
}

// Spawns `figma.mjs design` against the mock server with an isolated assetsDir.
// Slow by design: cmdDesign hard-waits 3s for async asset writes.
function runDesign(url, extraArgs) {
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-cli-test-'))
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI, 'design', '--nodeId', '1:2', '--assetsDir', assetsDir, ...extraArgs],
      { env: { ...process.env, FIGMA_MCP_URL: url }, timeout: 30000 },
      (err, stdout, stderr) => {
        try { fs.rmSync(assetsDir, { recursive: true, force: true }) } catch {}
        if (err) {
          const failure = new Error(`cli failed: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`)
          failure.exitCode = err.code
          reject(failure)
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error(`non-JSON stdout: ${stdout}`))
        }
      },
    )
  })
}

test('figma.mjs design — Design Package contract (schemaVersion 1.1 + taskType echo)', async (t) => {
  const { server, calls, url } = await startMockMcpServer()
  t.after(() => server.close())

  await t.test('echoes taskType and forwards it to get_design_context when passed', async () => {
    delete calls.get_design_context
    const out = await runDesign(url, ['--taskType', 'CHANGE_ARTIFACT'])
    assert.equal(out.schemaVersion, '1.1')
    assert.equal(out.taskType, 'CHANGE_ARTIFACT')
    assert.equal(out.designContext, 'mock design context')
    assert.ok(out.taskDir, 'taskDir present')
    assert.equal(calls.get_design_context.taskType, 'CHANGE_ARTIFACT', 'forwarded to MCP')
  })

  await t.test('defaults taskType to CREATE_ARTIFACT when flag omitted, without injecting it into MCP args', async () => {
    delete calls.get_design_context
    const out = await runDesign(url, [])
    assert.equal(out.schemaVersion, '1.1')
    assert.equal(out.taskType, 'CREATE_ARTIFACT')
    assert.equal('taskType' in calls.get_design_context, false, 'default is echo-only, not injected')
  })

  await t.test('rejects invalid --taskType with exit code 6 (enum_invalid)', async () => {
    await assert.rejects(
      runDesign(url, ['--taskType', 'CHANGE_ARTEFACT']),
      (err) => {
        assert.equal(err.exitCode, 6, 'enum_invalid exit code per ADR-0001 buckets')
        assert.match(err.message, /invalid --taskType "CHANGE_ARTEFACT"/)
        return true
      },
    )
  })
})
