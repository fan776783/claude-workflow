#!/usr/bin/env node

// 发布前验证脚本
const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');
const { validateWorkflowDocContracts } = require('../core/utils/workflow/doc_contracts.js');
const { validateSpecTemplateHeadings } = require('../core/utils/workflow/template_contracts.js');
const { validatePlatformParity } = require('../core/utils/platform_parity.js');

/**
 * 以子进程方式运行 Node.js 脚本并返回结果
 * @param {string[]} args - 传给 node 的参数列表
 * @param {object} [options] - 选项
 * @param {boolean} [options.parseJson=true] - 是否将 stdout 解析为 JSON
 * @returns {{ ok: boolean, data?: any, error?: string, stdout?: string, stderr?: string }}
 */
function runNodeValidation(args, options = {}) {
  const { parseJson = true } = options;
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || '').trim() || `exit code ${result.status}`,
    };
  }
  if (!parseJson) {
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  }

  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: `invalid JSON output: ${error.message}` };
  }
}

/**
 * 对一组 JS 文件执行 Node.js 语法检查（--check）
 * @param {string[]} files - 要检查的文件路径列表
 * @returns {{ ok: boolean, error?: string }}
 */
function runNodeSyntaxValidation(files) {
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        error: (result.stderr || result.stdout || '').trim() || `syntax check failed: ${file}`,
      };
    }
  }
  return { ok: true };
}

/**
 * 递归收集目录下满足条件的文件
 * @param {string} rootDir - 起始目录
 * @param {(fullPath: string, name: string) => boolean} predicate - 文件过滤函数
 * @returns {Promise<string[]>} 匹配的文件路径列表
 */
async function collectFiles(rootDir, predicate) {
  const files = [];
  if (!(await fs.pathExists(rootDir))) {
    return files;
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath, predicate));
      continue;
    }
    if (entry.isFile() && predicate(fullPath, entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * 递归收集目录下所有 Markdown 文件
 * @param {string} rootDir - 起始目录
 * @returns {Promise<string[]>} .md 文件路径列表
 */
async function collectMarkdownFiles(rootDir) {
  return collectFiles(rootDir, (_, name) => name.endsWith('.md'));
}

/**
 * 校验文档中的路径引用是否合法（禁止旧路径、检查相对链接有效性等）
 * @param {string} repoRoot - 仓库根目录
 * @param {string} packageRoot - core/ 包根目录
 * @param {string[]} errors - 错误收集数组（就地追加）
 * @returns {Promise<void>}
 */
async function validatePathReferences(repoRoot, packageRoot, errors) {
  const pathContractChecks = [
    {
      root: path.join(packageRoot, 'hooks'),
      predicate: (_, name) => name.endsWith('.py') || name.endsWith('.js'),
      forbidden: '.agents/agent-workflow/hooks/',
      message: 'hooks 文档仍引用旧的 .agents/agent-workflow/hooks/ 路径',
    },
    {
      root: path.join(packageRoot, 'hooks'),
      predicate: (_, name) => name.endsWith('.py') || name.endsWith('.md'),
      forbidden: '.claude/specs/guides/',
      message: 'hooks/runtime 文档仍引用旧的 .claude/specs/guides/ 路径',
    },
    {
      root: path.join(packageRoot, 'skills', 'workflow-review'),
      predicate: (_, name) => name.endsWith('.md'),
      forbidden: '.claude/specs/guides/',
      message: 'workflow-review 文档仍引用旧的 .claude/specs/guides/ 路径',
    },
    {
      root: repoRoot,
      predicate: (_, name) => name.endsWith('.md'),
      forbidden: 'scripts/workflow_cli.py',
      message: '文档仍引用过期的 scripts/workflow_cli.py 路径',
    },
  ];

  const forbiddenWorkflowPatterns = [
    /(?:^|[^a-z])workflow_cli\.py\b/g,
    /(?:^|[^a-z])state_manager\.py\b/g,
    /(?:^|[^a-z])dependency_checker\.py\b/g,
    /(?:^|[^a-z])task_parser\.py\b/g,
    /(?:^|[^a-z])verification\.py\b/g,
    /(?:^|[^a-z])status_utils\.py\b/g,
    /(?:^|[^a-z])path_utils\.py\b/g,
    /(?:^|[^a-z])execution_sequencer\.py\b/g,
    /(?:^|[^a-z])workflow_types\.py\b/g,
    /(?:^|[^a-z])quality_review\.py\b/g,
    /(?:^|[^a-z])plan_delta\.py\b/g,
    /(?:^|[^a-z])planning_gates\.py\b/g,
    /(?:^|[^a-z])journal\.py\b/g,
    /(?:^|[^a-z])task_manager\.py\b/g,
    /(?:^|[^a-z])lifecycle_cmds\.py\b/g,
    /(?:^|[^a-z])doc_contracts\.py\b/g,
    /(?:^|[^a-z])context_budget\.py\b/g,
    /(?:^|[^a-z])self_review\.py\b/g,
    /python3\s+.*utils\/workflow\//g,
    /py\s+-3\s+.*utils\/workflow\//g,
  ];

  for (const check of pathContractChecks) {
    const files = await collectFiles(check.root, check.predicate);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      if (content.includes(check.forbidden)) {
        errors.push(`${check.message}: ${path.relative(repoRoot, file)}`);
      }
    }
  }
  const repoMarkdownFiles = await collectFiles(repoRoot, (fullPath, name) => {
    if (!name.endsWith('.md')) return false;
    const relative = path.relative(repoRoot, fullPath);
    return !relative.startsWith('.claude/') && !relative.endsWith('.txt');
  });

  for (const file of repoMarkdownFiles) {
    const content = await fs.readFile(file, 'utf8');
    for (const pattern of forbiddenWorkflowPatterns) {
      if (pattern.test(content)) {
        errors.push(`文档仍引用 workflow Python 运行时: ${path.relative(repoRoot, file)}`);
        break;
      }
    }
  }

  const markdownRoots = [
    path.join(packageRoot, 'skills'),
    path.join(packageRoot, 'commands'),
    path.join(packageRoot, 'specs'),
  ];
  const markdownFiles = [];
  for (const root of markdownRoots) {
    markdownFiles.push(...await collectMarkdownFiles(root));
  }

  const linkRegex = /\[[^\]]+\]\(([^)]+\.md)\)/g;
  for (const file of markdownFiles) {
    const content = await fs.readFile(file, 'utf8');
    for (const match of content.matchAll(linkRegex)) {
      const target = match[1];
      if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) {
        continue;
      }
      const resolved = path.resolve(path.dirname(file), target);
      if (!(await fs.pathExists(resolved))) {
        errors.push(`markdown 相对链接失效: ${path.relative(repoRoot, file)} -> ${target}`);
      }
    }
  }
}

