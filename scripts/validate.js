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
 * 发布前验证主流程：检查目录结构、workflow/team 契约、路径引用
 * @returns {Promise<void>}
 */
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
  validateCodeSpecsTemplateContracts(errors);
  validatePlatformParityContract(errors);
  runContractTests(repoRoot, errors);

  if (errors.length > 0) {
    console.log('\n❌ 验证失败:\n');
    errors.forEach(e => console.log(`  - ${e}`));
    process.exit(1);
  }

  console.log('\n✅ 验证通过，可以发布\n');
}

validate();
