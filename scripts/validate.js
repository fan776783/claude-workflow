#!/usr/bin/env node

// 发布前验证脚本
const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');
const { validateTeamContracts: validateTeamDocContracts } = require('../core/utils/team/doc-contracts.js');
const { validateWorkflowDocContracts } = require('../core/utils/workflow/doc_contracts.js');

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
    path.join(packageRoot, 'docs'),
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
  const workflowCommandFile = path.join(packageRoot, 'commands', 'workflow.md');
  const runtimeRefsDir = path.join(packageRoot, 'specs', 'workflow-runtime');
  const runtimeTemplatesDir = path.join(packageRoot, 'specs', 'workflow-templates');
  const runtimeScriptsDir = path.join(packageRoot, 'utils', 'workflow');
  const workflowHooksDir = path.join(packageRoot, 'hooks');
  const guardPaths = [
    [workflowCommandFile, 'workflow command 入口'],
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
  const overviewFile = workflowCommandFile;
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
    '--overview',
    overviewFile,
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
 * 校验 team 相关契约：命令入口、运行时文档、脚本完整性、边界声明
 * @param {string} repoRoot - 仓库根目录
 * @param {string} packageRoot - core/ 包根目录
 * @param {string[]} errors - 错误收集数组（就地追加）
 * @returns {Promise<void>}
 */
async function validateTeamContracts(repoRoot, packageRoot, errors) {
  const teamCommandFile = path.join(packageRoot, 'commands', 'team.md');
  const workflowCommandFile = path.join(packageRoot, 'commands', 'workflow.md');
  const teamEntrySkillFile = path.join(packageRoot, 'skills', 'team', 'SKILL.md');
  const teamRuntimeSkillFile = path.join(packageRoot, 'skills', 'team-workflow', 'SKILL.md');
  const teamSpecsDir = path.join(packageRoot, 'specs', 'team-runtime');
  const teamUtilsDir = path.join(packageRoot, 'utils', 'team');
  const requiredRuntimeDocs = ['overview.md', 'state-machine.md', 'execute-entry.md', 'status.md', 'archive.md'];
  const requiredTeamScripts = ['team-cli.js', 'lifecycle.js', 'state-manager.js', 'task-board.js', 'task-board-helpers.js', 'phase-controller.js', 'governance.js', 'status-renderer.js', 'planning-support.js', 'planning-artifacts.js', 'templates.js', 'doc-contracts.js'];
  const teamCommandContent = await fs.pathExists(teamCommandFile)
    ? await fs.readFile(teamCommandFile, 'utf8')
    : '';
  const usesSplitRuntimeSkill = teamCommandContent.includes('../skills/team-workflow/SKILL.md');
  const guardPaths = [
    [teamCommandFile, 'team command 入口'],
    [workflowCommandFile, 'workflow command 入口'],
    [teamEntrySkillFile, 'team entry skill 入口'],
    [teamSpecsDir, 'team-runtime references'],
    [teamUtilsDir, 'team utils/scripts'],
  ];

  if (usesSplitRuntimeSkill) {
    guardPaths.push([teamRuntimeSkillFile, 'team runtime skill 入口']);
  }

  for (const [p, label] of guardPaths) {
    if (!(await fs.pathExists(p))) {
      errors.push(`team 缺少 ${label}: ${path.relative(repoRoot, p)}`);
    }
  }
  if (errors.length > 0) return;

  for (const file of requiredRuntimeDocs) {
    const docPath = path.join(teamSpecsDir, file);
    if (!(await fs.pathExists(docPath))) {
      errors.push(`team runtime 文档缺少 ${file}`);
    }
  }

  const scriptFiles = (await fs.readdir(teamUtilsDir)).filter(file => file.endsWith('.js'));
  for (const file of requiredTeamScripts) {
    if (!scriptFiles.includes(file)) {
      errors.push(`team scripts 缺少 ${file}`);
    }
  }

  const teamEntrySkillDocs = await collectMarkdownFiles(path.join(packageRoot, 'skills', 'team'));
  const teamRuntimeSkillDocs = usesSplitRuntimeSkill
    ? await collectMarkdownFiles(path.join(packageRoot, 'skills', 'team-workflow'))
    : [];
  const teamDocFiles = [
    ...await collectMarkdownFiles(teamSpecsDir),
    ...teamEntrySkillDocs,
    ...teamRuntimeSkillDocs,
  ];

  const [workflowCommandContent, teamEntrySkillContent, teamRuntimeSkillContent, readmeContent, claudeContent, coreClaudeContent] = await Promise.all([
    fs.readFile(workflowCommandFile, 'utf8'),
    fs.readFile(teamEntrySkillFile, 'utf8'),
    usesSplitRuntimeSkill ? fs.readFile(teamRuntimeSkillFile, 'utf8') : Promise.resolve(''),
    fs.readFile(path.join(repoRoot, 'README.md'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'CLAUDE.md'), 'utf8'),
    fs.readFile(path.join(packageRoot, 'CLAUDE.md'), 'utf8'),
  ]);

  const commandMarkers = ['/workflow', '/quick-plan', 'dispatching-parallel-agents', '自动触发'];
  for (const marker of commandMarkers) {
    if (!teamCommandContent.includes(marker)) {
      errors.push(`team command 缺少边界声明: ${marker}`);
    }
  }

  const workflowMarkers = ['/team', '/workflow', '不会自动升级为 team mode', '不得继承 team runtime'];
  for (const marker of workflowMarkers) {
    if (!workflowCommandContent.includes(marker)) {
      errors.push(`workflow command 缺少 /team 边界声明: ${marker}`);
    }
  }

  const teamEntrySkillMarkers = usesSplitRuntimeSkill
    ? ['/workflow', '/quick-plan', 'team-workflow', '自动触发', 'cleanup']
    : ['/workflow', '/quick-plan', 'dispatching-parallel-agents', 'team-state.json', '自动触发', 'cleanup'];
  for (const marker of teamEntrySkillMarkers) {
    if (!teamEntrySkillContent.includes(marker)) {
      errors.push(`team entry skill 缺少模式契约: ${marker}`);
    }
  }

  if (usesSplitRuntimeSkill) {
    const teamRuntimeSkillMarkers = ['dispatching-parallel-agents', 'team-state.json', 'phase/state contract', 'cleanup'];
    for (const marker of teamRuntimeSkillMarkers) {
      if (!teamRuntimeSkillContent.includes(marker)) {
        errors.push(`team runtime skill 缺少运行时契约: ${marker}`);
      }
    }
  }

  const indexedDocs = [
    {
      label: 'README.md',
      content: readmeContent,
      markers: ['/team', 'core/skills/team/SKILL.md', 'team-state.json', '不继承 `team-state.json`'],
    },
    {
      label: 'CLAUDE.md',
      content: claudeContent,
      markers: ['/team', 'never auto-triggered', 'team-state.json', 'team-workflow'],
    },
    {
      label: 'core/CLAUDE.md',
      content: coreClaudeContent,
      markers: ['/team mode guardrail', 'team_name', 'team_id'],
    },
  ];

  for (const doc of indexedDocs) {
    for (const marker of doc.markers) {
      if (!doc.content.includes(marker)) {
        errors.push(`${doc.label} 缺少 /team 索引或边界文案: ${marker}`);
      }
    }
  }

  const jsSyntaxCheck = runNodeSyntaxValidation(scriptFiles.map(file => path.join(teamUtilsDir, file)));
  if (!jsSyntaxCheck.ok) {
    errors.push(`team Node.js 脚本语法校验失败: ${jsSyntaxCheck.error}`);
  }

  const contractCheck = validateTeamDocContracts({
    cliFile: path.join(teamUtilsDir, 'team-cli.js'),
    overviewFile: teamCommandFile,
    docFiles: teamDocFiles,
    scriptFiles,
  });
  if (!contractCheck.ok) {
    if (!contractCheck.command_contract?.ok) {
      const missing = contractCheck.command_contract?.missing_commands || [];
      errors.push(`team CLI 缺少文档声明的命令: ${missing.join(', ')}`);
    }
    if (!contractCheck.script_reference_contract?.ok) {
      const missing = contractCheck.script_reference_contract?.missing_scripts || [];
      errors.push(`team 文档引用了缺失脚本: ${missing.join(', ')}`);
    }
    if (contractCheck.doc_placeholders?.length) {
      errors.push(`team 文档存在 placeholder: ${contractCheck.doc_placeholders.join(', ')}`);
    }
  }
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
    path.join(packageRoot, 'docs'),
  ];

  for (const projectionRoot of projectionRoots) {
    if (!(await fs.pathExists(projectionRoot))) {
      errors.push(`package root 缺少目录: ${path.relative(repoRoot, projectionRoot)}`);
    }
  }

  await validateWorkflowContracts(repoRoot, packageRoot, errors);
  await validateTeamContracts(repoRoot, packageRoot, errors);
  await validatePathReferences(repoRoot, packageRoot, errors);

  if (errors.length > 0) {
    console.log('\n❌ 验证失败:\n');
    errors.forEach(e => console.log(`  - ${e}`));
    process.exit(1);
  }

  console.log('\n✅ 验证通过，可以发布\n');
}

validate();
