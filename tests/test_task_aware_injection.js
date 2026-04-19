const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workflowDir = path.join(repoRoot, 'core', 'utils', 'workflow')
const taskRuntime = require(path.join(workflowDir, 'task_runtime.js'))
const taskParser = require(path.join(workflowDir, 'task_parser.js'))

function makeCodeSpecs(root, pkg) {
  const base = path.join(root, '.claude', 'code-specs')
  fs.mkdirSync(base, { recursive: true })
  fs.writeFileSync(path.join(base, 'index.md'), '# Project Code Specs\n')
  const pkgDir = path.join(base, pkg)
  fs.mkdirSync(pkgDir, { recursive: true })
  for (const layer of ['frontend', 'backend']) {
    const layerDir = path.join(pkgDir, layer)
    fs.mkdirSync(layerDir, { recursive: true })
    fs.writeFileSync(path.join(layerDir, 'index.md'), `# ${layer} Code Specs\n`)
  }
  fs.writeFileSync(path.join(pkgDir, 'frontend', 'component-guide.md'), '# component-guide\nfrontend spec body\n')
  fs.writeFileSync(path.join(pkgDir, 'frontend', 'form-validation.md'), '# form-validation\nfrontend form spec\n')
  // 3 个 backend spec：a/b 各自填充到接近 per-file 600 char 上限，z-target 是 hint 目标。
  // 这样在紧 budget 下只能装 1 份 spec，字母序先挑 a-shared 就会把 z-target 挤出预算。
  // safeReadCodeSpecs 对单文件有 600 字符上限，这里填到 ~580 确保每个 block 都占满读入窗口。
  const PAD = 'x'.repeat(560)
  fs.writeFileSync(path.join(pkgDir, 'backend', 'a-shared-constants.md'), `# a-shared-constants\n${PAD}\n`)
  fs.writeFileSync(path.join(pkgDir, 'backend', 'b-error-matrix.md'), `# b-error-matrix\n${PAD}\n`)
  fs.writeFileSync(path.join(pkgDir, 'backend', 'z-target-spec.md'), `# z-target-spec\nTARGET_SPEC_MARKER\n${PAD}\n`)
  const guidesDir = path.join(base, 'guides')
  fs.mkdirSync(guidesDir, { recursive: true })
  fs.writeFileSync(path.join(guidesDir, 'index.md'), '# Guides\n')
}