/**
 * 校验 workflow 相关契约：必要文件存在性、脚本语法、模板标记、文档引用一致性
 * @param {string} repoRoot - 仓库根目录
 * @param {string} packageRoot - core/ 包根目录
 * @param {string[]} errors - 错误收集数组（就地追加）
 * @returns {Promise<void>}
 */
async function validateWorkflowContracts(repoRoot, packageRoot, errors) {
  const runtimeRefsDir = path.join(packageRoot, 'specs', 'workflow-runtime');
  const runtimeTemplatesDir = path.join(packageRoot, 'specs', 'workflow-templates');
  const runtimeScriptsDir = path.join(packageRoot, 'utils', 'workflow');
  const workflowHooksDir = path.join(packageRoot, 'hooks');
  const guardPaths = [
    [runtimeRefsDir, 'workflow-runtime references'],
    [runtimeTemplatesDir, 'workflow-templates'],
    [runtimeScriptsDir, 'workflow utils/scripts'],
  ];
  for (const [p, label] of guardPaths) {
    if (!(await fs.pathExists(p))) {
      errors.push(`workflow 缺少 ${label}: ${path.relative(repoRoot, p)}`);
    }
  }
  if (errors.length > 0) return;

  const scriptsDir = runtimeScriptsDir;
  const scriptFiles = (await fs.readdir(scriptsDir)).filter(file => file.endsWith('.js'));
  const hookScriptFiles = (await fs.pathExists(workflowHooksDir))
    ? (await fs.readdir(workflowHooksDir)).filter(file => file.endsWith('.js'))
    : [];
  const requiredWorkflowScripts = ['workflow_cli.js', 'task_parser.js', 'task_runtime.js', 'workflow_types.js', 'traceability.js', 'doc_contracts.js', 'lifecycle_cmds.js', 'quality_review.js', 'execution_sequencer.js'];
  const workflowDocSkills = ['workflow-plan', 'workflow-execute', 'workflow-review', 'workflow-delta'];

  for (const file of requiredWorkflowScripts) {
    if (!scriptFiles.includes(file)) {
      errors.push(`workflow scripts 缺少 ${file}`);
    }
  }

  const docContractsScript = path.join(scriptsDir, 'doc_contracts.js');
  if (!(await fs.pathExists(docContractsScript))) {
    errors.push('workflow doc_contracts.js 不存在');
    return;
  }

  const cliFile = path.join(scriptsDir, 'workflow_cli.js');
  const planTemplateFile = path.join(runtimeTemplatesDir, 'plan-template.md');
  const specTemplateFile = path.join(runtimeTemplatesDir, 'spec-template.md');
  const referencesDir = runtimeRefsDir;
  const extraDocs = (await fs.pathExists(referencesDir))
    ? (await fs.readdir(referencesDir))
        .filter(file => file.endsWith('.md'))
        .map(file => path.join(referencesDir, file))
    : [];
  const splitSkillDocs = [];

  for (const skillName of workflowDocSkills) {
    const skillRoot = path.join(packageRoot, 'skills', skillName);
    if (!(await fs.pathExists(skillRoot))) {
      errors.push(`workflow doc surface 缺少 ${skillName}/`);
      continue;
    }
    splitSkillDocs.push(...await collectMarkdownFiles(skillRoot));
  }

  const jsSyntaxCheck = runNodeSyntaxValidation(scriptFiles.map(file => path.join(scriptsDir, file)));
  if (!jsSyntaxCheck.ok) {
    errors.push(`workflow Node.js 脚本语法校验失败: ${jsSyntaxCheck.error}`);
  }
  const hookSyntaxCheck = runNodeSyntaxValidation(hookScriptFiles.map(file => path.join(workflowHooksDir, file)));
  if (!hookSyntaxCheck.ok) {
    errors.push(`workflow hook 语法校验失败: ${hookSyntaxCheck.error}`);
  }

  const specCheck = runNodeValidation([docContractsScript, 'spec-template', specTemplateFile]);
  if (!specCheck.ok) {
    errors.push(`workflow spec template 校验失败: ${specCheck.error}`);
  } else {
    if (specCheck.data.missing_markers?.length) {
      errors.push(`workflow spec template 缺少标记: ${specCheck.data.missing_markers.join(', ')}`);
    }
    if (specCheck.data.placeholders?.length) {
      errors.push(`workflow spec template 存在 placeholder: ${specCheck.data.placeholders.join(', ')}`);
    }
  }

  const planCheck = runNodeValidation([docContractsScript, 'plan-template', planTemplateFile]);
  if (!planCheck.ok) {
    errors.push(`workflow plan template 校验失败: ${planCheck.error}`);
  } else {
    if (planCheck.data.missing_markers?.length) {
      errors.push(`workflow plan template 缺少标记: ${planCheck.data.missing_markers.join(', ')}`);
    }
    if (planCheck.data.missing_task_fields?.length) {
      errors.push(`workflow plan template 缺少任务字段: ${planCheck.data.missing_task_fields.join(', ')}`);
    }
    if (planCheck.data.placeholders?.length) {
      errors.push(`workflow plan template 存在 placeholder: ${planCheck.data.placeholders.join(', ')}`);
    }
  }

  const contractArgs = [
    docContractsScript,
    'workflow-contracts',
    '--cli',
    cliFile,
    '--spec-template',
    specTemplateFile,
    '--plan-template',
    planTemplateFile,
  ];

  for (const doc of [...extraDocs, ...splitSkillDocs]) {
    contractArgs.push('--doc', doc);
  }
  for (const file of scriptFiles) {
    contractArgs.push('--script', file);
  }
  for (const file of hookScriptFiles) {
    contractArgs.push('--script', file);
  }

  const contractCheck = runNodeValidation(contractArgs);
  if (!contractCheck.ok) {
    errors.push(`workflow 文档契约校验失败: ${contractCheck.error}`);
    return;
  }

  const { data } = contractCheck;
  if (!data.command_contract?.ok) {
    const missing = data.command_contract?.missing_commands || [];
    errors.push(`workflow CLI 缺少文档声明的命令: ${missing.join(', ')}`);
  }
  if (!data.script_reference_contract?.ok) {
    const missing = data.script_reference_contract?.missing_scripts || [];
    errors.push(`workflow 文档引用了缺失脚本: ${missing.join(', ')}`);
  }
  if (!data.spec_template_contract?.ok) {
    const missingMarkers = data.spec_template_contract?.missing_markers || [];
    if (missingMarkers.length) {
      errors.push(`workflow spec template 缺少标记: ${missingMarkers.join(', ')}`);
    }
  }
  if (!data.plan_template_contract?.ok) {
    const missingMarkers = data.plan_template_contract?.missing_markers || [];
    const missingFields = data.plan_template_contract?.missing_task_fields || [];
    if (missingMarkers.length) {
      errors.push(`workflow plan template 缺少标记: ${missingMarkers.join(', ')}`);
    }
    if (missingFields.length) {
      errors.push(`workflow plan template 缺少字段: ${missingFields.join(', ')}`);
    }
  }
  if (data.doc_placeholders?.length) {
    errors.push(`workflow 文档存在 placeholder: ${data.doc_placeholders.join(', ')}`);
  }
  // Agents 契约：core/agents/ 必须存在且每个 agent 文件包含必要的路由元数据
  const agentsDir = path.join(packageRoot, '..', 'core', 'agents');

  if (await fs.pathExists(agentsDir)) {
    const agentFiles = (await fs.readdir(agentsDir)).filter(f => f.endsWith('.md'));
    if (agentFiles.length === 0) {
      errors.push('core/agents/ 为空');
    } else {
      let validCount = 0;
      for (const f of agentFiles) {
        const content = require('fs').readFileSync(path.join(agentsDir, f), 'utf8');
        const hasPhase = /^phase:\s+\S/m.test(content);
        const hasRole = /^role:\s+\S/m.test(content);
        const hasName = /^name:\s+\S/m.test(content);
        if (!hasPhase || !hasRole || !hasName) {
          errors.push(`core/agents/${f} 缺少必要字段 (name/phase/role)`);
        } else {
          validCount++;
        }
      }
      if (validCount === agentFiles.length) {
        console.log(`  ✅ agents 契约: ${validCount} 个 subagent 文件校验通过`);
      }
    }
  } else {
    errors.push('core/agents/ 目录不存在');
  }
}

