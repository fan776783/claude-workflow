/**
 * 旧版本迁移工具
 *
 * 将旧版 workflow-memory.json 迁移到新的 Plan/Run 存储结构
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeReadJson, atomicWriteJson, ensureDir } = require('./atomic-write');
const { WorkflowStorage } = require('./storage-manager');
const { generatePlanId, generateRunId } = require('./ulid');
const { computeContentHash } = require('./content-hash');
const { CURRENT_SCHEMA_VERSION } = require('./schema-migration');

/**
 * 迁移状态
 */
const MigrationStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

/**
 * 迁移报告
 */
class MigrationReport {
  constructor() {
    this.startedAt = new Date().toISOString();
    this.completedAt = null;
    this.status = MigrationStatus.PENDING;
    this.projectsMigrated = 0;
    this.plansMigrated = 0;
    this.runsMigrated = 0;
    this.errors = [];
    this.warnings = [];
    this.details = [];
  }

  addError(message, context = {}) {
    this.errors.push({ message, context, timestamp: new Date().toISOString() });
  }

  addWarning(message, context = {}) {
    this.warnings.push({ message, context, timestamp: new Date().toISOString() });
  }

  addDetail(message, context = {}) {
    this.details.push({ message, context, timestamp: new Date().toISOString() });
  }

  complete(status = MigrationStatus.COMPLETED) {
    this.completedAt = new Date().toISOString();
    this.status = status;
  }

  toJSON() {
    return {
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      status: this.status,
      summary: {
        projectsMigrated: this.projectsMigrated,
        plansMigrated: this.plansMigrated,
        runsMigrated: this.runsMigrated,
        errorCount: this.errors.length,
        warningCount: this.warnings.length
      },
      errors: this.errors,
      warnings: this.warnings,
      details: this.details
    };
  }
}

/**
 * 旧版本迁移器
 */
