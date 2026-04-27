const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');

const {
  agents,
  detectInstalledAgents,
  getCanonicalDir,
  getAgentBaseDir,
  getAgentCommandNamespaceDir,
  getAgentManagedDir,
  getAgentManagedSubdir,
  getAgentSkillsDir,
} = require('./agents');

const PACKAGE_ROOT_SEGMENTS = ['core'];
const TEMPLATE_DIRS = ['agents', 'commands', 'hooks', 'skills', 'specs', 'utils'];
const TEMPLATE_FILES = ['CLAUDE.md'];
const MANAGED_DIRS = ['hooks', 'specs', 'utils'];
const COMMANDS_DIR = 'commands';
const SKILLS_DIR = 'skills';
const MANAGED_NAMESPACE_DIR = '.agent-workflow';
const CANONICAL_DIR_NAME = 'agent-workflow';
const LOG_PREFIX = '[agent-workflow]';
const INSTALL_MODE_CANONICAL_COPY = 'canonical-copy';
const INSTALL_MODE_REPO_LINK = 'repo-link';
const MANAGED_SKILLS_MANIFEST = '.agent-workflow-managed-skills.json';
// @installer-plugin-migration: STEP_4_DONE
// v6.0.0: Claude Code 已迁移到 Plugin 机制，installer 不再处理 claude-code 的
// subagent 文件同步、settings.json hook 注入、CLAUDE.md 复制。相关代码由
// lib/claude-code-plugin.js 接管。
const MANAGED_SKIP_NAMES = new Set(['__pycache__']);
const MANAGED_SKIP_EXTENSIONS = new Set(['.pyc', '.pyo', '.pyd']);

// 文本文件扩展名（需要进行路径替换）
const TEXT_EXTENSIONS = ['.md', '.txt', '.json', '.yaml', '.yml', '.sh', '.js', '.ts'];

/**
 * 获取包源码根目录（repo 内的 core/ 目录）
 * @param {string} repoRoot - 仓库根目录
 * @returns {string} 包源码根目录路径
 */
function getPackageSourceRoot(repoRoot) {
  return path.join(repoRoot, ...PACKAGE_ROOT_SEGMENTS);
}

/**
 * 获取 canonical 位置下的包根目录
 * @param {string} canonicalDir - canonical 目录
 * @returns {string} canonical 包根目录路径
 */
function getCanonicalPackageRoot(canonicalDir) {
  return path.join(canonicalDir, ...PACKAGE_ROOT_SEGMENTS);
}

/**
 * 获取受管 commands manifest 文件路径
 * @param {string} agentCommandsDir - Agent commands 目录
 * @returns {string} manifest 文件路径
 */
function getManagedCommandsManifestPath(agentCommandsDir) {
  return path.join(agentCommandsDir, '.agent-workflow-managed-commands.json');
}

/**
 * 读取受管 commands manifest
 * @param {string} agentCommandsDir - Agent commands 目录
 * @returns {Promise<Object>} manifest 中的 entries 对象
 */
async function readManagedCommandsManifest(agentCommandsDir) {
  const manifestPath = getManagedCommandsManifestPath(agentCommandsDir);
  if (!(await fs.pathExists(manifestPath))) {
    return {};
  }

  try {
    const manifest = await fs.readJson(manifestPath);
    return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? (manifest.entries || {})
      : {};
  } catch {
    return {};
  }
}

/**
 * 写入受管 commands manifest
 * @param {string} agentCommandsDir - Agent commands 目录
 * @param {Object} entries - 安装结果条目
 */
async function writeManagedCommandsManifest(agentCommandsDir, entries) {
  const manifestPath = getManagedCommandsManifestPath(agentCommandsDir);
  const managedEntries = Object.fromEntries(
    Object.entries(entries)
      .filter(([, result]) => result?.success)
      .map(([name, result]) => [name, { mode: result.mode }])
  );

  await fs.writeJson(manifestPath, { entries: managedEntries }, { spaces: 2 });
}

/**
 * 判断文件/目录名是否应被忽略（如 __pycache__、.pyc 等）
 * @param {string} entryName - 文件或目录名
 * @returns {boolean} 是否应忽略
 */
function isManagedEntryIgnored(entryName) {
  return MANAGED_SKIP_NAMES.has(entryName) || MANAGED_SKIP_EXTENSIONS.has(path.extname(entryName).toLowerCase());
}

/**
 * 获取受管 skills manifest 文件路径
 * @param {string} agentSkillsDir - Agent skills 目录
 * @returns {string} manifest 文件路径
 */
function getManagedSkillsManifestPath(agentSkillsDir) {
  return path.join(agentSkillsDir, MANAGED_SKILLS_MANIFEST);
}

/**
 * 读取受管 skills manifest
 * @param {string} agentSkillsDir - Agent skills 目录
 * @returns {Promise<Object>} manifest 中的 entries 对象
 */
async function readManagedSkillsManifest(agentSkillsDir) {
  const manifestPath = getManagedSkillsManifestPath(agentSkillsDir);
  if (!(await fs.pathExists(manifestPath))) {
    return {};
  }

  try {
    const manifest = await fs.readJson(manifestPath);
    return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? (manifest.entries || {})
      : {};
  } catch {
    return {};
  }
}

/**
 * 写入受管 skills manifest
 * @param {string} agentSkillsDir - Agent skills 目录
 * @param {Object} entries - 安装结果条目
 */
async function writeManagedSkillsManifest(agentSkillsDir, entries) {
  const manifestPath = getManagedSkillsManifestPath(agentSkillsDir);
  const managedEntries = Object.fromEntries(
    Object.entries(entries)
      .filter(([, result]) => result?.success)
      .map(([name, result]) => [name, { mode: result.mode }])
  );

  await fs.writeJson(manifestPath, { entries: managedEntries }, { spaces: 2 });
}

/**
 * 判断是否为旧版受管 skill 副本（如已重命名的 debug → fix-bug）
 * @param {string} entryPath - skill 目录路径
 * @param {string} entryName - skill 名称
 * @param {Set<string>} canonicalSkillNames - 当前 canonical skill 名称集合
 * @returns {Promise<boolean>} 是否为旧版受管副本
 */
async function isLegacyManagedSkillCopy(entryPath, entryName, canonicalSkillNames) {
  if (entryName !== 'debug' || canonicalSkillNames.has(entryName) || !canonicalSkillNames.has('fix-bug')) {
    return false;
  }

  const skillFile = path.join(entryPath, 'SKILL.md');
  const impactAnalysisFile = path.join(entryPath, 'references', 'impact-analysis.md');

  if (!(await fs.pathExists(skillFile)) || !(await fs.pathExists(impactAnalysisFile))) {
    return false;
  }

  try {
    const skillContent = await fs.readFile(skillFile, 'utf8');
    return /^name:\s*debug\b/m.test(skillContent) || skillContent.includes('/debug ');
  } catch {
    return false;
  }
}