/**
 * 校验 /team 命令：command 文件存在，基本边界声明完备，不允许残留 team-workflow 旧引用
 * @param {string} repoRoot - 仓库根目录
 * @param {string} packageRoot - core/ 包根目录
 * @param {string[]} errors - 错误收集数组（就地追加）
 * @returns {Promise<void>}
 */
async function validateTeamContracts(repoRoot, packageRoot, errors) {
  const teamCommandFile = path.join(packageRoot, 'commands', 'team.md');
  if (!(await fs.pathExists(teamCommandFile))) {
    errors.push(`team 缺少 command 入口: ${path.relative(repoRoot, teamCommandFile)}`);
    return;
  }

  const teamCommandContent = await fs.readFile(teamCommandFile, 'utf8');

  const commandMarkers = [
    'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
    'team-idle.js',
    'team-task-guard.js',
    'clean up team',
  ];
  for (const marker of commandMarkers) {
    if (!teamCommandContent.includes(marker)) {
      errors.push(`team command 缺少关键段落: ${marker}`);
    }
  }

  const forbiddenLegacyRefs = [
    'core/specs/team-runtime',
    'core/utils/team/',
    'core/skills/team-workflow',
    'core/skills/team/',
    'team-state.json',
  ];
  for (const ref of forbiddenLegacyRefs) {
    if (teamCommandContent.includes(ref)) {
      errors.push(`team command 仍引用已下线的 team runtime 资源: ${ref}`);
    }
  }

  const hookFiles = [
    path.join(packageRoot, 'hooks', 'team-idle.js'),
    path.join(packageRoot, 'hooks', 'team-task-guard.js'),
  ];
  for (const hookPath of hookFiles) {
    if (!(await fs.pathExists(hookPath))) {
      errors.push(`team hook 缺失: ${path.relative(repoRoot, hookPath)}`);
    }
  }

  const hookSyntaxCheck = runNodeSyntaxValidation(
    hookFiles.filter(file => fs.existsSync(file))
  );
  if (!hookSyntaxCheck.ok) {
    errors.push(`team hook 语法校验失败: ${hookSyntaxCheck.error}`);
  }
}

