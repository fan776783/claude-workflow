const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');

const TEMPLATE_DIRS = ['commands', 'utils', 'prompts', 'skills', 'specs', 'project'];
const TEMPLATE_FILES = ['CLAUDE.md'];

// 文本文件扩展名（需要进行路径替换）
const TEXT_EXTENSIONS = ['.md', '.txt', '.json', '.yaml', '.yml', '.sh', '.js', '.ts'];

/**
 * 替换模板内容中的 ~ 路径为绝对路径
 * 解决 Windows 多用户环境下路径解析问题
 * 使用函数式 replacer 避免 $ 字符触发特殊语义
 * Windows 路径统一转换为正斜杠，避免反斜杠破坏 JSON/JS 字符串
 */
function replaceHomePathsInTemplate(content, claudeDir) {
  const userHome = os.homedir();
  // 规范化路径：移除尾部斜杠，Windows 反斜杠转正斜杠
  const normalizedClaudeDir = claudeDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedHome = userHome.replace(/\\/g, '/').replace(/\/+$/, '');

  // 使用函数式 replacer 避免 $ 字符问题
  let processed = content.replace(/~\/\.claude\//g, () => `${normalizedClaudeDir}/`);
  processed = processed.replace(/~\//g, () => `${normalizedHome}/`);

  return processed;
}

/**
 * 检查文件是否为文本文件
 */
function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.includes(ext);
}

/**
 * 复制文件，对文本文件进行路径替换，保留文件权限和符号链接
 */
async function copyFileWithPathReplace(srcPath, destPath, claudeDir) {
  const srcStats = await fs.lstat(srcPath);

  // 处理符号链接：保留链接而非解引用
  if (srcStats.isSymbolicLink()) {
    const linkTarget = await fs.readlink(srcPath);
    await fs.ensureDir(path.dirname(destPath));
    // 删除已存在的目标文件/链接
    if (await fs.pathExists(destPath)) {
      await fs.remove(destPath);
    }
    await fs.symlink(linkTarget, destPath);
    return;
  }

  if (isTextFile(srcPath)) {
    const content = await fs.readFile(srcPath, 'utf8');
    const processed = replaceHomePathsInTemplate(content, claudeDir);
    await fs.ensureDir(path.dirname(destPath));
    await fs.writeFile(destPath, processed, 'utf8');
    // 保留原始文件权限
    await fs.chmod(destPath, srcStats.mode);
  } else {
    await fs.ensureDir(path.dirname(destPath));
    await fs.copy(srcPath, destPath, { overwrite: true });
  }
}

// 获取当前平台的二进制文件名
function getBinaryName() {
  const platform = os.platform();
  const arch = os.arch();

  // 映射架构名称
  const archMap = {
    'x64': 'amd64',
    'arm64': 'arm64'
  };
  const mappedArch = archMap[arch] || arch;

  if (platform === 'darwin') {
    return `codeagent-wrapper-darwin-${mappedArch}`;
  } else if (platform === 'linux') {
    return `codeagent-wrapper-linux-${mappedArch}`;
  } else if (platform === 'win32') {
    return `codeagent-wrapper-windows-${mappedArch}.exe`;
  }
  return null;
}

// 获取安装目录
function getInstallDir() {
  const platform = os.platform();
  const homeDir = os.homedir();

  if (platform === 'win32') {
    // Windows: ~/.local/bin 或 LOCALAPPDATA
    const localBin = path.join(homeDir, '.local', 'bin');
    return localBin;
  } else {
    // Unix: ~/.local/bin
    return path.join(homeDir, '.local', 'bin');
  }
}

// 检查目录是否在 PATH 中
function isInPath(dir) {
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  return pathDirs.includes(dir);
}

// 安装 codeagent-wrapper 二进制文件
async function installBinary(packageDir) {
  const binaryName = getBinaryName();
  if (!binaryName) {
    console.log(`[claude-workflow] 不支持的平台: ${os.platform()}-${os.arch()}`);
    return { success: false, reason: 'unsupported_platform' };
  }

  const srcPath = path.join(packageDir, 'bin', binaryName);
  if (!(await fs.pathExists(srcPath))) {
    console.log(`[claude-workflow] 未找到预编译二进制: ${binaryName}`);
    return { success: false, reason: 'binary_not_found' };
  }

  const installDir = getInstallDir();
  await fs.ensureDir(installDir);

  const targetName = os.platform() === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper';
  const destPath = path.join(installDir, targetName);

  try {
    await fs.copy(srcPath, destPath, { overwrite: true });

    // 设置执行权限 (Unix)
    if (os.platform() !== 'win32') {
      await fs.chmod(destPath, 0o755);
    }

    // 验证安装：运行 --version 检查二进制是否可执行
    try {
      execSync(`"${destPath}" --version`, { stdio: 'pipe' });
    } catch (verifyError) {
      console.log(`[claude-workflow] 二进制验证失败: ${verifyError.message}`);
      return { success: false, reason: 'verification_failed', error: verifyError.message, installDir };
    }

    console.log(`[claude-workflow] 已安装 codeagent-wrapper 到: ${destPath}`);

    // 检查是否在 PATH 中
    const inPath = isInPath(installDir);
    if (!inPath) {
      console.log(`[claude-workflow] 警告: ${installDir} 不在 PATH 中`);
    }

    return { success: true, path: destPath, installDir, inPath };
  } catch (err) {
    console.log(`[claude-workflow] 安装二进制失败: ${err.message}`);
    return { success: false, reason: 'install_failed', error: err.message };
  }
}

async function ensureClaudeHome(claudeDir, metaDir) {
  await fs.ensureDir(claudeDir);
  await fs.ensureDir(metaDir);
}

async function copyTemplatesToClaude({ templatesDir, claudeDir, overwrite = true, backupDir = null }) {
  const results = { copied: [], skipped: [], backedUp: [] };

  // 备份冲突文件（内容不同时才备份）
  async function backupIfConflict(srcPath, destPath, relPath) {
    if (!backupDir || !(await fs.pathExists(destPath))) return false;

    const srcContent = await fs.readFile(srcPath, 'utf8');
    const destContent = await fs.readFile(destPath, 'utf8');
    const processedSrc = replaceHomePathsInTemplate(srcContent, claudeDir);

    if (destContent !== processedSrc) {
      const backupPath = path.join(backupDir, relPath);
      await fs.ensureDir(path.dirname(backupPath));
      await fs.copy(destPath, backupPath);
      return true;
    }
    return false;
  }

  // 递归复制目录中的所有文件（带路径替换）
  async function copyDirRecursive(srcDir, destDir, baseRelPath = '') {
    if (!(await fs.pathExists(srcDir))) return;

    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      const relPath = baseRelPath ? path.join(baseRelPath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await copyDirRecursive(srcPath, destPath, relPath);
      } else {
        if (overwrite || !(await fs.pathExists(destPath))) {
          const wasBackedUp = await backupIfConflict(srcPath, destPath, relPath);
          if (wasBackedUp) {
            results.backedUp.push(relPath);
          }
          await copyFileWithPathReplace(srcPath, destPath, claudeDir);
        }
      }
    }
  }

  // Copy directories (recursively with path replacement)
  for (const name of TEMPLATE_DIRS) {
    const src = path.join(templatesDir, name);
    const dest = path.join(claudeDir, name);

    if (await fs.pathExists(src)) {
      await fs.ensureDir(dest);
      await copyDirRecursive(src, dest, name);
      results.copied.push(name);
    } else {
      results.skipped.push(name);
    }
  }

  // Copy root-level files (with path replacement)
  for (const file of TEMPLATE_FILES) {
    const src = path.join(templatesDir, file);
    const dest = path.join(claudeDir, file);

    if (await fs.pathExists(src)) {
      if (overwrite || !(await fs.pathExists(dest))) {
        const wasBackedUp = await backupIfConflict(src, dest, file);
        if (wasBackedUp) {
          results.backedUp.push(file);
        }
        await copyFileWithPathReplace(src, dest, claudeDir);
      }
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

  // 递归处理目录中的所有文件
  async function processDirectory(dirName, relativePath = '') {
    const templateDir = path.join(templatesDir, dirName, relativePath);
    if (!(await fs.pathExists(templateDir))) return;

    const entries = await fs.readdir(templateDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const srcPath = path.join(templatesDir, dirName, relPath);
      const destPath = path.join(claudeDir, dirName, relPath);
      const originalPath = path.join(originalsDir, dirName, relPath);

      if (entry.isDirectory()) {
        // 递归处理子目录
        await processDirectory(dirName, relPath);
        continue;
      }

      const srcContent = await fs.readFile(srcPath, 'utf8');
      const destExists = await fs.pathExists(destPath);

      if (!destExists) {
        // 新文件，复制并替换路径
        await copyFileWithPathReplace(srcPath, destPath, claudeDir);
        mergeLog.push({ file: `${dirName}/${relPath}`, action: 'NEW' });
      } else {
        const destContent = await fs.readFile(destPath, 'utf8');
        const originalExists = await fs.pathExists(originalPath);
        const originalContent = originalExists ? await fs.readFile(originalPath, 'utf8') : null;

        // 使用处理后的内容进行比较（destContent 已包含替换后的路径）
        const processedOriginal = originalContent ? replaceHomePathsInTemplate(originalContent, claudeDir) : null;
        const processedSrc = replaceHomePathsInTemplate(srcContent, claudeDir);

        if (processedOriginal && destContent === processedOriginal) {
          // 用户未修改，安全覆盖（带路径替换）
          await copyFileWithPathReplace(srcPath, destPath, claudeDir);
          mergeLog.push({ file: `${dirName}/${relPath}`, action: 'UPDATED' });
        } else if (destContent === processedSrc) {
          // 内容相同，跳过
          mergeLog.push({ file: `${dirName}/${relPath}`, action: 'UNCHANGED' });
        } else {
          // 用户有修改，备份旧文件后覆盖
          const conflictBackupPath = path.join(backupDir, dirName, relPath);
          await fs.ensureDir(path.dirname(conflictBackupPath));
          await fs.copy(destPath, conflictBackupPath);
          await copyFileWithPathReplace(srcPath, destPath, claudeDir);
          mergeLog.push({ file: `${dirName}/${relPath}`, action: 'CONFLICT', backup: `${backupDir}/${dirName}/${relPath}` });
        }
      }
    }
  }

  for (const dirName of TEMPLATE_DIRS) {
    await processDirectory(dirName);
  }

  // 2b. 根目录文件直接覆盖（已备份到 backupDir）
  for (const file of TEMPLATE_FILES) {
    const srcPath = path.join(templatesDir, file);
    const destPath = path.join(claudeDir, file);

    if (!(await fs.pathExists(srcPath))) continue;

    const destExists = await fs.pathExists(destPath);

    if (!destExists) {
      await copyFileWithPathReplace(srcPath, destPath, claudeDir);
      mergeLog.push({ file, action: 'NEW' });
    } else {
      const srcContent = await fs.readFile(srcPath, 'utf8');
      const destContent = await fs.readFile(destPath, 'utf8');
      const processedSrc = replaceHomePathsInTemplate(srcContent, claudeDir);

      if (destContent === processedSrc) {
        mergeLog.push({ file, action: 'UNCHANGED' });
      } else {
        // 直接覆盖，旧版本已备份到 backupDir（带路径替换）
        await copyFileWithPathReplace(srcPath, destPath, claudeDir);
        mergeLog.push({ file, action: 'OVERWRITTEN', backup: `${backupDir}/${file}` });
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
  const overwritten = mergeLog.filter(l => l.action === 'OVERWRITTEN');
  console.log(`[claude-workflow] 升级完成: v${fromVersion} → v${toVersion}`);
  console.log(`  - 新增: ${mergeLog.filter(l => l.action === 'NEW').length}`);
  console.log(`  - 更新: ${mergeLog.filter(l => l.action === 'UPDATED').length}`);
  console.log(`  - 覆盖: ${overwritten.length}`);
  console.log(`  - 冲突: ${conflicts.length}`);

  if (overwritten.length > 0) {
    console.log(`\n[信息] 以下文件已直接覆盖，旧版本已备份：`);
    overwritten.forEach(o => console.log(`  - ${o.file} (备份: ${o.backup})`));
  }

  if (conflicts.length > 0) {
    console.log(`\n[信息] 以下文件有用户修改，已备份后覆盖：`);
    conflicts.forEach(c => console.log(`  - ${c.file} (备份: ${c.backup})`));
  }

  return { backupDir, mergeLog };
}

module.exports = {
  ensureClaudeHome,
  copyTemplatesToClaude,
  installFresh,
  upgradeFrom,
  installBinary,
  getBinaryName,
  getInstallDir,
  TEMPLATE_DIRS,
  TEMPLATE_FILES
};