/**
 * 删除目标目录中源目录已不存在的受管条目
 * @param {string} srcDir - 源目录
 * @param {string} destDir - 目标目录
 */
async function removeDeletedManagedEntries(srcDir, destDir) {
  if (!(await fs.pathExists(destDir))) {
    return;
  }

  const srcExists = await fs.pathExists(srcDir);
  if (!srcExists) {
    await fs.remove(destDir);
    return;
  }

  const [srcEntries, destEntries] = await Promise.all([
    fs.readdir(srcDir, { withFileTypes: true }),
    fs.readdir(destDir, { withFileTypes: true }),
  ]);
  const srcNames = new Set(
    srcEntries
      .filter(entry => !isManagedEntryIgnored(entry.name))
      .map(entry => entry.name)
  );

  for (const entry of destEntries) {
    const destPath = path.join(destDir, entry.name);
    const srcPath = path.join(srcDir, entry.name);

    if (isManagedEntryIgnored(entry.name)) {
      await fs.remove(destPath);
      continue;
    }

    if (!srcNames.has(entry.name)) {
      await fs.remove(destPath);
      continue;
    }

    if (entry.isDirectory()) {
      await removeDeletedManagedEntries(srcPath, destPath);
    }
  }
}

/**
 * 替换模板内容中的 ~ 路径为绝对路径
 * 解决 Windows 多用户环境下路径解析问题
 * 使用函数式 replacer 避免 $ 字符触发特殊语义
 * Windows 路径统一转换为正斜杠，避免反斜杠破坏 JSON/JS 字符串
 */
function replaceHomePathsInTemplate(content, claudeDir, canonicalDir = null) {
  const userHome = os.homedir();
  // 规范化路径：移除尾部斜杠，Windows 反斜杠转正斜杠
  const normalizedClaudeDir = claudeDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedHome = userHome.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedCanonicalDir = canonicalDir
    ? canonicalDir.replace(/\\/g, '/').replace(/\/+$/, '')
    : null;

  // 使用函数式 replacer 避免 $ 字符问题
  let processed = content;
  if (normalizedCanonicalDir) {
    processed = processed.replace(/~\/\.agents\/agent-workflow\//g, () => `${normalizedCanonicalDir}/`);
  }
  processed = processed.replace(/~\/\.claude\//g, () => `${normalizedClaudeDir}/`);
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
async function copyFileWithPathReplace(srcPath, destPath, claudeDir, canonicalDir = null) {
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
    const processed = replaceHomePathsInTemplate(content, claudeDir, canonicalDir);
    await fs.ensureDir(path.dirname(destPath));
    await fs.writeFile(destPath, processed, 'utf8');
    // 保留原始文件权限
    await fs.chmod(destPath, srcStats.mode);
  } else {
    await fs.ensureDir(path.dirname(destPath));
    await fs.copy(srcPath, destPath, { overwrite: true });
  }
}



/**
 * 确保 Claude 主目录和元数据目录存在
 * @param {string} claudeDir - Claude 主目录
 * @param {string} metaDir - 元数据目录
 */
async function ensureClaudeHome(claudeDir, metaDir) {
  await fs.ensureDir(claudeDir);
  await fs.ensureDir(metaDir);
}

/**
 * 复制模板文件到 Claude 目录（带路径替换和冲突备份）
 * @param {Object} options - 选项
 * @param {string} options.templatesDir - 模板源目录
 * @param {string} options.claudeDir - Claude 目标目录
 * @param {boolean} options.overwrite - 是否覆盖已有文件
 * @param {string|null} options.backupDir - 冲突备份目录
 * @returns {Promise<{copied: string[], skipped: string[], backedUp: string[]}>}
 */
async function copyTemplatesToClaude({ templatesDir, claudeDir, overwrite = true, backupDir = null }) {
  const results = { copied: [], skipped: [], backedUp: [] };
  const packageRoot = getPackageSourceRoot(templatesDir);

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
      if (isManagedEntryIgnored(entry.name)) {
        continue;
      }

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
    const src = path.join(packageRoot, name);
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
    const src = path.join(packageRoot, file);
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

/**
 * 首次安装：复制模板并备份原始文件用于后续升级比对
 * @param {Object} options - 选项
 * @param {string} options.claudeDir - Claude 目标目录
 * @param {string} options.metaDir - 元数据目录
 * @param {string} options.templatesDir - 模板源目录
 * @param {string} options.version - 安装版本号
 * @returns {Promise<{copied: string[], skipped: string[], backedUp: string[]}>}
 */
async function installFresh({ claudeDir, metaDir, templatesDir, version }) {
  const results = await copyTemplatesToClaude({ templatesDir, claudeDir });
  const packageRoot = getPackageSourceRoot(templatesDir);

  // 备份原始模板用于后续升级比对
  const originalsDir = path.join(metaDir, 'originals');
  await fs.ensureDir(originalsDir);

  // Backup directories
  for (const name of TEMPLATE_DIRS) {
    const src = path.join(packageRoot, name);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(originalsDir, name), {
        overwrite: true,
        filter: srcPath => !isManagedEntryIgnored(path.basename(srcPath)),
      });
    }
  }

  // Backup root-level files
  for (const file of TEMPLATE_FILES) {
    const src = path.join(packageRoot, file);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(originalsDir, file), { overwrite: true });
    }
  }

  console.log(`${LOG_PREFIX} 首次安装完成`);
  console.log(`  - 已复制: ${results.copied.join(', ')}`);

  return results;
}

/**
 * 版本升级：备份当前配置、智能合并模板变更、记录合并日志
 * @param {Object} options - 选项
 * @param {string} options.fromVersion - 旧版本号
 * @param {string} options.toVersion - 新版本号
 * @param {string} options.claudeDir - Claude 目标目录
 * @param {string} options.metaDir - 元数据目录
 * @param {string} options.templatesDir - 模板源目录
 * @returns {Promise<{backupDir: string, mergeLog: Object[]}>}
 */