/**
 * 校验 code-specs-template manifests 的 schema（若存在）。
 * Schema（v3 Stage C）：
 *   - migrations[].type ∈ { rename, rename-dir, rename-section, delete-section, safe-file-delete, delete }
 *   - 统一 from / path 字段（具体看 type；详见 manifests/README.md）
 *   - top-level 可选 protected_paths（glob 数组）
 *   - top-level 不含 update.skip / update_skip（skip 属下游 config 设置）
 * @param {string} repoRoot
 * @param {string} packageRoot
 * @param {string[]} errors
 */
async function validateCodeSpecsManifests(repoRoot, packageRoot, errors) {
  const manifestsDir = path.join(packageRoot, 'specs', 'spec-templates', 'manifests');
  if (!(await fs.pathExists(manifestsDir))) {
    return; // 无 manifest 目录时跳过（首次发版前正常）
  }
  const files = (await fs.readdir(manifestsDir)).filter((name) => name.endsWith('.json'));
  const allowedTypes = new Set([
    'rename',
    'rename-dir',
    'rename-section',
    'delete-section',
    'safe-file-delete',
    'delete',
  ]);
  for (const file of files) {
    const fullPath = path.join(manifestsDir, file);
    let doc;
    try {
      doc = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    } catch (err) {
      errors.push(`code-specs manifest 解析失败 ${file}: ${err.message}`);
      continue;
    }
    if (!doc || typeof doc !== 'object') {
      errors.push(`code-specs manifest 结构错误 ${file}: 应为对象`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(doc, 'update.skip') ||
        Object.prototype.hasOwnProperty.call(doc, 'update_skip')) {
      errors.push(`code-specs manifest ${file} 不应包含 update.skip / update_skip（skip 属下游 config 设置）`);
    }
    if ('protected_paths' in doc) {
      if (!Array.isArray(doc.protected_paths)) {
        errors.push(`code-specs manifest ${file} protected_paths 必须为字符串数组`);
      } else {
        doc.protected_paths.forEach((entry, idx) => {
          if (typeof entry !== 'string' || !entry.trim()) {
            errors.push(`code-specs manifest ${file} protected_paths[${idx}] 必须为非空字符串`);
          }
        });
      }
    }
    if (!Array.isArray(doc.migrations)) {
      errors.push(`code-specs manifest ${file} 缺少 migrations 数组`);
      continue;
    }
    doc.migrations.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object') {
        errors.push(`code-specs manifest ${file} migrations[${idx}] 非对象`);
        return;
      }
      if (!allowedTypes.has(entry.type)) {
        errors.push(`code-specs manifest ${file} migrations[${idx}].type 非法: ${entry.type}`);
      }
      const needsFrom = entry.type === 'rename' || entry.type === 'rename-dir';
      const needsPath = entry.type === 'delete' || entry.type === 'safe-file-delete';
      const needsFile = entry.type === 'rename-section' || entry.type === 'delete-section';
      if (needsFrom && (typeof entry.from !== 'string' || !entry.from)) {
        errors.push(`code-specs manifest ${file} migrations[${idx}] ${entry.type} 缺少 from 字段`);
      }
      if (needsPath && (typeof entry.path !== 'string' || !entry.path)) {
        errors.push(`code-specs manifest ${file} migrations[${idx}] ${entry.type} 缺少 path 字段`);
      }
      if (needsFile && (typeof entry.file !== 'string' || !entry.file)) {
        errors.push(`code-specs manifest ${file} migrations[${idx}] ${entry.type} 缺少 file 字段`);
      }
      if (entry.type === 'rename' || entry.type === 'rename-dir') {
        if (typeof entry.to !== 'string' || !entry.to) {
          errors.push(`code-specs manifest ${file} migrations[${idx}] ${entry.type} 缺少 to`);
        }
      }
      if (entry.type === 'rename-section') {
        if (typeof entry.from !== 'string' || !entry.from) {
          errors.push(`code-specs manifest ${file} migrations[${idx}] rename-section 缺少 from（旧 H2 标题）`);
        }
        if (typeof entry.to !== 'string' || !entry.to) {
          errors.push(`code-specs manifest ${file} migrations[${idx}] rename-section 缺少 to（新 H2 标题）`);
        }
      }
      if (entry.type === 'delete-section') {
        if (typeof entry.section !== 'string' || !entry.section) {
          errors.push(`code-specs manifest ${file} migrations[${idx}] delete-section 缺少 section（要删除的 H2 标题）`);
        }
      }
      if (entry.type === 'safe-file-delete') {
        const hasHashGuard = Array.isArray(entry.allowed_hashes)
          || (entry.guard && typeof entry.guard === 'object' && typeof entry.guard.hashBefore === 'string');
        if (!hasHashGuard) {
          errors.push(`code-specs manifest ${file} migrations[${idx}] safe-file-delete 必须有 allowed_hashes 或 guard.hashBefore`);
        }
      }
    });
  }
  if (files.length > 0) {
    console.log(`  ✅ code-specs manifests: ${files.length} 个文件 schema 校验通过`);
  }

  // 当前版本必须有对应 manifest——防止 generate-manifest.js 跑失败却走到 publish。
  const pkgJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const currentManifest = path.join(manifestsDir, `v${pkgJson.version}.json`);
  if (!(await fs.pathExists(currentManifest))) {
    errors.push(`code-specs manifest 缺失当前版本: v${pkgJson.version}.json（检查 scripts/generate-manifest.js 是否已运行）`);
  }
}

