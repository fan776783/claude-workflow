const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');

const {
  agents,
  detectInstalledAgents,
  getCanonicalDir,
  getAgentBaseDir,
  getAgentDirPath,
  getAgentSkillsDir,
  getAllAgentNames,
  parseAgentArg,
} = require('./agents');

const TEMPLATE_DIRS = ['commands', 'utils', 'prompts', 'skills', 'specs', 'project', 'hooks'];
const TEMPLATE_FILES = ['CLAUDE.md'];
const DIRECT_LINK_DIRS = ['commands', 'prompts', 'utils', 'specs', 'hooks'];
const SKILLS_DIR = 'skills';
const CANONICAL_DIR_NAME = 'agent-workflow';
const LOG_PREFIX = '[agent-workflow]';

// 文本文件扩展名（需要进行路径替换）
const TEXT_EXTENSIONS = ['.md', '.txt', '.json', '.yaml', '.yml', '.sh', '.js', '.ts'];

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
  const srcNames = new Set(srcEntries.map(entry => entry.name));

  for (const entry of destEntries) {
    const destPath = path.join(destDir, entry.name);
    const srcPath = path.join(srcDir, entry.name);

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

  console.log(`${LOG_PREFIX} 首次安装完成`);
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
  console.log(`${LOG_PREFIX} 已备份到: ${backupDir}`);

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
  DIRECT_LINK_DIRS,
  SKILLS_DIR,
  createSymlink,
  installToCanonical,
  linkToAgents,
  installForAgents,
  migrateFromLegacy,
  getInstallationStatus,
  ensureWorktreeHooks,
};

// ============================================
// 多 Agent 支持函数
// ============================================

function getCanonicalSkillsDir(canonicalDir) {
  return path.join(canonicalDir, SKILLS_DIR);
}