test('task-aware code-specs injection', async (t) => {
  await t.test('normalizeTargetLayer accepts whitelist only', () => {
    assert.equal(taskParser.normalizeTargetLayer('frontend'), 'frontend')
    assert.equal(taskParser.normalizeTargetLayer('BACKEND'), 'backend')
    assert.equal(taskParser.normalizeTargetLayer('guides'), 'guides')
    assert.equal(taskParser.normalizeTargetLayer('mobile'), '')
    assert.equal(taskParser.normalizeTargetLayer('../evil'), '')
    assert.equal(taskParser.normalizeTargetLayer(''), '')
  })

  await t.test('parseTasksV2 extracts Target Layer field', () => {
    const content = [
      '## T1: frontend task',
      '- **Package**: my-app',
      '- **Target Layer**: frontend',
      '- **创建文件**: src/components/Foo.tsx',
      '',
      '## T2: backend task',
      '- **Package**: my-app',
      '- **Target Layer**: backend',
      '',
      '## T3: no layer declared',
      '- **Package**: my-app',
      '',
      '## T4: invalid layer',
      '- **Package**: my-app',
      '- **Target Layer**: mobile',
      '',
    ].join('\n')
    const tasks = taskParser.parseTasksV2(content)
    assert.equal(tasks.find((t) => t.id === 'T1').target_layer, 'frontend')
    assert.equal(tasks.find((t) => t.id === 'T2').target_layer, 'backend')
    assert.equal(tasks.find((t) => t.id === 'T3').target_layer, '')
    assert.equal(tasks.find((t) => t.id === 'T4').target_layer, '', 'invalid value should drop')
  })

  await t.test('resolveActiveCodeSpecsScope carries taskLayer + changedFileHints from task', () => {
    const runtime = {
      projectRoot: repoRoot,
      currentTask: {
        package: 'my-pkg',
        target_layer: 'frontend',
        files: { create: ['src/components/Foo.tsx'], modify: [], test: ['tests/Foo.test.tsx'] },
      },
    }
    const scope = taskRuntime.resolveActiveCodeSpecsScope(runtime)
    assert.equal(scope.activePackage, 'my-pkg')
    assert.equal(scope.source, 'task')
    assert.equal(scope.taskLayer, 'frontend')
    assert.deepEqual(scope.changedFileHints, ['src/components/Foo.tsx', 'tests/Foo.test.tsx'])
  })

  await t.test('resolveActiveCodeSpecsScope honors override taskLayer/changedFileHints', () => {
    const runtime = { projectRoot: repoRoot, currentTask: { package: 'my-pkg', target_layer: 'frontend' } }
    const scope = taskRuntime.resolveActiveCodeSpecsScope(runtime, null, {
      taskLayer: 'backend',
      changedFileHints: ['src/api/foo.ts'],
    })
    assert.equal(scope.taskLayer, 'backend', 'override wins over task field')
    assert.deepEqual(scope.changedFileHints, ['src/api/foo.ts'])
  })

  await t.test('getCodeSpecsContextScoped narrows to a single layer when taskLayer is set', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-aware-'))
    makeCodeSpecs(root, 'my-pkg')

    const frontendOnly = taskRuntime.getCodeSpecsContextScoped(
      root,
      { activePackage: 'my-pkg', taskLayer: 'frontend', changedFileHints: [] },
      5000
    )
    assert.ok(frontendOnly, 'frontend scope should yield context')
    assert.match(frontendOnly, /frontend\/index\.md/)
    assert.match(frontendOnly, /frontend spec body/)
    // 新 fixture 下 backend 的 marker 是 TARGET_SPEC_MARKER；taskLayer=frontend 时它必须不出现。
    assert.doesNotMatch(frontendOnly, /TARGET_SPEC_MARKER/, 'backend should be hidden when taskLayer=frontend')

    const backendOnly = taskRuntime.getCodeSpecsContextScoped(
      root,
      { activePackage: 'my-pkg', taskLayer: 'backend', changedFileHints: [] },
      5000
    )
    assert.match(backendOnly, /backend\/index\.md/)
    assert.match(backendOnly, /TARGET_SPEC_MARKER/)
    assert.doesNotMatch(backendOnly, /frontend spec body/)
  })

  await t.test('getCodeSpecsContextScoped falls back to full package tree when taskLayer missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-aware-nolayer-'))
    makeCodeSpecs(root, 'my-pkg')

    const ctx = taskRuntime.getCodeSpecsContextScoped(
      root,
      { activePackage: 'my-pkg', taskLayer: null, changedFileHints: [] },
      5000
    )
    assert.ok(ctx)
    assert.match(ctx, /frontend spec body/)
    // 新 fixture 的 backend spec 名称已调整，沿用 marker 来验证两个 layer 都被读到。
    assert.match(ctx, /TARGET_SPEC_MARKER/, 'backend layer must still appear when no taskLayer is declared')
  })

  await t.test('changedFileHints prioritize hint-matching spec over alphabetical order under tight budget', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-aware-hints-'))
    makeCodeSpecs(root, 'my-pkg')

    // Budget 只够装 root index + guides index + layer index + 1 份 backend spec（每份 spec 接近 600 char）。
    // 无 hint 时 a-shared-constants.md 字母序最先 → 会优先读，TARGET_SPEC_MARKER 不出现。
    // 带 hint 指向 z-target-spec.md 时 → 优先级反转，TARGET_SPEC_MARKER 必须出现。
    const BUDGET = 1100

    const withoutHints = taskRuntime.getCodeSpecsContextScoped(
      root,
      { activePackage: 'my-pkg', taskLayer: 'backend', changedFileHints: [] },
      BUDGET
    )
    assert.ok(withoutHints)
    assert.doesNotMatch(withoutHints, /TARGET_SPEC_MARKER/,
      'without hints, alphabetical order must push z-target-spec out of the tight budget')

    const withHints = taskRuntime.getCodeSpecsContextScoped(
      root,
      {
        activePackage: 'my-pkg',
        taskLayer: 'backend',
        changedFileHints: ['src/backend/z-target-spec.ts'],
      },
      BUDGET
    )
    assert.ok(withHints)
    assert.match(withHints, /TARGET_SPEC_MARKER/,
      'hint must surface z-target-spec even though it sorts last alphabetically')
  })

  await t.test('hint matching shared parent dir name must NOT prioritize every sibling spec', () => {
    // 回归保护：父目录 token（如 "backend"）曾经会让同 layer 下所有 spec 都命中 hint，
    // 导致 hint 优先级退化成字母序。修复后 hintMatchesSpec 只按 basename 匹配。
    // 这里用真实 fixture 验证：hint 的父目录名同时是 layer 名（"backend"），但由于 basename
    // 不匹配，a-shared-constants 不应被 hint 抢到第一位；z-target-spec 才是 hit 目标。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-aware-parent-dir-'))
    makeCodeSpecs(root, 'my-pkg')
    const BUDGET = 1100
    const withParentDirOnlyHint = taskRuntime.getCodeSpecsContextScoped(
      root,
      {
        activePackage: 'my-pkg',
        taskLayer: 'backend',
        // hint basename 与任一 spec 都不匹配；父目录"backend"与 layer 重名。
        changedFileHints: ['src/backend/unrelated-unseen-file.ts'],
      },
      BUDGET
    )
    assert.ok(withParentDirOnlyHint)
    // 没有 basename 命中时，应该和无 hint 完全一致——即 z-target-spec 仍被字母序挤出预算。
    assert.doesNotMatch(
      withParentDirOnlyHint,
      /TARGET_SPEC_MARKER/,
      'parent-dir token ("backend") must not promote unrelated specs; z-target-spec should still be excluded'
    )
  })

  await t.test('normalizeChangedFileHints dedupes and cleans path separators', () => {
    const normalized = taskRuntime.normalizeChangedFileHints([
      'src\\api\\foo.ts',
      'src/api/foo.ts',
      '  ',
      'tests/foo.test.ts',
      null,
      'tests/foo.test.ts',
    ])
    assert.deepEqual(normalized, ['src/api/foo.ts', 'tests/foo.test.ts'])
  })
})