/**
 * 校验 code-specs canonical 模板的段标题是否完整（7/4/6 段契约）。
 * Stage 1 Code Specs Check 与 Probe E 依赖这些段存在，
 * 段落改名或层级漂移会让 advisory/blocking 判定读不到内容。
 * @param {string[]} errors
 */
function validateCodeSpecsTemplateContracts(errors) {
  const result = validateSpecTemplateHeadings();
  if (result.ok) {
    console.log('  ✅ code-specs templates: 7/4/6 段契约校验通过');
    return;
  }
  for (const entry of result.errors) {
    errors.push(entry.message);
  }
}

/**
 * 校验 multi-tool 分发契约。lib/agents.js 与 lib/installer.js 之间的一致性由
 * core/utils/platform_parity.js 负责，本函数只把结果汇总到 errors。
 * @param {string[]} errors
 */
function validatePlatformParityContract(errors) {
  const result = validatePlatformParity();
  if (result.warnings && result.warnings.length) {
    for (const warning of result.warnings) console.log(`  ⚠️  platform parity 警告: ${warning}`);
  }
  if (result.ok) {
    console.log(`  ✅ platform parity: ${result.agentNames.length} 个 agents / ${result.skills.length} 个 skills 校验通过`);
    return;
  }
  for (const entry of result.errors) errors.push(entry);
}

/**
 * 在 prepublish 时跑契约测试。限定在专门标注为 *_contracts.js 的测试文件，
 * 避免拖慢发布流程，并保证 code-spec 段标题契约在未跑全量测试时也能兜底拦截。
 * @param {string} repoRoot
 * @param {string[]} errors
 */
