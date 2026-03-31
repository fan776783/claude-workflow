#!/usr/bin/env node

// 发布前验证脚本
const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

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

async function validateWorkflowContracts(repoRoot, errors) {
  const workflowRoot = path.join(repoRoot, 'templates', 'skills', 'workflow');
  if (!(await fs.pathExists(workflowRoot))) {
    return;
  }

  const scriptsDir = path.join(workflowRoot, 'scripts');
  const scriptFiles = (await fs.readdir(scriptsDir)).filter(file => file.endsWith('.py'));
  const requiredWorkflowScripts = ['workflow_cli.py', 'task_parser.py', 'workflow_types.py', 'traceability.py', 'doc_contracts.py', 'lifecycle_cmds.py', 'quality_review.py', 'execution_sequencer.py'];

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
  const overviewFile = path.join(workflowRoot, 'SKILL.md');
  const planTemplateFile = path.join(workflowRoot, 'templates', 'plan-template.md');
  const referencesDir = path.join(workflowRoot, 'references');
  const extraDocs = (await fs.pathExists(referencesDir))
    ? (await fs.readdir(referencesDir))
        .filter(file => file.endsWith('.md'))
        .map(file => path.join(referencesDir, file))
    : [];

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

  for (const doc of extraDocs) {
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

async function validate() {
  const repoRoot = path.join(__dirname, '..');
  const templatesDir = path.join(repoRoot, 'templates');
  const required = ['commands'];
  const errors = [];

  console.log('[validate] 检查发布前置条件...\n');

  for (const dir of required) {
    const dirPath = path.join(templatesDir, dir);
    if (!(await fs.pathExists(dirPath))) {
      errors.push(`templates/${dir} 目录不存在`);
    } else {
      const files = await fs.readdir(dirPath);
      if (files.length === 0) {
        errors.push(`templates/${dir} 目录为空`);
      } else {
        console.log(`  ✅ templates/${dir}: ${files.length} 个文件`);
      }
    }
  }

  await validateWorkflowContracts(repoRoot, errors);

  if (errors.length > 0) {
    console.log('\n❌ 验证失败:\n');
    errors.forEach(e => console.log(`  - ${e}`));
    process.exit(1);
  }

  console.log('\n✅ 验证通过，可以发布\n');
}

validate();