class LegacyMigrator {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.backupDir = options.backupDir || path.join(os.homedir(), '.claude', '.migration-backups');
    this.report = new MigrationReport();
  }

  /**
   * 执行完整迁移
   * @returns {Promise<MigrationReport>}
   */
  async migrate() {
    this.report.status = MigrationStatus.IN_PROGRESS;

    try {
      // 1. 扫描所有项目
      const projects = await this.scanProjects();
      this.report.addDetail(`Found ${projects.length} projects to migrate`);

      // 2. 备份
      if (!this.dryRun) {
        await this.createBackup(projects);
      }

      // 3. 迁移每个项目
      for (const project of projects) {
        await this.migrateProject(project);
      }

      this.report.complete(
        this.report.errors.length > 0 ? MigrationStatus.FAILED : MigrationStatus.COMPLETED
      );
    } catch (error) {
      this.report.addError('Migration failed', { error: error.message });
      this.report.complete(MigrationStatus.FAILED);
    }

    return this.report;
  }

  /**
   * 扫描所有项目
   * @returns {Promise<object[]>}
   */
  async scanProjects() {
    const workflowsDir = path.join(os.homedir(), '.claude', 'workflows');
    const projects = [];

    try {
      const entries = await fs.promises.readdir(workflowsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const projectDir = path.join(workflowsDir, entry.name);
        const memoryPath = path.join(projectDir, 'workflow-memory.json');

        // 检查是否有旧版 workflow-memory.json
        try {
          await fs.promises.access(memoryPath);
          const memory = await safeReadJson(memoryPath);

          if (memory && !memory.schemaVersion) {
            // 旧版格式
            projects.push({
              projectId: entry.name,
              projectDir,
              memoryPath,
              memory
            });
          }
        } catch {
          // 忽略
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.report.addWarning('Failed to scan workflows directory', { error: error.message });
      }
    }

    return projects;
  }

  /**
   * 创建备份
   * @param {object[]} projects 项目列表
   */
  async createBackup(projects) {
    const timestamp = Date.now();
    const backupPath = path.join(this.backupDir, `backup-${timestamp}`);

    await ensureDir(backupPath);

    for (const project of projects) {
      const projectBackup = path.join(backupPath, project.projectId);
      await ensureDir(projectBackup);

      // 复制 workflow-memory.json
      await fs.promises.copyFile(
        project.memoryPath,
        path.join(projectBackup, 'workflow-memory.json')
      );

      // 复制其他相关文件
      const filesToBackup = [
        'context-summary-*.md',
        'tech-design/*.md',
        'verification-report-*.md'
      ];

      for (const pattern of filesToBackup) {
        try {
          const files = await this.globFiles(project.projectDir, pattern);
          for (const file of files) {
            const relativePath = path.relative(project.projectDir, file);
            const destPath = path.join(projectBackup, relativePath);
            await ensureDir(path.dirname(destPath));
            await fs.promises.copyFile(file, destPath);
          }
        } catch {
          // 忽略
        }
      }
    }

    this.report.addDetail(`Backup created at ${backupPath}`);
  }

  /**
   * 迁移单个项目
   * @param {object} project 项目信息
   */
  async migrateProject(project) {
    try {
      this.report.addDetail(`Migrating project: ${project.projectId}`);

      const storage = new WorkflowStorage(project.projectDir);

      if (!this.dryRun) {
        await storage.init();
      }

      // 迁移 workflow-memory.json 到 Run
      const run = await this.migrateWorkflowMemory(project, storage);

      // 如果有技术方案，迁移到 Plan
      const plan = await this.migrateTechDesign(project, storage);

      // 关联 Run 和 Plan
      if (run && plan && !this.dryRun) {
        await storage.runs.updateRun(run.runId, { planId: plan.planId });
      }

      this.report.projectsMigrated++;
    } catch (error) {
      this.report.addError(`Failed to migrate project: ${project.projectId}`, {
        error: error.message
      });
    }
  }

  /**
   * 迁移 workflow-memory.json
   * @param {object} project 项目信息
   * @param {WorkflowStorage} storage 存储管理器
   * @returns {Promise<object|null>}
   */
  async migrateWorkflowMemory(project, storage) {
    const memory = project.memory;

    if (!memory) return null;

    // 转换为新格式
    const run = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      runId: generateRunId(),
      planId: '',
      planVersionAtStart: 1,
      task: {
        name: memory.task_name || memory.taskName || '',
        description: memory.description || '',
        complexity: memory.complexity || 'medium'
      },
      enhancement: memory.enhancement || {},
      steps: (memory.steps || []).map((step, index) => ({
        id: step.id || index + 1,
        name: step.name || '',
        action: step.action || '',
        status: step.status || 'pending',
        qualityGate: step.quality_gate || step.qualityGate || false,
        threshold: step.threshold,
        actualScore: step.actual_score || step.actualScore
      })),
      currentStepId: memory.current_step_id || memory.currentStepId || 0,
      totalSteps: memory.total_steps || memory.totalSteps || 0,
      decisions: memory.decisions || [],
      qualityGatesBypassed: memory.quality_gates_bypassed || memory.qualityGatesBypassed || [],
      artifacts: memory.artifacts || {},
      status: memory.status || 'pending',
      startedAt: memory.started_at || memory.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: memory.completed_at || memory.completedAt
    };

    if (!this.dryRun) {
      const runPath = path.join(storage.runs.runsDir, `${run.runId}.json`);
      await atomicWriteJson(runPath, run);
      await storage.runs.setCurrentRun(run.runId);
    }

    this.report.runsMigrated++;
    this.report.addDetail(`Migrated run: ${run.runId}`, { taskName: run.task.name });

    return run;
  }

  /**
   * 迁移技术方案
   * @param {object} project 项目信息
   * @param {WorkflowStorage} storage 存储管理器
   * @returns {Promise<object|null>}
   */
  async migrateTechDesign(project, storage) {
    const techDesignDir = path.join(project.projectDir, 'tech-design');

    try {
      const files = await fs.promises.readdir(techDesignDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      if (mdFiles.length === 0) return null;

      // 取最新的技术方案
      const latestFile = mdFiles.sort().pop();
      const content = await fs.promises.readFile(
        path.join(techDesignDir, latestFile),
        'utf8'
      );

      // 创建 Plan
      const planId = generatePlanId();
      const plan = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        planId,
        slug: latestFile.replace('.md', ''),
        displayName: this.extractTitle(content) || latestFile,
        description: '',
        currentVersion: 1,
        stablePath: '',
        versions: [{
          versionId: 1,
          path: 'v1.md',
          contentHash: computeContentHash(content),
          status: 'approved',
          author: 'migration',
          createdAt: new Date().toISOString(),
          summary: 'Migrated from legacy format'
        }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (!this.dryRun) {
        const planDir = path.join(storage.plans.plansDir, planId);
        await ensureDir(planDir);
        await ensureDir(path.join(planDir, 'diffs'));
        await atomicWriteJson(path.join(planDir, 'meta.json'), plan);
        await fs.promises.writeFile(path.join(planDir, 'v1.md'), content);
        await storage.plans.updateIndex(planId, plan);
      }

      this.report.plansMigrated++;
      this.report.addDetail(`Migrated plan: ${planId}`, { displayName: plan.displayName });

      return plan;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.report.addWarning('Failed to migrate tech design', { error: error.message });
      }
      return null;
    }
  }

  /**
   * 从内容中提取标题
   * @param {string} content Markdown 内容
   * @returns {string|null}
   */
  extractTitle(content) {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /**
   * 简单的 glob 实现
   * @param {string} dir 目录
   * @param {string} pattern 模式
   * @returns {Promise<string[]>}
   */
  async globFiles(dir, pattern) {
    const files = [];
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );

    const walk = async (currentDir) => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(dir, fullPath);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (regex.test(relativePath) || regex.test(entry.name)) {
          files.push(fullPath);
        }
      }
    };

    await walk(dir);
    return files;
  }

  /**
   * 验证迁移结果
   * @returns {Promise<object>}
   */
  async verify() {
    const results = {
      valid: true,
      checks: []
    };

    const workflowsDir = path.join(os.homedir(), '.claude', 'workflows');

    try {
      const entries = await fs.promises.readdir(workflowsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const projectDir = path.join(workflowsDir, entry.name);

        // 检查 plans 目录
        const plansDir = path.join(projectDir, 'plans');
        try {
          await fs.promises.access(plansDir);
          results.checks.push({ project: entry.name, check: 'plans_dir', status: 'ok' });
        } catch {
          results.checks.push({ project: entry.name, check: 'plans_dir', status: 'missing' });
        }

        // 检查 runs 目录
        const runsDir = path.join(projectDir, 'runs');
        try {
          await fs.promises.access(runsDir);
          results.checks.push({ project: entry.name, check: 'runs_dir', status: 'ok' });
        } catch {
          results.checks.push({ project: entry.name, check: 'runs_dir', status: 'missing' });
        }

        // 检查 index.json
        const indexPath = path.join(plansDir, 'index.json');
        try {
          const index = await safeReadJson(indexPath);
          if (index && index.schemaVersion) {
            results.checks.push({ project: entry.name, check: 'index', status: 'ok' });
          } else {
            results.checks.push({ project: entry.name, check: 'index', status: 'invalid' });
            results.valid = false;
          }
        } catch {
          results.checks.push({ project: entry.name, check: 'index', status: 'missing' });
        }
      }
    } catch (error) {
      results.valid = false;
      results.error = error.message;
    }

    return results;
  }
}

/**
 * 执行迁移
 * @param {object} options 选项
 * @returns {Promise<MigrationReport>}
 */
async function runMigration(options = {}) {
  const migrator = new LegacyMigrator(options);
  return migrator.migrate();
}

/**
 * 验证迁移
 * @returns {Promise<object>}
 */
async function verifyMigration() {
  const migrator = new LegacyMigrator({ dryRun: true });
  return migrator.verify();
}

module.exports = {
  MigrationStatus,
  MigrationReport,
  LegacyMigrator,
  runMigration,
  verifyMigration
};