async function upgradeFrom({ fromVersion, toVersion, claudeDir, metaDir, templatesDir }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(metaDir, 'backups', `v${fromVersion}-to-v${toVersion}-${timestamp}`);
  const packageRoot = getPackageSourceRoot(templatesDir);

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
  console.log(`${LOG_PREFIX} 已备份到: ${backupDir}`);

  // 2. 智能合并
  const originalsDir = path.join(metaDir, 'originals');
  const mergeLog = [];

  // 递归处理目录中的所有文件
  async function processDirectory(dirName, relativePath = '') {
    const templateDir = path.join(packageRoot, dirName, relativePath);
    if (!(await fs.pathExists(templateDir))) return;

    const entries = await fs.readdir(templateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (isManagedEntryIgnored(entry.name)) {
        continue;
      }

      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const srcPath = path.join(packageRoot, dirName, relPath);
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
    const srcPath = path.join(packageRoot, file);
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
    const src = path.join(packageRoot, name);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(originalsDir, name), {
        overwrite: true,
        filter: srcPath => !isManagedEntryIgnored(path.basename(srcPath)),
      });
    }
  }
  for (const file of TEMPLATE_FILES) {
    const src = path.join(packageRoot, file);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(originalsDir, file), { overwrite: true });
    }
  }

  // 4. 写入合并日志
  const logPath = path.join(metaDir, `merge-${toVersion}-${timestamp}.json`);
  await fs.writeJson(logPath, { fromVersion, toVersion, timestamp, files: mergeLog }, { spaces: 2 });

  const conflicts = mergeLog.filter(l => l.action === 'CONFLICT');
  const overwritten = mergeLog.filter(l => l.action === 'OVERWRITTEN');
  console.log(`${LOG_PREFIX} 升级完成: v${fromVersion} → v${toVersion}`);
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
  TEMPLATE_DIRS,
  TEMPLATE_FILES,
  MANAGED_DIRS,
  COMMANDS_DIR,
  SKILLS_DIR,
  MANAGED_NAMESPACE_DIR,
  createSymlink,
  installToCanonical,
  linkToAgents,
  installForAgents,
  linkRepoToAgents,
  migrateFromLegacy,
  getInstallationStatus,
  INSTALL_MODE_CANONICAL_COPY,
  INSTALL_MODE_REPO_LINK,
};

// ============================================
// 多 Agent 支持函数
// ============================================

/**
 * 获取源目录下的所有 skill 条目
 * @param {string} sourceRoot - 源根目录
 * @returns {Promise<Array<{name: string, target: string}>>} skill 条目列表
 */