function runContractTests(repoRoot, errors) {
  const testFiles = [
    path.join(repoRoot, 'tests', 'test_spec_contracts.js'),
    path.join(repoRoot, 'tests', 'test_quality_review_stage1.js'),
    path.join(repoRoot, 'tests', 'test_task_aware_injection.js'),
  ];
  const existing = testFiles.filter((file) => fs.existsSync(file));
  if (!existing.length) {
    errors.push('契约测试缺失（tests/test_*_contracts.js / test_quality_review_stage1.js / test_task_aware_injection.js）');
    return;
  }
  const result = spawnSync(process.execPath, ['--test', ...existing], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`  ✅ contract tests: ${existing.length} 个 suite 通过`);
    return;
  }
  const tail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim().split(/\r?\n/).slice(-40).join('\n');
  errors.push(`契约测试失败 (exit ${result.status}):\n${tail}`);
}

/**
 * 校验 Claude Code Plugin 相关契约（v6.0.0 起）：
 *   - core/.claude-plugin/plugin.json 存在且 version 与 package.json 一致
 *   - .claude-plugin/marketplace.json 存在且含 agent-workflow 条目
 *   - core/hooks/hooks.json 存在，引用的脚本全部在 core/hooks/ 下
 *   - core/hooks/notify.config.default.json 存在
 *   - lib/installer.js 不再 export 已迁移到 Plugin 的函数（防止误 import）
 * @param {string} repoRoot
 * @param {string} packageRoot
 * @param {string[]} errors
 */
async function validatePluginManifests(repoRoot, packageRoot, errors) {
  const pkgJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  // 1. plugin.json 存在 + version 匹配
  const pluginManifestPath = path.join(packageRoot, '.claude-plugin', 'plugin.json');
  if (!(await fs.pathExists(pluginManifestPath))) {
    errors.push('core/.claude-plugin/plugin.json 不存在');
    return;
  }
  let pluginManifest;
  try {
    pluginManifest = JSON.parse(await fs.readFile(pluginManifestPath, 'utf8'));
  } catch (err) {
    errors.push(`core/.claude-plugin/plugin.json 解析失败: ${err.message}`);
    return;
  }
  if (pluginManifest.version !== pkgJson.version) {
    errors.push(
      `plugin.json version (${pluginManifest.version}) 与 package.json version (${pkgJson.version}) 不一致，` +
      `请运行 node scripts/sync-plugin-version.js ${pkgJson.version}`
    );
  }
  if (pluginManifest.name !== 'agent-workflow') {
    errors.push(`plugin.json name 必须为 "agent-workflow"（当前：${pluginManifest.name}）`);
  }

  // 2. marketplace.json 存在 + 含 agent-workflow 条目
  const marketplaceManifestPath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
  if (!(await fs.pathExists(marketplaceManifestPath))) {
    errors.push('.claude-plugin/marketplace.json 不存在');
  } else {
    try {
      const marketplaceManifest = JSON.parse(await fs.readFile(marketplaceManifestPath, 'utf8'));
      const plugins = Array.isArray(marketplaceManifest.plugins) ? marketplaceManifest.plugins : [];
      const hasEntry = plugins.some((p) => p && p.name === 'agent-workflow');
      if (!hasEntry) {
        errors.push('.claude-plugin/marketplace.json plugins 数组未声明 agent-workflow 条目');
      }
    } catch (err) {
      errors.push(`.claude-plugin/marketplace.json 解析失败: ${err.message}`);
    }
  }

  // 3. hooks.json 存在 + 引用脚本都在 core/hooks/
  const hooksJsonPath = path.join(packageRoot, 'hooks', 'hooks.json');
  if (!(await fs.pathExists(hooksJsonPath))) {
    errors.push('core/hooks/hooks.json 不存在');
  } else {
    try {
      const hooksManifest = JSON.parse(await fs.readFile(hooksJsonPath, 'utf8'));
      const referencedScripts = new Set();
      const hooksDef = hooksManifest.hooks || {};
      for (const eventName of Object.keys(hooksDef)) {
        const entries = Array.isArray(hooksDef[eventName]) ? hooksDef[eventName] : [];
        for (const entry of entries) {
          const configs = Array.isArray(entry.hooks) ? entry.hooks : [];
          for (const hookConfig of configs) {
            if (hookConfig && typeof hookConfig.command === 'string') {
              // 匹配 ${CLAUDE_PLUGIN_ROOT}/hooks/<script>.js 中的 <script>.js
              const match = hookConfig.command.match(/hooks\/([A-Za-z0-9_-]+\.js)/);
              if (match) referencedScripts.add(match[1]);
            }
          }
        }
      }
      for (const script of referencedScripts) {
        const scriptPath = path.join(packageRoot, 'hooks', script);
        if (!(await fs.pathExists(scriptPath))) {
          errors.push(`hooks.json 引用了不存在的脚本: ${script}`);
        }
      }
    } catch (err) {
      errors.push(`core/hooks/hooks.json 解析失败: ${err.message}`);
    }
  }

  // 4. notify.config.default.json 存在
  const notifyDefaultPath = path.join(packageRoot, 'hooks', 'notify.config.default.json');
  if (!(await fs.pathExists(notifyDefaultPath))) {
    errors.push('core/hooks/notify.config.default.json 不存在');
  }

  // 5. installer.js 不再 export 已迁移函数
  const installerPath = path.join(repoRoot, 'lib', 'installer.js');
  if (await fs.pathExists(installerPath)) {
    const installerContent = await fs.readFile(installerPath, 'utf8');
    // 只在清理 Step 4 之后启用这条校验；用 STEP_4_DONE 锚注释作为 opt-in 触发开关。
    // 未清理前校验不应阻塞开发。
    if (installerContent.includes('// @installer-plugin-migration: STEP_4_DONE')) {
      const forbiddenExports = [
        'ensureWorkflowHooks',
        'ensureTeamHooks',
        'ensureNotifyHooks',
        'syncAgentFiles',
        'inspectManagedAgentFiles',
      ];
      const exportsMatch = installerContent.match(/module\.exports\s*=\s*\{([\s\S]*?)\};?\s*$/m);
      if (exportsMatch) {
        const exportedNames = exportsMatch[1];
        for (const name of forbiddenExports) {
          if (new RegExp(`\\b${name}\\b`).test(exportedNames)) {
            errors.push(
              `Step 4 已标记完成但 lib/installer.js 仍 export "${name}"；该函数应迁移到 lib/claude-code-plugin.js`
            );
          }
        }
      }
    }
  }

  if (errors.filter(e => e.includes('plugin')).length === 0) {
    console.log('  ✅ plugin manifests: plugin.json / marketplace.json / hooks.json 全部就绪');
  }
}

