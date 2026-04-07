#!/usr/bin/env node

// 发布前验证脚本
const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');
const { validateTeamContracts: validateTeamDocContracts } = require('../core/utils/team/doc-contracts.js');

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: false,
  });
  return !result.error && result.status === 0;
}

function detectPythonCommand() {
  return ['python3', 'python', 'py'].find(hasCommand) || null;
}

function runPythonValidation(args, options = {}) {
  const { parseJson = true } = options;
  const pythonCommand = detectPythonCommand();
  if (!pythonCommand) {
    return { ok: false, error: 'python3/python/py not found' };
  }
  const result = spawnSync(pythonCommand, args, { encoding: 'utf8' });
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

async function collectMarkdownFiles(rootDir) {
  return collectFiles(rootDir, (_, name) => name.endsWith('.md'));
}

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
      root: path.join(packageRoot, 'skills', 'workflow-reviewing'),
      predicate: (_, name) => name.endsWith('.md'),
      forbidden: '.claude/specs/guides/',
      message: 'workflow-reviewing 文档仍引用旧的 .claude/specs/guides/ 路径',
    },
    {
      root: path.join(packageRoot, 'skills'),
      predicate: (_, name) => name.endsWith('.md'),
      forbidden: 'scripts/workflow_cli.py',
      message: 'workflow 文档仍引用过期的 scripts/workflow_cli.py 路径',
    },
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

async function validateWorkflowContracts(repoRoot, packageRoot, errors) {
  const workflowCommandFile = path.join(packageRoot, 'commands', 'workflow.md');
  const runtimeRefsDir = path.join(packageRoot, 'specs', 'workflow-runtime');
  const runtimeTemplatesDir = path.join(packageRoot, 'specs', 'workflow-templates');
  const runtimeScriptsDir = path.join(packageRoot, 'utils', 'workflow');
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
  const scriptFiles = (await fs.readdir(scriptsDir)).filter(file => file.endsWith('.py'));
  const requiredWorkflowScripts = ['workflow_cli.py', 'task_parser.py', 'workflow_types.py', 'traceability.py', 'doc_contracts.py', 'lifecycle_cmds.py', 'quality_review.py', 'execution_sequencer.py'];
  const workflowDocSkills = ['workflow-planning', 'workflow-executing', 'workflow-reviewing', 'workflow-delta'];

  for (const file of requiredWorkflowScripts) {
    if (!scriptFiles.includes(file)) {
      errors.push(`workflow scripts 缺少 ${file}`);
    }
  }

  const docContractsScript = path.join(scriptsDir, 'doc_contracts.py');
  if (!(await fs.pathExists(docContractsScript))) {
    errors.push('workflow doc_contracts.py 不存在');
    return;
  }

  const cliFile = path.join(scriptsDir, 'workflow_cli.py');
  const overviewFile = workflowCommandFile;
  const planTemplateFile = path.join(runtimeTemplatesDir, 'plan-template.md');
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

  const pyCompile = runPythonValidation(
    ['-m', 'py_compile', ...scriptFiles.map(file => path.join(scriptsDir, file))],
    { parseJson: false }
  );
  if (!pyCompile.ok) {
    errors.push(`workflow Python 脚本语法校验失败: ${pyCompile.error}`);
  }

  const planCheck = runPythonValidation([docContractsScript, 'plan-template', planTemplateFile]);
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
    '--plan-template',
    planTemplateFile,
  ];

  for (const doc of [...extraDocs, ...splitSkillDocs]) {
    contractArgs.push('--doc', doc);
  }
  for (const file of scriptFiles) {
    contractArgs.push('--script', file);
  }

  const contractCheck = runPythonValidation(contractArgs);
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
}

async function validateTeamContracts(repoRoot, packageRoot, errors) {
  const teamCommandFile = path.join(packageRoot, 'commands', 'team.md');
  const workflowCommandFile = path.join(packageRoot, 'commands', 'workflow.md');
  const teamSkillFile = path.join(packageRoot, 'skills', 'team', 'SKILL.md');
  const teamSpecsDir = path.join(packageRoot, 'specs', 'team-runtime');
  const teamUtilsDir = path.join(packageRoot, 'utils', 'team');
  const requiredRuntimeDocs = ['overview.md', 'state-machine.md', 'execute-entry.md', 'status.md', 'archive.md'];
  const requiredTeamScripts = ['team-cli.js', 'lifecycle.js', 'state-manager.js', 'task-board.js', 'task-board-helpers.js', 'phase-controller.js', 'governance.js', 'status-renderer.js', 'planning-support.js', 'planning-artifacts.js', 'templates.js', 'doc-contracts.js'];
  const guardPaths = [
    [teamCommandFile, 'team command 入口'],
    [workflowCommandFile, 'workflow command 入口'],
    [teamSkillFile, 'team skill 入口'],
    [teamSpecsDir, 'team-runtime references'],
    [teamUtilsDir, 'team utils/scripts'],
  ];

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

  const teamSkillDocs = await collectMarkdownFiles(path.join(packageRoot, 'skills', 'team'));
  const teamDocFiles = [
    ...await collectMarkdownFiles(teamSpecsDir),
    ...teamSkillDocs,
  ];

  const [teamCommandContent, workflowCommandContent, teamSkillContent, readmeContent, claudeContent, coreClaudeContent] = await Promise.all([
    fs.readFile(teamCommandFile, 'utf8'),
    fs.readFile(workflowCommandFile, 'utf8'),
    fs.readFile(teamSkillFile, 'utf8'),
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

  const workflowMarkers = ['/team', '/workflow', '不会自动升级为 team mode'];
  for (const marker of workflowMarkers) {
    if (!workflowCommandContent.includes(marker)) {
      errors.push(`workflow command 缺少 /team 边界声明: ${marker}`);
    }
  }

  const skillMarkers = ['/workflow', '/quick-plan', 'dispatching-parallel-agents', 'team-state.json', '自动触发'];
  for (const marker of skillMarkers) {
    if (!teamSkillContent.includes(marker)) {
      errors.push(`team skill 缺少模式契约: ${marker}`);
    }
  }

  const indexedDocs = [
    {
      label: 'README.md',
      content: readmeContent,
      markers: ['/team', '不自动触发', 'team-state.json'],
    },
    {
      label: 'CLAUDE.md',
      content: claudeContent,
      markers: ['/team', 'never auto-triggered', 'team-state.json'],
    },
    {
      label: 'core/CLAUDE.md',
      content: coreClaudeContent,
      markers: ['/team mode guardrail'],
    },
  ];

  for (const doc of indexedDocs) {
    for (const marker of doc.markers) {
      if (!doc.content.includes(marker)) {
        errors.push(`${doc.label} 缺少 /team 索引或边界文案: ${marker}`);
      }
    }
  }

  const jsSyntaxCheck = runPythonValidation(
    ['-c', `import json, pathlib, subprocess\ncode = ${JSON.stringify(scriptFiles.map(file => path.join(teamUtilsDir, file)))}\nfor file in code:\n    result = subprocess.run(["node", "--check", file], capture_output=True, text=True)\n    if result.returncode != 0:\n        raise SystemExit((result.stderr or result.stdout or f"syntax check failed: {file}").strip())`],
    { parseJson: false }
  );
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