async function getSkillEntries(sourceRoot) {
  const skillsRoot = path.join(sourceRoot, SKILLS_DIR);
  if (!(await fs.pathExists(skillsRoot))) {
    return [];
  }

  const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      target: path.join(skillsRoot, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 获取源目录下的所有 command 条目（.md 文件）
 * @param {string} sourceRoot - 源根目录
 * @returns {Promise<Array<{name: string, target: string}>>} command 条目列表
 */
async function getCommandEntries(sourceRoot) {
  const commandsRoot = path.join(sourceRoot, COMMANDS_DIR);
  if (!(await fs.pathExists(commandsRoot))) {
    return [];
  }

  const entries = await fs.readdir(commandsRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => ({
      name: entry.name,
      target: path.join(commandsRoot, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 获取受管源根目录集合（去重）
 * @param {string} sourceRoot - 源根目录
 * @param {string} canonicalDir - canonical 目录
 * @returns {Set<string>} 受管源根目录集合
 */
function getManagedSourceRoots(sourceRoot, canonicalDir) {
  const roots = new Set();
  if (sourceRoot) {
    roots.add(path.resolve(sourceRoot));
  }
  if (canonicalDir) {
    roots.add(path.resolve(canonicalDir));
  }
  return roots;
}

/**
 * 判断路径是否属于受管根目录
 * @param {string} resolvedTarget - 已解析的目标路径
 * @param {Set<string>} managedRoots - 受管根目录集合
 * @param {string} dirName - 子目录名（可选）
 * @returns {boolean} 是否为受管路径
 */
function isManagedPath(resolvedTarget, managedRoots, dirName = '') {
  for (const root of managedRoots) {
    const managedDir = dirName ? path.join(root, dirName) : root;
    if (resolvedTarget === managedDir || resolvedTarget.startsWith(`${managedDir}${path.sep}`)) {
      return true;
    }
  }
  return false;
}

/**
 * 规范化安装模式值
 * @param {string} mode - 原始模式值
 * @returns {string} 规范化后的模式（canonical-copy 或 repo-link）
 */
function normalizeMetaMode(mode) {
  return mode === INSTALL_MODE_REPO_LINK ? INSTALL_MODE_REPO_LINK : INSTALL_MODE_CANONICAL_COPY;
}

/**
 * 规范化源根目录路径，自动探测包含 skills/ 或 commands/ 的有效路径
 * @param {string} sourceRoot - 原始源根目录
 * @param {string} canonicalDir - canonical 目录
 * @returns {Promise<string>} 规范化后的源根目录
 */
async function normalizeSourceRoot(sourceRoot, canonicalDir) {
  const candidates = [];
  const pushCandidate = candidate => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (!candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  pushCandidate(sourceRoot);
  if (sourceRoot) {
    pushCandidate(path.join(sourceRoot, ...PACKAGE_ROOT_SEGMENTS));
  }
  pushCandidate(getCanonicalPackageRoot(canonicalDir));

  for (const candidate of candidates) {
    if (
      await fs.pathExists(path.join(candidate, SKILLS_DIR))
      || await fs.pathExists(path.join(candidate, COMMANDS_DIR))
    ) {
      return candidate;
    }
  }

  return path.resolve(sourceRoot || getCanonicalPackageRoot(canonicalDir));
}

/**
 * 获取 canonical 位置下的 skills 目录
 * @param {string} canonicalDir - canonical 目录
 * @returns {string} skills 目录路径
 */
function getCanonicalSkillsDir(canonicalDir) {
  return path.join(getCanonicalPackageRoot(canonicalDir), SKILLS_DIR);
}

/**
 * 获取 canonical 位置下的所有 skill 条目
 * @param {string} canonicalDir - canonical 目录
 * @returns {Promise<Array<{name: string, target: string}>>} skill 条目列表
 */
async function getCanonicalSkillEntries(canonicalDir) {
  return getSkillEntries(getCanonicalPackageRoot(canonicalDir));
}

/**
 * 确保 Agent skills 根目录为普通目录（如果是旧版 symlink 则移除后重建）
 * @param {string} agentSkillsDir - Agent skills 目录
 * @param {string} canonicalSkillsDir - canonical skills 目录
 */
async function ensureAgentSkillsRoot(agentSkillsDir, canonicalSkillsDir) {
  if (await fs.pathExists(agentSkillsDir)) {
    const stats = await fs.lstat(agentSkillsDir);
    if (stats.isSymbolicLink()) {
      const existingTarget = await fs.readlink(agentSkillsDir);
      const resolvedExisting = path.resolve(path.dirname(agentSkillsDir), existingTarget);
      const resolvedCanonicalSkillsDir = path.resolve(canonicalSkillsDir);
      if (resolvedExisting === resolvedCanonicalSkillsDir) {
        await fs.remove(agentSkillsDir);
      }
    } else if (!stats.isDirectory()) {
      await fs.remove(agentSkillsDir);
    }
  }

  await fs.ensureDir(agentSkillsDir);
}

/**
 * 读取链接/目录的状态信息
 * @param {string} linkPath - 链接或目录路径
 * @returns {Promise<{exists: boolean, valid: boolean, mode: string|null, target?: string}>}
 */
async function readLinkState(linkPath) {
  try {
    const stats = await fs.lstat(linkPath);
    if (stats.isSymbolicLink()) {
      const target = await fs.readlink(linkPath);
      const resolvedTarget = path.resolve(path.dirname(linkPath), target);
      return {
        exists: true,
        valid: await fs.pathExists(resolvedTarget),
        mode: 'symlink',
        target: resolvedTarget,
      };
    }

    if (stats.isDirectory()) {
      return { exists: true, valid: true, mode: 'copy', target: linkPath };
    }

    return { exists: true, valid: false, mode: 'unknown', target: linkPath };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { exists: false, valid: false, mode: null };
    }
    return { exists: true, valid: false, mode: 'unknown', target: linkPath };
  }
}

/**
 * 移除不再存在于源中的受管 skill 链接
 * @param {string} agentSkillsDir - Agent skills 目录
 * @param {Set<string>} skillNames - 当前有效的 skill 名称集合
 * @param {Object} options - 选项
 * @param {string} options.sourceRoot - 源根目录
 * @param {string} options.canonicalDir - canonical 目录
 * @returns {Promise<string[]>} 被移除的 skill 名称列表
 */
async function removeStaleManagedSkillLinks(agentSkillsDir, skillNames, options = {}) {
  if (!(await fs.pathExists(agentSkillsDir))) {
    return [];
  }

  const { sourceRoot = null, canonicalDir = null } = options;
  const managedRoots = getManagedSourceRoots(sourceRoot, canonicalDir);
  const removed = [];
  const manifestEntries = await readManagedSkillsManifest(agentSkillsDir);
  const entries = await fs.readdir(agentSkillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === MANAGED_SKILLS_MANIFEST) {
      continue;
    }

    if (!skillNames.has(entry.name)) {
      const entryPath = path.join(agentSkillsDir, entry.name);
      const stats = await fs.lstat(entryPath);
      const managedByManifest = Boolean(manifestEntries[entry.name]);
      if (stats.isSymbolicLink()) {
        const existingTarget = await fs.readlink(entryPath);
        const resolvedTarget = path.resolve(path.dirname(entryPath), existingTarget);
        if (managedByManifest || isManagedPath(resolvedTarget, managedRoots, SKILLS_DIR)) {
          await fs.remove(entryPath);
          removed.push(entry.name);
        }
      } else if (
        stats.isDirectory() &&
        (
          managedByManifest ||
          await isLegacyManagedSkillCopy(entryPath, entry.name, skillNames)
        )
      ) {
        await fs.remove(entryPath);
        removed.push(entry.name);
      }
    }
  }

  return removed;
}

/**
 * 为 Agent 链接 command 条目（清理过期条目 + 创建新链接 + 更新 manifest）
 * @param {string} sourceRoot - 源根目录
 * @param {string} agentCommandNamespaceDir - Agent commands 命名空间目录
 * @param {boolean} fallbackToCopy - 链接失败时是否回退到复制
 * @returns {Promise<{rootMode: string, entries: Object, removed: string[], count: number}>}
 */
async function linkCommandEntries(sourceRoot, agentCommandNamespaceDir, fallbackToCopy = true) {
  const commandEntries = await getCommandEntries(sourceRoot);
  const commandNames = new Set(commandEntries.map(entry => entry.name));

  await fs.ensureDir(agentCommandNamespaceDir);

  const removed = [];
  const manifestEntries = await readManagedCommandsManifest(agentCommandNamespaceDir);
  const existingEntries = await fs.readdir(agentCommandNamespaceDir, { withFileTypes: true });

  for (const entry of existingEntries) {
    if (entry.name === path.basename(getManagedCommandsManifestPath(agentCommandNamespaceDir))) {
      continue;
    }

    if (!commandNames.has(entry.name)) {
      const entryPath = path.join(agentCommandNamespaceDir, entry.name);
      if (manifestEntries[entry.name]) {
        await fs.remove(entryPath);
        removed.push(entry.name);
      }
    }
  }

  const links = {};
  for (const entry of commandEntries) {
    const linkPath = path.join(agentCommandNamespaceDir, entry.name);
    links[entry.name] = await createSymlink(entry.target, linkPath, fallbackToCopy);
  }

  await writeManagedCommandsManifest(agentCommandNamespaceDir, links);

  return {
    rootMode: 'directory',
    entries: links,
    removed,
    count: commandEntries.length,
  };
}

/**
 * 为 Agent 链接受管目录（docs, hooks, specs, utils）
 * @param {string} sourceRoot - 源根目录
 * @param {string} agentManagedDir - Agent 受管命名空间目录
 * @param {boolean} fallbackToCopy - 链接失败时是否回退到复制
 * @returns {Promise<Object>} 各目录的链接结果
 */
async function linkManagedDirs(sourceRoot, agentManagedDir, fallbackToCopy = true) {
  const links = {};
  await fs.ensureDir(agentManagedDir);

  for (const dirName of MANAGED_DIRS) {
    const target = path.join(sourceRoot, dirName);
    const linkPath = path.join(agentManagedDir, dirName);

    if (await fs.pathExists(target)) {
      links[dirName] = await createSymlink(target, linkPath, fallbackToCopy);
    }
  }

  return links;
}

/**
 * 移除旧版直接链接布局（commands, docs, hooks, specs, utils 的根级 symlink）
 * @param {string} agentBaseDir - Agent 根目录
 */
async function removeLegacyDirectLinks(agentBaseDir) {
  for (const dirName of [COMMANDS_DIR, ...MANAGED_DIRS]) {
    const linkPath = path.join(agentBaseDir, dirName);
    const stats = await fs.lstat(linkPath).catch(() => null);
    if (stats?.isSymbolicLink()) {
      await fs.remove(linkPath);
    }
  }
}

/**
 * 移除旧版 commands 根级 symlink
 * @param {string} agentCommandsDir - Agent commands 目录
 */
async function removeLegacyCommandLinks(agentCommandsDir) {
  const stats = await fs.lstat(agentCommandsDir).catch(() => null);
  if (stats?.isSymbolicLink()) {
    await fs.remove(agentCommandsDir);
  }
}

/**
 * 为 Agent 逐个链接 skill 条目（清理过期链接 + 创建新链接 + 更新 manifest）
 * @param {string} sourceRoot - 源根目录
 * @param {string} canonicalDir - canonical 目录
 * @param {string} agentSkillsDir - Agent skills 目录
 * @param {boolean} fallbackToCopy - 链接失败时是否回退到复制
 * @returns {Promise<{rootMode: string, entries: Object, removed: string[], count: number}>}
 */
async function linkSkillEntries(sourceRoot, canonicalDir, agentSkillsDir, fallbackToCopy = true) {
  const sourceSkillsDir = path.join(sourceRoot, SKILLS_DIR);
  const skillEntries = await getSkillEntries(sourceRoot);
  const skillNames = new Set(skillEntries.map(entry => entry.name));

  await ensureAgentSkillsRoot(agentSkillsDir, sourceSkillsDir);
  const removed = await removeStaleManagedSkillLinks(agentSkillsDir, skillNames, {
    sourceRoot,
    canonicalDir,
  });
  const links = {};

  for (const entry of skillEntries) {
    const linkPath = path.join(agentSkillsDir, entry.name);
    links[entry.name] = await createSymlink(entry.target, linkPath, fallbackToCopy);
  }

  await writeManagedSkillsManifest(agentSkillsDir, links);

  return {
    rootMode: 'directory',
    entries: links,
    removed,
    count: skillEntries.length,
  };
}

/**
 * 创建跨平台 symlink
 * Unix: 使用相对路径 symlink
 * Windows: 使用 junction（不需要管理员权限）
 * @param {string} target - 目标路径（被链接的实际目录）
 * @param {string} linkPath - 链接路径
 * @param {boolean} fallbackToCopy - 失败时是否回退到复制模式
 * @returns {Promise<{success: boolean, mode: 'symlink'|'junction'|'copy', error?: string}>}
 */
async function createSymlink(target, linkPath, fallbackToCopy = true) {
  const platform = os.platform();

  await fs.ensureDir(path.dirname(linkPath));

  const existingStats = await fs.lstat(linkPath).catch(() => null);
  if (existingStats) {
    try {
      if (existingStats.isSymbolicLink()) {
        const existingTarget = await fs.readlink(linkPath);
        const resolvedExisting = path.resolve(path.dirname(linkPath), existingTarget);
        const resolvedTarget = path.resolve(target);
        if (resolvedExisting === resolvedTarget) {
          return { success: true, mode: 'symlink', existed: true };
        }
      }
      await fs.remove(linkPath);
    } catch {
      await fs.remove(linkPath);
    }
  }

  try {
    if (platform === 'win32') {
      // Windows: 使用 junction（目录链接，不需要管理员权限）
      await fs.symlink(target, linkPath, 'junction');
      return { success: true, mode: 'junction' };
    } else {
      // Unix: 使用相对路径 symlink
      const relativeTarget = path.relative(path.dirname(linkPath), target);
      await fs.symlink(relativeTarget, linkPath);
      return { success: true, mode: 'symlink' };
    }
  } catch (err) {
    if (fallbackToCopy) {
      // 回退到复制模式
      try {
        await fs.copy(target, linkPath, { overwrite: true });
        return { success: true, mode: 'copy', warning: `Symlink failed, copied instead: ${err.message}` };
      } catch (copyErr) {
        return { success: false, mode: 'copy', error: copyErr.message };
      }
    }
    return { success: false, mode: 'symlink', error: err.message };
  }
}

/**
 * 复制模板到 canonical 位置
 * @param {string} templatesDir - 模板源目录
 * @param {string} canonicalDir - canonical 目标目录
 * @returns {Promise<{copied: string[]}>}
 */
async function installToCanonical(templatesDir, canonicalDir) {
  const results = { copied: [] };
  const packageRoot = getPackageSourceRoot(templatesDir);
  const canonicalPackageRoot = getCanonicalPackageRoot(canonicalDir);
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

  await fs.ensureDir(canonicalPackageRoot);

  for (const name of TEMPLATE_DIRS) {
    await removeDeletedManagedEntries(path.join(packageRoot, name), path.join(canonicalPackageRoot, name));
  }

  for (const file of TEMPLATE_FILES) {
    const dest = path.join(canonicalPackageRoot, file);
    const src = path.join(packageRoot, file);
    if (!(await fs.pathExists(src)) && (await fs.pathExists(dest))) {
      await fs.remove(dest);
    }
  }

  const copyFilter = src => !isManagedEntryIgnored(path.basename(src));

  for (const name of TEMPLATE_DIRS) {
    const src = path.join(packageRoot, name);
    const dest = path.join(canonicalPackageRoot, name);

    if (await fs.pathExists(src)) {
      await fs.remove(dest);
      const copyDirRecursive = async (srcDir, destDir) => {
        const entries = await fs.readdir(srcDir, { withFileTypes: true });
        await fs.ensureDir(destDir);

        for (const entry of entries) {
          if (isManagedEntryIgnored(entry.name)) {
            continue;
          }

          const srcPath = path.join(srcDir, entry.name);
          const destPath = path.join(destDir, entry.name);

          if (entry.isDirectory()) {
            await copyDirRecursive(srcPath, destPath);
            continue;
          }

          if (copyFilter(srcPath)) {
            await copyFileWithPathReplace(srcPath, destPath, claudeDir, canonicalDir);
          }
        }
      };

      await copyDirRecursive(src, dest);
      results.copied.push(name);
    }
  }

  for (const file of TEMPLATE_FILES) {
    const src = path.join(packageRoot, file);
    const dest = path.join(canonicalPackageRoot, file);

    if (await fs.pathExists(src)) {
      await copyFileWithPathReplace(src, dest, claudeDir, canonicalDir);
      results.copied.push(file);
    }
  }

  // Claude Code Plugin 元数据（v6.0.0 起）：
  // - core/.claude-plugin/plugin.json → <canonical>/core/.claude-plugin/plugin.json  （plugin 清单）
  // - <repo>/.claude-plugin/marketplace.json → <canonical>/.claude-plugin/marketplace.json  （marketplace 清单）
  // canonical 目录本身就是 Claude Code 的 plugin marketplace 根，
  // 用户通过 `claude plugin marketplace add <canonical>` 注册后即可装 Plugin。
  const pluginManifestSrc = path.join(packageRoot, '.claude-plugin', 'plugin.json');
  const pluginManifestDest = path.join(canonicalPackageRoot, '.claude-plugin', 'plugin.json');
  if (await fs.pathExists(pluginManifestSrc)) {
    await fs.ensureDir(path.dirname(pluginManifestDest));
    await fs.copy(pluginManifestSrc, pluginManifestDest, { overwrite: true });
    results.copied.push('.claude-plugin/plugin.json');
  }

  const marketplaceManifestSrc = path.join(templatesDir, '.claude-plugin', 'marketplace.json');
  const marketplaceManifestDest = path.join(canonicalDir, '.claude-plugin', 'marketplace.json');
  if (await fs.pathExists(marketplaceManifestSrc)) {
    await fs.ensureDir(path.dirname(marketplaceManifestDest));
    await fs.copy(marketplaceManifestSrc, marketplaceManifestDest, { overwrite: true });
    results.copied.push('marketplace.json');
  }

  return results;
}

/**
 * 为指定的 Agent 创建受管链接
 * @param {string} canonicalDir - canonical 目录
 * @param {string[]} agentNames - Agent 名称列表
 * @param {Object} options - 选项
 * @param {boolean} options.global - 是否为全局安装
 * @param {string} options.cwd - 当前工作目录
 * @param {boolean} options.fallbackToCopy - 失败时是否回退到复制
 * @returns {Promise<Object>} 每个 Agent 的安装结果
 */
async function linkToAgents(sourceRoot, agentNames, options = {}) {
  const {
    global = true,
    cwd = process.cwd(),
    fallbackToCopy = true,
    canonicalDir = sourceRoot,
    skillSourceRoot = sourceRoot,
  } = options;

  const results = {};

  for (const agentName of agentNames) {
    // Claude Code 从 v6.0.0 起通过 Claude Code Plugin 分发，不走 installer。
    // 上层 CLI（bin/agent-workflow.js）已经 partition 过滤掉 claude-code，
    // 这里加防御性跳过是避免其他调用者（如测试、postinstall）误传。
    if (agentName === 'claude-code') {
      results[agentName] = {
        success: false,
        error: 'claude-code 由 Plugin 分发管理，请通过 lib/claude-code-plugin.js 调用',
      };
      continue;
    }

    const agentConfig = agents[agentName];
    if (!agentConfig) {
      results[agentName] = { success: false, error: 'Unknown agent' };
      continue;
    }

    const agentBaseDir = getAgentBaseDir(agentName, global, cwd);
    const agentSkillsDir = getAgentSkillsDir(agentName, global, cwd);
    const agentCommandNamespaceDir = getAgentCommandNamespaceDir(agentName, global, cwd);
    const agentManagedDir = getAgentManagedDir(agentName, global, cwd);

    await fs.ensureDir(agentBaseDir);
    await removeLegacyDirectLinks(agentBaseDir);
    await removeLegacyCommandLinks(path.join(agentBaseDir, COMMANDS_DIR));

    const agentResult = {
      success: true,
      commands: { rootMode: 'directory', entries: {}, removed: [], count: 0 },
      managedDirs: {},
      skills: { rootMode: 'directory', entries: {}, removed: [], count: 0 },
    };

    agentResult.commands = await linkCommandEntries(sourceRoot, agentCommandNamespaceDir, fallbackToCopy);
    agentResult.managedDirs = await linkManagedDirs(sourceRoot, agentManagedDir, fallbackToCopy);
    agentResult.skills = await linkSkillEntries(skillSourceRoot, canonicalDir, agentSkillsDir, fallbackToCopy);

    for (const linkResult of Object.values(agentResult.commands.entries)) {
      if (!linkResult.success) {
        agentResult.success = false;
      }
    }

    for (const linkResult of Object.values(agentResult.managedDirs)) {
      if (!linkResult.success) {
        agentResult.success = false;
      }
    }

    for (const linkResult of Object.values(agentResult.skills.entries)) {
      if (!linkResult.success) {
        agentResult.success = false;
      }
    }

    results[agentName] = agentResult;
  }

  return results;
}


/**
 * 主安装函数 - 安装到多个 Agent
 * @param {Object} options - 安装选项
 * @param {string} options.templatesDir - 模板源目录
 * @param {string[]} options.agents - 目标 Agent 列表（默认检测已安装的）
 * @param {boolean} options.global - 是否为全局安装
 * @param {string} options.cwd - 当前工作目录
 * @param {boolean} options.fallbackToCopy - symlink 失败时是否回退到复制
 * @returns {Promise<Object>} 安装结果
 */
async function writeInstallationMeta({
  canonicalDir,
  global,
  cwd,
  result,
  mode,
  sourceRoot,
}) {
  const metaDir = path.join(canonicalDir, '.meta');
  await fs.ensureDir(metaDir);

  const normalizedMode = normalizeMetaMode(mode);
  const meta = {
    version: require('../package.json').version,
    installedAt: new Date().toISOString(),
    npmPackage: require('../package.json').name,
    canonicalDir,
    global,
    layoutVersion: 2,
    mode: normalizedMode,
    sourceRoot,
    agents: Object.fromEntries(
      Object.entries(result.agents).map(([name, agentResult]) => [
        name,
        {
          installed: agentResult.success,
          path: getAgentSkillsDir(name, global, cwd),
          skillsRoot: {
            path: getAgentSkillsDir(name, global, cwd),
            mode: agentResult.skills?.rootMode || 'directory',
          },
          skills: Object.fromEntries(
            Object.entries(agentResult.skills?.entries || {}).map(([skillName, skillResult]) => [
              skillName,
              {
                installed: skillResult.success,
                mode: skillResult.mode || 'unknown',
                path: path.join(getAgentSkillsDir(name, global, cwd), skillName),
              },
            ])
          ),
          commands: {
            path: getAgentCommandNamespaceDir(name, global, cwd),
            mode: agentResult.commands?.rootMode || 'directory',
          },
          managedRoot: {
            path: getAgentManagedDir(name, global, cwd),
            mode: 'directory',
          },
          commandEntries: Object.fromEntries(
            Object.entries(agentResult.commands?.entries || {}).map(([commandName, commandResult]) => [
              commandName,
              {
                installed: commandResult.success,
                mode: commandResult.mode || 'unknown',
                path: path.join(getAgentCommandNamespaceDir(name, global, cwd), commandName),
              },
            ])
          ),
          managedDirs: Object.fromEntries(
            Object.entries(agentResult.managedDirs || {}).map(([dirName, dirResult]) => [
              dirName,
              {
                installed: dirResult.success,
                mode: dirResult.mode || 'unknown',
                path: getAgentManagedSubdir(name, dirName, global, cwd),
              },
            ])
          ),
          removedSkills: agentResult.skills?.removed || [],
        },
      ])
    ),
    errors: result.errors,
  };

  await fs.writeJson(path.join(metaDir, 'meta.json'), meta, { spaces: 2 });
  result.meta = meta;
}

async function installForAgents(options = {}) {
  const {
    templatesDir,
    agents: targetAgents,
    global = true,
    cwd = process.cwd(),
    fallbackToCopy = true,
  } = options;

  let agentList = targetAgents;
  if (!agentList || agentList.length === 0) {
    agentList = detectInstalledAgents();
    if (agentList.length === 0) {
      agentList = ['claude-code'];
    }
  }

  const canonicalDir = getCanonicalDir(global, cwd);

  const canonicalPackageRoot = getCanonicalPackageRoot(canonicalDir);
  const result = {
    canonicalDir,
    agents: {},
    errors: [],
    mode: INSTALL_MODE_CANONICAL_COPY,
    sourceRoot: canonicalPackageRoot,
  };

  try {
    const copyResult = await installToCanonical(templatesDir, canonicalDir);
    result.canonical = copyResult;
  } catch (err) {
    result.errors.push(`Canonical install failed: ${err.message}`);
    return result;
  }

  try {
    result.agents = await linkToAgents(canonicalPackageRoot, agentList, {
      global,
      cwd,
      fallbackToCopy,
      canonicalDir,
    });
  } catch (err) {
    result.errors.push(`Agent linking failed: ${err.message}`);
  }

  try {
    await writeInstallationMeta({
      canonicalDir,
      global,
      cwd,
      result,
      mode: INSTALL_MODE_CANONICAL_COPY,
      sourceRoot: canonicalPackageRoot,
    });
  } catch (err) {
    result.errors.push(`Meta save failed: ${err.message}`);
  }

  return result;
}

async function linkRepoToAgents(options = {}) {
  const {
    templatesDir,
    agents: targetAgents,
    global = true,
    cwd = process.cwd(),
    fallbackToCopy = true,
  } = options;

  let agentList = targetAgents;
  if (!agentList || agentList.length === 0) {
    agentList = detectInstalledAgents();
    if (agentList.length === 0) {
      agentList = ['claude-code'];
    }
  }

  const canonicalDir = getCanonicalDir(global, cwd);
  const sourceRoot = getPackageSourceRoot(templatesDir);
  const canonicalPackageRoot = getCanonicalPackageRoot(canonicalDir);
  const result = {
    canonicalDir,
    agents: {},
    errors: [],
    mode: INSTALL_MODE_REPO_LINK,
    sourceRoot,
  };

  try {
    result.canonical = await installToCanonical(templatesDir, canonicalDir);
    result.agents = await linkToAgents(sourceRoot, agentList, {
      global,
      cwd,
      fallbackToCopy,
      canonicalDir,
      skillSourceRoot: canonicalPackageRoot,
    });
  } catch (err) {
    result.errors.push(`Agent linking failed: ${err.message}`);
  }

  try {
    await writeInstallationMeta({
      canonicalDir,
      global,
      cwd,
      result,
      mode: INSTALL_MODE_REPO_LINK,
      sourceRoot,
    });
  } catch (err) {
    result.errors.push(`Meta save failed: ${err.message}`);
  }

  return result;
}

/**
 * 从旧版安装迁移到新架构
 * @param {Object} options - 迁移选项
 * @param {string} options.claudeDir - 旧版 ~/.claude 目录
 * @param {string} options.templatesDir - 模板源目录
 * @param {boolean} options.global - 是否为全局安装
 * @returns {Promise<Object>} 迁移结果
 */
async function migrateFromLegacy(options = {}) {
  const { claudeDir, templatesDir, global = true } = options;
  const canonicalDir = getCanonicalDir(global);
  const backupDir = path.join(canonicalDir, '.meta', 'legacy-backup');

  const result = {
    migrated: false,
    backedUp: [],
    errors: [],
  };

  // 检查是否存在旧版安装
  const oldMetaFile = path.join(claudeDir, '.claude-workflow', 'meta.json');
  if (!(await fs.pathExists(oldMetaFile))) {
    result.migrated = false;
    result.reason = 'No legacy installation found';
    return result;
  }

  try {
    // 1. 备份旧版文件
    await fs.ensureDir(backupDir);
    for (const dir of TEMPLATE_DIRS) {
      const src = path.join(claudeDir, dir);
      if (await fs.pathExists(src)) {
        const stats = await fs.lstat(src);
        // 只备份非 symlink 的目录
        if (!stats.isSymbolicLink()) {
          await fs.copy(src, path.join(backupDir, dir), { overwrite: true });
          result.backedUp.push(dir);
        }
      }
    }

    // 2. 安装到新架构
    const installResult = await installForAgents({
      templatesDir,
      agents: ['claude-code'],
      global,
    });

    if (installResult.errors.length > 0) {
      result.errors.push(...installResult.errors);
    }

    // 3. 删除旧版目录（仅清理受管 direct-link 布局）
    for (const dir of [COMMANDS_DIR, ...MANAGED_DIRS, SKILLS_DIR]) {
      const oldDir = path.join(claudeDir, dir);
      const stats = await fs.lstat(oldDir).catch(() => null);
      if (stats && !stats.isSymbolicLink()) {
        await fs.remove(oldDir);
      }
    }

    result.migrated = true;
    result.installResult = installResult;
  } catch (err) {
    result.errors.push(`Migration failed: ${err.message}`);
  }

  return result;
}

/**
 * 获取安装状态
 * @param {boolean} global - 是否为全局安装
 * @param {string} cwd - 当前工作目录
 * @returns {Promise<Object>} 安装状态
 */
function detectAgentMode(agentStatus, installMode, sourceRoot) {
  if (!agentStatus.skillsRoot.valid && agentStatus.skillsRoot.mode === 'symlink') {
    return 'legacy-root-symlink';
  }

  if (installMode === INSTALL_MODE_REPO_LINK) {
    const repoLinked = [
      ...Object.values(agentStatus.skills),
      ...Object.values(agentStatus.commandEntries || {}),
      ...Object.values(agentStatus.managedDirs || {}),
    ].some(entry => entry.target && isManagedPath(entry.target, new Set([path.resolve(sourceRoot)])));

    if (repoLinked) {
      return INSTALL_MODE_REPO_LINK;
    }
  }

  if (
    Object.values(agentStatus.skills).some(skill => skill.mode === 'copy')
    || Object.values(agentStatus.commandEntries || {}).some(command => command.mode === 'copy')
    || Object.values(agentStatus.managedDirs || {}).some(dir => dir.mode === 'copy')
  ) {
    return 'mixed';
  }

  return 'granular';
}

async function getFallbackExpectedSkillNames(meta, global, cwd) {
  const expectedSkillNames = new Set();

  if (meta?.agents && typeof meta.agents === 'object') {
    for (const agentInfo of Object.values(meta.agents)) {
      for (const skillName of Object.keys(agentInfo?.skills || {})) {
        expectedSkillNames.add(skillName);
      }
    }
  }

  for (const agentName of Object.keys(agents)) {
    const agentSkillsDir = getAgentSkillsDir(agentName, global, cwd);
    const manifestEntries = await readManagedSkillsManifest(agentSkillsDir);
    for (const skillName of Object.keys(manifestEntries)) {
      expectedSkillNames.add(skillName);
    }
  }

  return Array.from(expectedSkillNames).sort();
}

async function getFallbackExpectedCommandNames(meta) {
  const expectedCommandNames = new Set();

  if (meta?.agents && typeof meta.agents === 'object') {
    for (const agentInfo of Object.values(meta.agents)) {
      for (const commandName of Object.keys(agentInfo?.commandEntries || {})) {
        expectedCommandNames.add(commandName);
      }
    }
  }

  return Array.from(expectedCommandNames).sort();
}

async function getInstallationStatus(global = true, cwd = process.cwd()) {
  const canonicalDir = getCanonicalDir(global, cwd);
  const metaFile = path.join(canonicalDir, '.meta', 'meta.json');

  const status = {
    installed: false,
    canonicalDir,
    version: null,
    mode: INSTALL_MODE_CANONICAL_COPY,
    sourceRoot: getCanonicalPackageRoot(canonicalDir),
    agents: {},
  };

  let meta = null;
  if (await fs.pathExists(metaFile)) {
    try {
      meta = await fs.readJson(metaFile);
      status.version = meta.version;
      status.installedAt = meta.installedAt;
      status.mode = normalizeMetaMode(meta.mode);
      status.sourceRoot = await normalizeSourceRoot(meta.sourceRoot, canonicalDir);
    } catch {}
  }

  const expectedRoot = status.sourceRoot;
  const expectedRootExists = await fs.pathExists(expectedRoot);
  const expectedSkillEntries = expectedRootExists
    ? await getSkillEntries(expectedRoot).catch(() => [])
    : [];
  const expectedCommandEntries = expectedRootExists
    ? await getCommandEntries(expectedRoot).catch(() => [])
    : [];
  const expectedSkillNames = expectedSkillEntries.length > 0
    ? expectedSkillEntries.map(entry => entry.name)
    : (
      status.mode === INSTALL_MODE_REPO_LINK
        ? await getFallbackExpectedSkillNames(meta, global, cwd)
        : []
    );
  const expectedCommandNames = expectedCommandEntries.length > 0
    ? expectedCommandEntries.map(entry => entry.name)
    : await getFallbackExpectedCommandNames(meta);

  if (await fs.pathExists(canonicalDir) || (status.mode === INSTALL_MODE_REPO_LINK && await fs.pathExists(status.sourceRoot))) {
    status.installed = true;

    for (const [name, config] of Object.entries(agents)) {
      // Plugin 机制管理的 agent（如 claude-code）不走 installer 路径，
      // 由调用方自行调用 lib/claude-code-plugin.js::inspectStatus 获取状态
      if (config.managedViaPlugin) {
        status.agents[name] = {
          detected: config.detectInstalled(),
          installed: false,
          managedViaPlugin: true,
          mode: 'plugin',
          valid: true,
          skills: {},
          commandEntries: {},
          managedDirs: {},
          skillCount: 0,
          brokenSkills: [],
          brokenCommands: [],
          managedDirIssues: [],
        };
        continue;
      }

      const skillsDir = global ? config.globalSkillsDir : path.join(cwd, config.skillsDir);
      const commandNamespaceDir = getAgentCommandNamespaceDir(name, global, cwd);
      const managedDir = getAgentManagedDir(name, global, cwd);
      const agentStatus = {
        detected: config.detectInstalled(),
        installed: false,
        mode: 'directory',
        valid: false,
        skillsRoot: {
          path: skillsDir,
          mode: null,
          valid: false,
        },
        commandsRoot: {
          path: commandNamespaceDir,
          mode: null,
          valid: false,
        },
        managedRoot: {
          path: managedDir,
          mode: null,
          valid: false,
        },
        skills: {},
        commandEntries: {},
        managedDirs: {},
        skillCount: 0,
        brokenSkills: [],
        brokenCommands: [],
        managedDirIssues: [],
      };

      if (await fs.pathExists(skillsDir)) {
        agentStatus.installed = true;
        try {
          const stats = await fs.lstat(skillsDir);
          if (stats.isDirectory() && !stats.isSymbolicLink()) {
            agentStatus.skillsRoot.mode = 'directory';
            agentStatus.skillsRoot.valid = true;
          } else if (stats.isSymbolicLink()) {
            const target = await fs.readlink(skillsDir);
            const resolvedTarget = path.resolve(path.dirname(skillsDir), target);
            agentStatus.skillsRoot.mode = 'symlink';
            agentStatus.skillsRoot.valid = await fs.pathExists(resolvedTarget);
            agentStatus.skillsRoot.target = resolvedTarget;
          } else {
            agentStatus.skillsRoot.mode = 'unknown';
          }
        } catch {}
      }

      const commandsRootState = await readLinkState(commandNamespaceDir);
      agentStatus.commandsRoot = {
        path: commandNamespaceDir,
        mode: commandsRootState.mode,
        valid: !commandsRootState.exists || commandsRootState.valid,
        target: commandsRootState.target,
      };

      const managedRootState = await readLinkState(managedDir);
      agentStatus.managedRoot = {
        path: managedDir,
        mode: managedRootState.mode,
        valid: !managedRootState.exists || managedRootState.valid,
        target: managedRootState.target,
      };

      for (const skillName of expectedSkillNames) {
        const skillPath = path.join(skillsDir, skillName);
        const skillState = await readLinkState(skillPath);
        agentStatus.skills[skillName] = {
          installed: skillState.exists,
          valid: skillState.valid,
          mode: skillState.mode || 'missing',
          path: skillPath,
          target: skillState.target,
        };
        if (skillState.exists) {
          agentStatus.skillCount += 1;
        }
        if (!skillState.valid) {
          agentStatus.brokenSkills.push(skillName);
        }
      }

      for (const commandName of expectedCommandNames) {
        const commandPath = path.join(commandNamespaceDir, commandName);
        const commandState = await readLinkState(commandPath);
        agentStatus.commandEntries[commandName] = {
          installed: commandState.exists,
          valid: commandState.valid,
          mode: commandState.mode || 'missing',
          path: commandPath,
          target: commandState.target,
        };
        if (!commandState.valid) {
          agentStatus.brokenCommands.push(commandName);
        }
      }

      for (const dirName of MANAGED_DIRS) {
        const dirPath = path.join(managedDir, dirName);
        const dirState = await readLinkState(dirPath);
        agentStatus.managedDirs[dirName] = {
          installed: dirState.exists,
          valid: dirState.valid,
          mode: dirState.mode || 'missing',
          path: dirPath,
          target: dirState.target,
        };
        if (!dirState.valid) {
          agentStatus.managedDirIssues.push(dirName);
        }
      }

      // Claude Code 迁移到 Plugin 后，hooks / subagent 状态由 lib/claude-code-plugin.js
      // 的 inspectStatus / detectLegacyResidue 负责；这里不再特殊处理

      agentStatus.valid = agentStatus.skillsRoot.valid
        && agentStatus.brokenSkills.length === 0
        && agentStatus.brokenCommands.length === 0
        && agentStatus.managedDirIssues.length === 0;

      agentStatus.mode = detectAgentMode(agentStatus, status.mode, status.sourceRoot);

      status.agents[name] = agentStatus;
    }
  }

  return status;
}

// Subagent 文件同步已迁移到 Claude Code Plugin (v6.0.0)
// Plugin 的 core/agents/ 目录由 Claude Code 原生加载，不再需要 installer 复制