/**
 * 发布前验证主流程：检查目录结构、workflow/team 契约、路径引用
 * @returns {Promise<void>}
 */
/**
 * 解析 glossary.md，抽取 canonical → forbidden synonym 映射
 * @param {string} glossaryPath - glossary.md 的绝对路径
 * @returns {Promise<Array<{ canonical: string, forbidden: string[] }>>}
 */
async function parseGlossary(glossaryPath) {
  if (!(await fs.pathExists(glossaryPath))) {
    return [];
  }
  const content = await fs.readFile(glossaryPath, 'utf8');
  const entries = [];
  let current = null;

  const lines = content.split('\n');
  for (const line of lines) {
    const headerMatch = line.match(/^### ([a-zA-Z0-9_\-]+)\s*$/);
    if (headerMatch) {
      if (current) entries.push(current);
      current = { canonical: headerMatch[1], forbidden: [] };
      continue;
    }
    if (!current) continue;

    const forbiddenMatch = line.match(/^\*\*Forbidden synonyms\*\*:\s*(.+)$/);
    if (forbiddenMatch) {
      const raw = forbiddenMatch[1].trim();
      if (/^\(none/.test(raw)) continue;
      // 提取所有反引号包裹的词以及裸 CJK/英文词
      const tokens = [];
      // 反引号包裹形式：`word` 或 `word` (备注)
      const tickRe = /`([^`]+)`/g;
      let m;
      while ((m = tickRe.exec(raw)) !== null) {
        tokens.push(m[1].trim());
      }
      // 兜底：逗号分隔裸词，去掉附注括号内容
      if (tokens.length === 0) {
        raw.split(/[,，]/).forEach(t => {
          const clean = t.replace(/[（(].*?[)）]/g, '').trim();
          if (clean && clean !== '—') tokens.push(clean);
        });
      }
      current.forbidden.push(...tokens);
    }
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * 判断某一行是否处于 fenced code block 内
 * 调用方负责维护 inCodeBlock 状态
 */
function isFencePending(line, state) {
  if (/^```/.test(line.trim())) {
    state.inCode = !state.inCode;
    return true;
  }
  return false;
}

/**
 * 判断某个匹配位置是否落在行内反引号代码段中
 */
function inInlineCode(line, index) {
  let ticks = 0;
  for (let i = 0; i < index; i++) {
    if (line[i] === '`') ticks++;
  }
  return ticks % 2 === 1;
}

/**
 * 术语漂移 lint（warning-only，不阻塞发布）
 * @param {string} repoRoot
 * @param {string} packageRoot
 */
async function validateGlossaryDrift(repoRoot, packageRoot) {
  const glossaryPath = path.join(packageRoot, 'specs', 'shared', 'glossary.md');
  const entries = await parseGlossary(glossaryPath);
  if (entries.length === 0) {
    return;
  }

  // 构建 forbidden → canonical 映射（对反义条目）
  const rules = [];
  for (const entry of entries) {
    for (const forbidden of entry.forbidden) {
      rules.push({ forbidden, canonical: entry.canonical });
    }
  }
  if (rules.length === 0) return;

  // 预编译：英文词用 \b 边界；CJK 词直接字面匹配
  const compiled = rules.map(r => {
    const isAscii = /^[\x00-\x7F]+$/.test(r.forbidden);
    const escaped = r.forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = isAscii
      ? new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'g')
      : new RegExp(escaped, 'g');
    return { ...r, pattern };
  });

  // 收集 normative 文件：core/skills/**/SKILL.md、core/skills/**/references/**.md、core/commands/*.md、core/specs/**/*.md
  const normativeFiles = [];
  const skillsRoot = path.join(packageRoot, 'skills');
  if (await fs.pathExists(skillsRoot)) {
    for (const entry of await fs.readdir(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(skillsRoot, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (await fs.pathExists(skillFile)) normativeFiles.push(skillFile);
      const refsDir = path.join(skillDir, 'references');
      if (await fs.pathExists(refsDir)) {
        normativeFiles.push(...await collectMarkdownFiles(refsDir));
      }
    }
  }
  const commandsRoot = path.join(packageRoot, 'commands');
  if (await fs.pathExists(commandsRoot)) {
    const cmdEntries = await fs.readdir(commandsRoot, { withFileTypes: true });
    for (const e of cmdEntries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        normativeFiles.push(path.join(commandsRoot, e.name));
      }
    }
  }
  const specsRoot = path.join(packageRoot, 'specs');
  if (await fs.pathExists(specsRoot)) {
    normativeFiles.push(...await collectMarkdownFiles(specsRoot));
  }

  // glossary.md 本身自然包含 forbidden 词，排除
  const selfPath = path.resolve(glossaryPath);
  const scanFiles = normativeFiles.filter(f => path.resolve(f) !== selfPath);

  let warningCount = 0;
  for (const file of scanFiles) {
    const stat = await fs.stat(file);
    if (stat.size > 200 * 1024) continue;
    const content = await fs.readFile(file, 'utf8');
    const rel = path.relative(repoRoot, file);
    const state = { inCode: false };
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isFencePending(line, state)) continue;
      if (state.inCode) continue;
      if (/\/\/\s*glossary-allow\b/.test(line)) continue;

      for (const rule of compiled) {
        rule.pattern.lastIndex = 0;
        let match;
        while ((match = rule.pattern.exec(line)) !== null) {
          if (inInlineCode(line, match.index)) continue;
          // 跳过 URL / 路径中的命中
          const pre = line.slice(Math.max(0, match.index - 8), match.index);
          if (/https?:\/\/|file:|\.\w+$/.test(pre + match[0])) continue;
          warningCount++;
          console.error(`[glossary-drift] ${rel}:${i + 1} — "${match[0]}" should be "${rule.canonical}"`);
        }
      }
    }
  }

  if (warningCount > 0) {
    console.error(`[glossary-drift] ${warningCount} warning(s) — not blocking release`);
  } else {
    console.log('  ✅ glossary-drift: 0 warnings');
  }
}

