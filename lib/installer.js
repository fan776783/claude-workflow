const path = require('path');
const fs = require('fs-extra');
const semver = require('semver');

const TEMPLATE_DIRS = ['commands', 'agents', 'docs', 'utils'];
const TEMPLATE_FILES = ['CLAUDE.md'];

async function ensureClaudeHome(claudeDir, metaDir) {
  await fs.ensureDir(claudeDir);
  await fs.ensureDir(metaDir);
}

async function copyTemplatesToClaude({ templatesDir, claudeDir, overwrite = true }) {
  const results = { copied: [], skipped: [] };

  // Copy directories
  for (const name of TEMPLATE_DIRS) {
    const src = path.join(templatesDir, name);
    const dest = path.join(claudeDir, name);

    if (await fs.pathExists(src)) {
      await fs.ensureDir(dest);
      await fs.copy(src, dest, { overwrite, errorOnExist: false });
      results.copied.push(name);
    } else {
      results.skipped.push(name);
    }
  }

  // Copy root-level files
  for (const file of TEMPLATE_FILES) {
    const src = path.join(templatesDir, file);
    const dest = path.join(claudeDir, file);

    if (await fs.pathExists(src)) {
      await fs.copy(src, dest, { overwrite, errorOnExist: false });
      results.copied.push(file);
    } else {
      results.skipped.push(file);
    }
  }

  return results;
}

async function installFresh({ claudeDir, metaDir, templatesDir, version }) {
  const results = await copyTemplatesToClaude({ templatesDir, claudeDir });

  // 备份原始模板用于后续升级比对
  const originalsDir = path.join(metaDir, 'originals');
  await fs.ensureDir(originalsDir);

  // Backup directories
  for (const name of TEMPLATE_DIRS) {
    const src = path.join(templatesDir, name);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(originalsDir, name), { overwrite: true });
    }
  }

  // Backup root-level files
  for (const file of TEMPLATE_FILES) {
    const src = path.join(templatesDir, file);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(originalsDir, file), { overwrite: true });
    }
  }

  console.log(`[claude-workflow] 首次安装完成`);
  console.log(`  - 已复制: ${results.copied.join(', ')}`);

  return results;
}

async function upgradeFrom({ fromVersion, toVersion, claudeDir, metaDir, templatesDir }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(metaDir, 'backups', `v${fromVersion}-to-v${toVersion}-${timestamp}`);

  // 1. 备份当前配置
  await fs.ensureDir(backupDir);
  for (const name of TEMPLATE_DIRS) {
    const src = path.join(claudeDir, name);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(backupDir, name), { overwrite: true });
    }
  }
  for (const file of TEMPLATE_FILES) {
    const src = path.join(claudeDir, file);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(backupDir, file), { overwrite: true });
    }
  }
  console.log(`[claude-workflow] 已备份到: ${backupDir}`);

  // 2. 智能合并
  const originalsDir = path.join(metaDir, 'originals');
  const mergeLog = [];

  for (const dirName of TEMPLATE_DIRS) {
    const templateDir = path.join(templatesDir, dirName);
    if (!(await fs.pathExists(templateDir))) continue;

    const files = await fs.readdir(templateDir);
    for (const file of files) {
      const srcPath = path.join(templateDir, file);
      const destPath = path.join(claudeDir, dirName, file);
      const originalPath = path.join(originalsDir, dirName, file);

      const stat = await fs.stat(srcPath);
      if (stat.isDirectory()) continue;

      const srcContent = await fs.readFile(srcPath, 'utf8');
      const destExists = await fs.pathExists(destPath);

      if (!destExists) {
        // 新文件，直接复制
        await fs.ensureDir(path.dirname(destPath));
        await fs.copy(srcPath, destPath);
        mergeLog.push({ file: `${dirName}/${file}`, action: 'NEW' });
      } else {
        const destContent = await fs.readFile(destPath, 'utf8');
        const originalExists = await fs.pathExists(originalPath);
        const originalContent = originalExists ? await fs.readFile(originalPath, 'utf8') : null;

        if (originalContent && destContent === originalContent) {
          // 用户未修改，安全覆盖
          await fs.copy(srcPath, destPath);
          mergeLog.push({ file: `${dirName}/${file}`, action: 'UPDATED' });
        } else if (destContent === srcContent) {
          // 内容相同，跳过
          mergeLog.push({ file: `${dirName}/${file}`, action: 'UNCHANGED' });
        } else {
          // 用户有修改，写入 .new 文件
          await fs.copy(srcPath, `${destPath}.new`, { overwrite: true });
          mergeLog.push({ file: `${dirName}/${file}`, action: 'CONFLICT', newFile: `${file}.new` });
        }
      }
    }
  }

  // 2b. 智能合并根目录文件
  for (const file of TEMPLATE_FILES) {
    const srcPath = path.join(templatesDir, file);
    const destPath = path.join(claudeDir, file);
    const originalPath = path.join(originalsDir, file);

    if (!(await fs.pathExists(srcPath))) continue;

    const srcContent = await fs.readFile(srcPath, 'utf8');
    const destExists = await fs.pathExists(destPath);

    if (!destExists) {
      await fs.copy(srcPath, destPath);
      mergeLog.push({ file, action: 'NEW' });
    } else {
      const destContent = await fs.readFile(destPath, 'utf8');
      const originalExists = await fs.pathExists(originalPath);
      const originalContent = originalExists ? await fs.readFile(originalPath, 'utf8') : null;

      if (originalContent && destContent === originalContent) {
        await fs.copy(srcPath, destPath);
        mergeLog.push({ file, action: 'UPDATED' });
      } else if (destContent === srcContent) {
        mergeLog.push({ file, action: 'UNCHANGED' });
      } else {
        await fs.copy(srcPath, `${destPath}.new`, { overwrite: true });
        mergeLog.push({ file, action: 'CONFLICT', newFile: `${file}.new` });
      }
    }
  }

  // 3. 更新 originals
  for (const name of TEMPLATE_DIRS) {
    const src = path.join(templatesDir, name);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(originalsDir, name), { overwrite: true });
    }
  }
  for (const file of TEMPLATE_FILES) {
    const src = path.join(templatesDir, file);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(originalsDir, file), { overwrite: true });
    }
  }

  // 4. 写入合并日志
  const logPath = path.join(metaDir, `merge-${toVersion}-${timestamp}.json`);
  await fs.writeJson(logPath, { fromVersion, toVersion, timestamp, files: mergeLog }, { spaces: 2 });

  const conflicts = mergeLog.filter(l => l.action === 'CONFLICT');
  console.log(`[claude-workflow] 升级完成: v${fromVersion} → v${toVersion}`);
  console.log(`  - 新增: ${mergeLog.filter(l => l.action === 'NEW').length}`);
  console.log(`  - 更新: ${mergeLog.filter(l => l.action === 'UPDATED').length}`);
  console.log(`  - 冲突: ${conflicts.length}`);

  if (conflicts.length > 0) {
    console.log(`\n[警告] 以下文件有用户修改，新版本已写入 .new 文件：`);
    conflicts.forEach(c => console.log(`  - ${c.file} → ${c.newFile}`));
    console.log(`请手动合并后删除 .new 文件\n`);
  }

  return { backupDir, mergeLog };
}

module.exports = {
  ensureClaudeHome,
  copyTemplatesToClaude,
  installFresh,
  upgradeFrom,
  TEMPLATE_DIRS,
  TEMPLATE_FILES
};