async function getCanonicalSkillEntries(canonicalDir) {
  const canonicalSkillsDir = getCanonicalSkillsDir(canonicalDir);
  if (!(await fs.pathExists(canonicalSkillsDir))) {
    return [];
  }

  const entries = await fs.readdir(canonicalSkillsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      target: path.join(canonicalSkillsDir, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

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

async function readLinkState(linkPath) {
  if (!(await fs.pathExists(linkPath))) {
    return { exists: false, valid: false, mode: null };
  }

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
  } catch {
    return { exists: true, valid: false, mode: 'unknown', target: linkPath };
  }
}

async function linkNonSkillDirs(canonicalDir, agentBaseDir, fallbackToCopy = true) {
  const links = {};

  for (const dirName of DIRECT_LINK_DIRS) {
    const target = path.join(canonicalDir, dirName);
    const linkPath = path.join(agentBaseDir, dirName);

    if (await fs.pathExists(target)) {
      links[dirName] = await createSymlink(target, linkPath, fallbackToCopy);
    }
  }

  return links;
}

async function removeStaleManagedSkillLinks(agentSkillsDir, canonicalSkillNames) {
  if (!(await fs.pathExists(agentSkillsDir))) {
    return [];
  }

  const removed = [];
  const entries = await fs.readdir(agentSkillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!canonicalSkillNames.has(entry.name)) {
      const entryPath = path.join(agentSkillsDir, entry.name);
      const stats = await fs.lstat(entryPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await fs.readlink(entryPath);
        const resolvedTarget = path.resolve(path.dirname(entryPath), existingTarget);
        if (resolvedTarget.includes(`${path.sep}.agents${path.sep}${CANONICAL_DIR_NAME}${path.sep}${SKILLS_DIR}${path.sep}`)) {
          await fs.remove(entryPath);
          removed.push(entry.name);
        }
      }
    }
  }

  return removed;
}

async function linkSkillEntries(canonicalDir, agentSkillsDir, fallbackToCopy = true) {
  const canonicalSkillsDir = getCanonicalSkillsDir(canonicalDir);
  const skillEntries = await getCanonicalSkillEntries(canonicalDir);
  const canonicalSkillNames = new Set(skillEntries.map(entry => entry.name));

  await ensureAgentSkillsRoot(agentSkillsDir, canonicalSkillsDir);
  const removed = await removeStaleManagedSkillLinks(agentSkillsDir, canonicalSkillNames);
  const links = {};

  for (const entry of skillEntries) {
    const linkPath = path.join(agentSkillsDir, entry.name);
    links[entry.name] = await createSymlink(entry.target, linkPath, fallbackToCopy);
  }

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

  // 确保父目录存在
  await fs.ensureDir(path.dirname(linkPath));

  // 如果链接已存在，先检查是否指向正确目标
  if (await fs.pathExists(linkPath)) {
    try {
      const stats = await fs.lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await fs.readlink(linkPath);
        const resolvedExisting = path.resolve(path.dirname(linkPath), existingTarget);
        const resolvedTarget = path.resolve(target);
        if (resolvedExisting === resolvedTarget) {
          return { success: true, mode: 'symlink', existed: true };
        }
      }
      // 目标不同或不是 symlink，删除后重建
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

  await fs.ensureDir(canonicalDir);

  for (const name of TEMPLATE_DIRS) {
    await removeDeletedManagedEntries(path.join(templatesDir, name), path.join(canonicalDir, name));
  }

  for (const file of TEMPLATE_FILES) {
    const dest = path.join(canonicalDir, file);
    const src = path.join(templatesDir, file);
    if (!(await fs.pathExists(src)) && (await fs.pathExists(dest))) {
      await fs.remove(dest);
    }
  }

  for (const name of TEMPLATE_DIRS) {
    const src = path.join(templatesDir, name);
    const dest = path.join(canonicalDir, name);

    if (await fs.pathExists(src)) {
      await fs.remove(dest);
      await fs.copy(src, dest, { overwrite: true });
      results.copied.push(name);
    }
  }

  for (const file of TEMPLATE_FILES) {
    const src = path.join(templatesDir, file);
    const dest = path.join(canonicalDir, file);

    if (await fs.pathExists(src)) {
      await fs.copy(src, dest, { overwrite: true });
      results.copied.push(file);
    }
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
async function linkToAgents(canonicalDir, agentNames, options = {}) {
  const { global = true, cwd = process.cwd(), fallbackToCopy = true } = options;
  const results = {};

  for (const agentName of agentNames) {
    const agentConfig = agents[agentName];
    if (!agentConfig) {
      results[agentName] = { success: false, error: 'Unknown agent' };
      continue;
    }

    const agentBaseDir = getAgentBaseDir(agentName, global, cwd);
    const agentSkillsDir = getAgentSkillsDir(agentName, global, cwd);

    await fs.ensureDir(agentBaseDir);

    const agentResult = {
      success: true,
      links: {},
      skills: { rootMode: 'directory', entries: {}, removed: [], count: 0 },
    };

    agentResult.links = await linkNonSkillDirs(canonicalDir, agentBaseDir, fallbackToCopy);
    agentResult.skills = await linkSkillEntries(canonicalDir, agentSkillsDir, fallbackToCopy);

    for (const linkResult of Object.values(agentResult.links)) {
      if (!linkResult.success) {
        agentResult.success = false;
      }
    }

    for (const linkResult of Object.values(agentResult.skills.entries)) {
      if (!linkResult.success) {
        agentResult.success = false;
      }
    }

    if (agentName === 'claude-code') {
      const claudeMdSrc = path.join(canonicalDir, 'CLAUDE.md');
      const claudeMdDest = path.join(agentBaseDir, 'CLAUDE.md');
      if (await fs.pathExists(claudeMdSrc)) {
        if (!(await fs.pathExists(claudeMdDest))) {
          await fs.copy(claudeMdSrc, claudeMdDest);
          agentResult.claudeMd = 'copied';
        } else {
          agentResult.claudeMd = 'exists';
        }
      }

      // 自动注入 worktree 串行化 hooks 到 settings.json（仅全局安装）
      if (global) {
        try {
          const hooksDir = path.join(agentBaseDir, 'hooks');
          const settingsPath = path.join(path.dirname(agentBaseDir), 'settings.json');
          const hookResult = await ensureWorktreeHooks(settingsPath, hooksDir);
          agentResult.worktreeHooks = hookResult;
        } catch (err) {
          agentResult.worktreeHooks = { injected: false, error: err.message };
        }
      } else {
        agentResult.worktreeHooks = {
          injected: false,
          events: [],
          skipped: ['project-level install skips worktree hook injection'],
        };
      }
    }

    results[agentName] = agentResult;
  }

  return results;
}

// ============================================
// Worktree Hooks 自动注入
// ============================================

/**
 * Hook 事件配置定义
 */
const WORKTREE_HOOK_DEFS = {
  WorktreeCreate: {
    script: 'worktree-serialize.js',
    description: '串行化 worktree 创建，防止 .git/config.lock 竞争',
  },
  WorktreeRemove: {
    script: 'worktree-cleanup.js',
    description: '清理 worktree 并释放串行化锁',
  },
};

/**
 * 确保 worktree 串行化 hooks 已注册到 settings.json。
 *
 * 采用保守合并策略：只添加不存在的 hook，不修改用户已有配置。
 *
 * @param {string} settingsPath - settings.json 的绝对路径
 * @param {string} hooksDir - hook 脚本所在目录的绝对路径
 * @returns {Promise<{injected: boolean, events: string[], skipped: string[]}>}
 */
async function ensureWorktreeHooks(settingsPath, hooksDir) {
  const result = { injected: false, events: [], skipped: [] };

  // 读取现有 settings（如果不存在则创建空配置）
  let settings = {};
  if (await fs.pathExists(settingsPath)) {
    try {
      settings = await fs.readJson(settingsPath);
    } catch {
      // JSON 解析失败，不修改文件
      result.skipped.push('settings.json 解析失败');
      return result;
    }
  }

  // 确保 hooks 对象存在
  if (!settings.hooks) {
    settings.hooks = {};
  }

  let modified = false;

  for (const [eventName, hookDef] of Object.entries(WORKTREE_HOOK_DEFS)) {
    // 检查 hook 脚本是否存在
    const scriptPath = path.join(hooksDir, hookDef.script);
    let resolvedScriptPath = scriptPath;

    // 如果 hooksDir 是 symlink，解析到实际路径
    try {
      const stats = await fs.lstat(hooksDir);
      if (stats.isSymbolicLink()) {
        const realHooksDir = await fs.realpath(hooksDir);
        resolvedScriptPath = path.join(realHooksDir, hookDef.script);
      }
    } catch {
      // 忽略，使用原始路径
    }

    if (!(await fs.pathExists(resolvedScriptPath))) {
      result.skipped.push(`${eventName}: 脚本不存在 (${hookDef.script})`);
      continue;
    }

    // 检查是否已有该事件的 hook 配置
    const existingHooks = settings.hooks[eventName];
    if (existingHooks && Array.isArray(existingHooks) && existingHooks.length > 0) {
      // 检查是否已经包含我们的 hook
      const alreadyRegistered = existingHooks.some(hookEntry => {
        // 支持新格式 { hooks: [{ type, command }] } 和旧格式 { type, command }
        const commands = hookEntry.hooks
          ? hookEntry.hooks.map(h => h.command || '')
          : [hookEntry.command || ''];
        return commands.some(cmd => cmd.includes(hookDef.script));
      });

      if (alreadyRegistered) {
        result.skipped.push(`${eventName}: 已注册`);
        continue;
      }
    }

    // 构建 hook command（使用相对于 ~ 的路径）
    const userHome = os.homedir();
    let commandPath = scriptPath;
    if (scriptPath.startsWith(userHome)) {
      commandPath = scriptPath.replace(userHome, '~');
    }

    // 注入 hook 配置
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = [];
    }

    settings.hooks[eventName].push({
      hooks: [{
        type: 'command',
        command: `node "${commandPath}"`,
      }],
    });

    result.events.push(eventName);
    modified = true;
  }

  // 写回文件
  if (modified) {
    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeJson(settingsPath, settings, { spaces: 2 });
    result.injected = true;
    console.log(`${LOG_PREFIX} 已注入 worktree hooks: ${result.events.join(', ')}`);
  }

  return result;
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
  const metaDir = path.join(canonicalDir, '.meta');

  const result = {
    canonicalDir,
    agents: {},
    errors: [],
  };

  try {
    const copyResult = await installToCanonical(templatesDir, canonicalDir);
    result.canonical = copyResult;
  } catch (err) {
    result.errors.push(`Canonical install failed: ${err.message}`);
    return result;
  }

  try {
    result.agents = await linkToAgents(canonicalDir, agentList, {
      global,
      cwd,
      fallbackToCopy,
    });
  } catch (err) {
    result.errors.push(`Agent linking failed: ${err.message}`);
  }

  try {
    await fs.ensureDir(metaDir);
    const meta = {
      version: require('../package.json').version,
      installedAt: new Date().toISOString(),
      npmPackage: require('../package.json').name,
      canonicalDir,
      global,
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
            nonSkillDirs: Object.fromEntries(
              Object.entries(agentResult.links || {}).map(([dirName, dirResult]) => [
                dirName,
                {
                  installed: dirResult.success,
                  mode: dirResult.mode || 'unknown',
                  path: getAgentDirPath(name, dirName, global, cwd),
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

    // 3. 删除旧版目录（已被逐项挂载替换）
    for (const dir of [...DIRECT_LINK_DIRS, SKILLS_DIR]) {
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
async function getInstallationStatus(global = true, cwd = process.cwd()) {
  const canonicalDir = getCanonicalDir(global, cwd);
  const metaFile = path.join(canonicalDir, '.meta', 'meta.json');
  const canonicalSkillEntries = await getCanonicalSkillEntries(canonicalDir).catch(() => []);
  const canonicalSkillNames = canonicalSkillEntries.map(entry => entry.name);

  const status = {
    installed: false,
    canonicalDir,
    version: null,
    agents: {},
  };

  if (await fs.pathExists(canonicalDir)) {
    status.installed = true;

    if (await fs.pathExists(metaFile)) {
      try {
        const meta = await fs.readJson(metaFile);
        status.version = meta.version;
        status.installedAt = meta.installedAt;
      } catch {}
    }

    for (const [name, config] of Object.entries(agents)) {
      const skillsDir = global ? config.globalSkillsDir : path.join(cwd, config.skillsDir);
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
        skills: {},
        skillCount: 0,
        brokenSkills: [],
        nonSkillDirs: {},
        nonSkillDirIssues: [],
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

      for (const skillName of canonicalSkillNames) {
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

      for (const dirName of DIRECT_LINK_DIRS) {
        const dirPath = getAgentDirPath(name, dirName, global, cwd);
        const dirState = await readLinkState(dirPath);
        agentStatus.nonSkillDirs[dirName] = {
          installed: dirState.exists,
          valid: dirState.valid,
          mode: dirState.mode || 'missing',
          path: dirPath,
          target: dirState.target,
        };
        if (!dirState.valid) {
          agentStatus.nonSkillDirIssues.push(dirName);
        }
      }

      agentStatus.valid = agentStatus.skillsRoot.valid
        && agentStatus.brokenSkills.length === 0
        && agentStatus.nonSkillDirIssues.length === 0;

      if (!agentStatus.skillsRoot.valid && agentStatus.skillsRoot.mode === 'symlink') {
        agentStatus.mode = 'legacy-root-symlink';
      } else if (Object.values(agentStatus.skills).some(skill => skill.mode === 'copy')) {
        agentStatus.mode = 'mixed';
      } else {
        agentStatus.mode = 'granular';
      }

      status.agents[name] = agentStatus;
    }
  }

  return status;
}