async function validate() {
  const repoRoot = path.join(__dirname, '..');
  const templatesDir = path.join(repoRoot, 'templates');
  const packageRoot = path.join(repoRoot, 'core');
  const required = ['commands', 'skills', 'specs', 'utils'];
  const errors = [];

  console.log('[validate] 检查发布前置条件...\n');

  for (const dir of required) {
    const dirPath = path.join(packageRoot, dir);
    if (!(await fs.pathExists(dirPath))) {
      errors.push(`core/${dir} 目录不存在`);
    } else {
      const files = await fs.readdir(dirPath);
      if (files.length === 0) {
        errors.push(`core/${dir} 目录为空`);
      } else {
        console.log(`  ✅ core/${dir}: ${files.length} 个文件`);
      }
    }
  }

  const projectionRoots = [
    path.join(packageRoot, 'commands'),
    path.join(packageRoot, 'skills'),
    path.join(packageRoot, 'utils'),
    path.join(packageRoot, 'specs'),
    path.join(packageRoot, 'hooks'),
  ];

  for (const projectionRoot of projectionRoots) {
    if (!(await fs.pathExists(projectionRoot))) {
      errors.push(`package root 缺少目录: ${path.relative(repoRoot, projectionRoot)}`);
    }
  }

  await validateWorkflowContracts(repoRoot, packageRoot, errors);
  await validateTeamContracts(repoRoot, packageRoot, errors);
  await validatePathReferences(repoRoot, packageRoot, errors);
  await validateCodeSpecsManifests(repoRoot, packageRoot, errors);
  await validatePluginManifests(repoRoot, packageRoot, errors);
  validateCodeSpecsTemplateContracts(errors);
  validatePlatformParityContract(errors);
  runContractTests(repoRoot, errors);
  await validateGlossaryDrift(repoRoot, packageRoot);

  if (errors.length > 0) {
    console.log('\n❌ 验证失败:\n');
    errors.forEach(e => console.log(`  - ${e}`));
    process.exit(1);
  }

  console.log('\n✅ 验证通过，可以发布\n');
}

validate();
