#!/usr/bin/env node

// Codex App Server 桥接脚本
// 通过 JSON-RPC 流式协议与 `codex app-server` 通信，
// 使用事件驱动的 turn 完成模型（非轮询/延迟），正确等待 turn/completed 通知。
//
// 命令模式：
//   task                  → turn/start（通用任务）
//   --review <target>     → review/start（内置 reviewer，不接受 --prompt）
//   --adversarial-review <target> → turn/start + adversarial prompt 模板

import { spawn } from "node:child_process";
import readline from "node:readline";
import process from "node:process";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 脚本所在目录（用于定位 prompts/adversarial-review.md）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");

// ─── CLI 参数解析 ───────────────────────────────────────────────

const args = process.argv.slice(2);
let command = "task"; // task | review | adversarial-review
const options = {
  prompt: "",
  cd: process.cwd(),
  sessionId: null,
  review: null,
  adversarialReview: null,
  readOnly: false,
  background: false,
  status: null,
  cancel: null,
  internalJobId: null,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "task") {
    command = "task";
  } else if (arg === "--prompt") {
    options.prompt = args[++i] ?? "";
  } else if (arg === "--cd") {
    options.cd = args[++i] ?? process.cwd();
  } else if (arg === "--session-id") {
    options.sessionId = args[++i] ?? null;
  } else if (arg === "--review") {
    command = "review";
    options.review = args[++i] ?? "working-tree";
  } else if (arg === "--adversarial-review") {
    command = "adversarial-review";
    options.adversarialReview = args[++i] ?? "working-tree";
  } else if (arg === "--read-only") {
    options.readOnly = true;
  } else if (arg === "--background") {
    options.background = true;
  } else if (arg === "--status") {
    options.status = args[++i];
  } else if (arg === "--cancel") {
    options.cancel = args[++i];
  } else if (arg === "--internal-job-id") {
    options.internalJobId = args[++i];
  }
}

// ─── Background Job 基础设施 ──────────────────────────────────

// 终态集合：一旦进入这些状态，不允许被覆盖
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

// 基于 --cd 指定的工作区目录，确保跨目录调用一致性
const JOBS_DIR = path.join(options.cd, ".claude", "tmp", "codex-jobs");

async function ensureJobsDir() {
  try {
    await fs.mkdir(JOBS_DIR, { recursive: true });
  } catch (_) {}
}

async function readJobFile(jobId) {
  const jobFile = path.join(JOBS_DIR, `${jobId}.json`);
  const raw = await fs.readFile(jobFile, "utf8");
  return JSON.parse(raw);
}

async function writeJobFile(jobId, data) {
  await ensureJobsDir();
  const jobFile = path.join(JOBS_DIR, `${jobId}.json`);
  await fs.writeFile(jobFile, JSON.stringify(data, null, 2));
}

async function updateJobState(patch) {
  if (!options.internalJobId) return;
  try {
    let data = {};
    try {
      data = await readJobFile(options.internalJobId);
    } catch (_) {}
    // 终态保护：如果 job 已处于终态，拒绝任何状态覆盖
    if (TERMINAL_STATES.has(data.status)) return;
    const updated = { ...data, ...patch, updatedAt: new Date().toISOString() };
    await writeJobFile(options.internalJobId, updated);
  } catch (_) {}
}

// ─── 进度输出工具 ──────────────────────────────────────────────

function emitProgress(msg, phase) {
  if (!msg) return;
  if (!options.internalJobId) {
    process.stderr.write(`\n[Codex 进展] ${msg}`);
  } else {
    updateJobState({ phase, currentStep: msg });
  }
}

// ─── CLI 参数校验 ──────────────────────────────────────────────

function exitWithError(message) {
  console.log(JSON.stringify({ success: false, error: message }));
  process.exit(1);
}

// task 模式必须提供 prompt（除非是 --status/--cancel/--background 查询类操作）
if (
  command === "task" &&
  !options.status &&
  !options.cancel &&
  !options.prompt &&
  !options.internalJobId
) {
  exitWithError("--prompt is required for task mode.");
}

// review 模式不允许传 --prompt（应使用 --adversarial-review）
if (command === "review" && options.prompt) {
  exitWithError(
    "--review does not accept --prompt (the built-in reviewer has no custom focus)." +
    " Use --adversarial-review <target> --prompt \"focus\" instead."
  );
}

// adversarial-review 模式建议传 --prompt 但不强制
// review 模式不允许 --session-id（review 必须隔离）
if (command === "review" && options.sessionId) {
  exitWithError("--review does not support --session-id. Reviews always use a fresh read-only thread.");
}
if (command === "adversarial-review" && options.sessionId) {
  exitWithError("--adversarial-review does not support --session-id. Reviews always use a fresh read-only thread.");
}

// ─── --status 短路 ─────────────────────────────────────────────

if (options.status) {
  try {
    const data = await fs.readFile(path.join(JOBS_DIR, `${options.status}.json`), "utf8");
    console.log(data);
  } catch (_) {
    console.log(JSON.stringify({ success: false, error: `Job ${options.status} not found.` }));
    process.exit(1);
  }
  process.exit(0);
}

// ─── --cancel 短路 ─────────────────────────────────────────────
// 修复：不再尝试 spawn 新的 app-server 进程（无法命中正在运行的实例），
// 而是通过 worker PID 直接终止 background 进程。

if (options.cancel) {
  // 校验 --cd 指向有效的 jobs 目录，防止使用默认 cwd 导致找不到 job
  try {
    await fs.access(JOBS_DIR);
  } catch (_) {
    exitWithError(`Jobs directory not found at ${JOBS_DIR}. Did you forget --cd?`);
  }
  try {
    const jobData = await readJobFile(options.cancel);

    if (jobData.status !== "running") {
      console.log(JSON.stringify({
        success: false,
        error: `Job ${options.cancel} is not running (status: ${jobData.status}).`,
      }));
      process.exit(0);
    }

    // 标记 job 为 cancelled
    jobData.status = "cancelled";
    jobData.phase = "cancelled";
    jobData.completedAt = new Date().toISOString();
    await writeJobFile(options.cancel, jobData);

    // 通过 worker PID 终止 background 进程树
    if (jobData.workerPid) {
      try {
        // 发送 SIGTERM 让 worker 优雅退出，其 finally 块会关闭 app-server
        process.kill(jobData.workerPid, "SIGTERM");
        console.log(JSON.stringify({
          success: true,
          message: `Job ${options.cancel} cancelled and worker process ${jobData.workerPid} terminated.`,
        }));
      } catch (_) {
        console.log(JSON.stringify({
          success: true,
          message: `Job ${options.cancel} marked as cancelled (worker process already exited).`,
        }));
      }
    } else {
      console.log(JSON.stringify({
        success: true,
        message: `Job ${options.cancel} marked as cancelled.`,
      }));
    }
  } catch (_) {
    console.log(JSON.stringify({ success: false, error: `Job ${options.cancel} not found.` }));
  }
  process.exit(0);
}

// ─── --background fork ─────────────────────────────────────────

if (options.background && !options.internalJobId) {
  await ensureJobsDir();
  const jobId = `job-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  // 先写 job 元数据（确保 spawn 前可追踪，防止孤儿任务）
  const startedAt = new Date().toISOString();
  // 安全：只存储 prompt 摘要，避免敏感内容（凭据、代码片段）明文落盘
  const promptSummary = options.prompt.length > 120
    ? options.prompt.slice(0, 120) + "…"
    : options.prompt;
  await writeJobFile(jobId, {
    status: "launching",
    phase: "starting",
    promptSummary,
    workerPid: null,
    startedAt,
  });

  const childArgs = [
    ...process.argv.slice(2).filter((a) => a !== "--background"),
    "--internal-job-id",
    jobId,
  ];

  let child;
  try {
    child = spawn(process.argv[0], [process.argv[1], ...childArgs], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (spawnErr) {
    // spawn 失败时更新 job 状态为 failed，确保 --status 可查询
    await writeJobFile(jobId, {
      status: "failed",
      phase: "failed",
      promptSummary,
      error: spawnErr.message,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    exitWithError(`Failed to spawn background worker: ${spawnErr.message}`);
  }

  // spawn 成功后更新 workerPid（用于 --cancel 终止）
  await writeJobFile(jobId, {
    status: "running",
    phase: "starting",
    promptSummary,
    workerPid: child.pid ?? null,
    startedAt,
  });

  console.log(JSON.stringify({
    success: true,
    jobId,
    message: "Background job started. Query it with --status " + jobId,
  }, null, 2));
  process.exit(0);
}

// ─── Prompt 模板加载工具 ───────────────────────────────────────

function loadPromptTemplate(name) {
  const templatePath = path.join(SKILL_ROOT, "prompts", `${name}.md`);
  return readFileSync(templatePath, "utf8");
}

function interpolateTemplate(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ─── 结果输出 ──────────────────────────────────────────────────

async function outputResult(resultObj) {
  if (options.internalJobId) {
    await ensureJobsDir();
    resultObj.status = resultObj.success ? "completed" : "failed";
    resultObj.phase = resultObj.success ? "done" : "failed";
    resultObj.completedAt = new Date().toISOString();
    await updateJobState(resultObj);
  } else {
    console.log(JSON.stringify(resultObj, null, 2));
    // 失败时使用非零退出码
    if (!resultObj.success) {
      process.exitCode = 1;
    }
  }
}

// ─── App Server 客户端（传输层） ─────────────────────────────────
// 职责：JSON-RPC 收发、进程生命周期管理
// 不承载业务逻辑（消息捕获由 captureTurn 负责）

// 屏蔽高频 delta 类通知，减少噪音和内存压力
const OPT_OUT_NOTIFICATIONS = [
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
];

class AppServerClient {
  constructor(cwd) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.proc = null;
    this.closed = false;
    this.stderr = "";
    this.exitResolved = false;
    this.exitError = null;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    // 通知处理器，由 captureTurn 动态设置
    this.notificationHandler = null;
  }

  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }

  async start() {
    // Windows 兼容：spawn 不会自动解析 .cmd/.bat 包装器
    const isWin = process.platform === "win32";
    this.proc = spawn(
      isWin ? "cmd" : "codex",
      isWin ? ["/d", "/s", "/c", "codex", "app-server"] : ["app-server"],
      {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    // 收集 stderr 用于错误诊断
    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });

    this.proc.on("error", (err) => {
      this._handleExit(err);
    });

    this.proc.on("exit", (code, signal) => {
      const detail = code === 0
        ? null
        : new Error(
            `codex app-server exited unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).`
          );
      this._handleExit(detail);
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this._handleLine(line));

    // 协议握手：initialize + initialized 通知
    await this.request("initialize", {
      clientInfo: { name: "Claude Workflow Bridge", version: "1.0.0" },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: OPT_OUT_NOTIFICATIONS,
      },
    });
    // 发送 initialized 通知完成握手（协议要求）
    this._notify("initialized", {});
  }

  _handleLine(line) {
    if (!line.trim()) return;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      // JSON 解析失败视为连接级故障（非静默忽略）
      this._handleExit(new Error(`Failed to parse app-server JSONL: ${err.message}`));
      return;
    }

    // Server-to-Client 请求（同时有 id 和 method）→ 回复不支持
    if (msg.id !== undefined && msg.method) {
      this._sendMessage({
        id: msg.id,
        error: { code: -32601, message: `Unsupported server request: ${msg.method}` },
      });
      return;
    }

    // RPC 响应（有 id，无 method）
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(msg.error.message ?? "RPC failed"));
      } else {
        entry.resolve(msg.result ?? {});
      }
      return;
    }

    // 通知（有 method，无 id）→ 转发给通知处理器
    if (msg.method && this.notificationHandler) {
      this.notificationHandler(msg);
    }
  }

  _handleExit(error) {
    if (this.exitResolved) return;
    this.exitResolved = true;
    this.exitError = error ?? null;

    // 拒绝所有未完成的 RPC 请求
    for (const { reject } of this.pending.values()) {
      reject(this.exitError ?? new Error("codex app-server connection closed."));
    }
    this.pending.clear();
    this.resolveExit();
  }

  request(method, params) {
    if (this.closed) {
      return Promise.reject(new Error("App server client is closed."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._sendMessage({ id, method, params });
    });
  }

  _notify(method, params = {}) {
    if (this.closed) return;
    this._sendMessage({ method, params });
  }

  _sendMessage(msg) {
    if (this.proc?.stdin && !this.proc.stdin.destroyed) {
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    }
  }

  async close() {
    if (this.closed) {
      await this.exitPromise;
      return;
    }
    this.closed = true;

    if (this.proc && !this.proc.killed) {
      // 先关闭 stdin，给 app-server 优雅退出机会
      this.proc.stdin.end();
      // 短暂延迟后强制 SIGTERM（参照成熟版策略）
      const timer = setTimeout(() => {
        if (this.proc && !this.proc.killed) {
          this.proc.kill("SIGTERM");
        }
      }, 50);
      timer.unref?.();
    }

    await this.exitPromise;
  }
}

// ─── Turn 完成状态捕获（事件驱动模型） ──────────────────────────
// 核心修复：替换 sleep-then-read 伪同步，使用 turn/completed 通知驱动完成

function createTurnState(threadId) {
  let resolveCompletion, rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  return {
    threadId,
    turnId: null,
    completed: false,
    completion,
    resolveCompletion,
    rejectCompletion,
    // 消息/审查结果
    lastAgentMessage: "",
    reviewText: "",
    finalAnswerSeen: false,
    error: null,
    // 多线程追踪（子 agent 场景）
    threadIds: new Set([threadId]),
    pendingCollaborations: new Set(),
    activeSubagentTurns: new Set(),
    completionTimer: null,
  };
}

// 标记 turn 完成，resolve 等待 Promise
function completeTurn(state) {
  if (state.completed) return;
  if (state.completionTimer) {
    clearTimeout(state.completionTimer);
    state.completionTimer = null;
  }
  state.completed = true;
  state.resolveCompletion(state);
}

// 当主线程 final_answer 已收到且所有子 agent 完成时，
// 通过短延迟推断 turn 完成（应对某些 turn/completed 丢失的边缘情况）
function scheduleInferredCompletion(state) {
  if (state.completed || !state.finalAnswerSeen) return;
  if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) return;
  if (state.completionTimer) clearTimeout(state.completionTimer);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (state.completed) return;
    if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) return;
    emitProgress("Turn completion inferred (subagents drained).", "finalizing");
    completeTurn(state);
  }, 250);
  state.completionTimer.unref?.();
}

// 将 App Server 通知应用到 turn 状态
function applyNotification(state, msg) {
  const method = msg.method;
  const params = msg.params ?? {};

  switch (method) {
    case "thread/started": {
      if (params.thread?.id) {
        state.threadIds.add(params.thread.id);
      }
      break;
    }

    case "turn/started": {
      const messageThreadId = params.threadId ?? null;
      if (params.turn?.id) {
        if (!messageThreadId || messageThreadId === state.threadId) {
          // 主线程 turn
          state.turnId = params.turn.id;
        } else {
          // 子 agent turn
          state.activeSubagentTurns.add(messageThreadId);
          state.threadIds.add(messageThreadId);
        }
      }
      emitProgress(`Turn started (${params.turn?.id ?? "?"}).`, "starting");
      break;
    }

    case "item/started": {
      const item = params.item;
      if (!item) break;

      let progressMsg = null;
      let phase = "investigating";

      if (item.type === "commandExecution") {
        progressMsg = `Running command: ${(item.command ?? "").slice(0, 80)}...`;
        phase = /test|lint|build|check/i.test(item.command ?? "") ? "verifying" : "running";
      } else if (item.type === "fileChange") {
        progressMsg = "Applying file changes...";
        phase = "editing";
      } else if (item.type === "collabAgentToolCall") {
        progressMsg = "Delegating to subagent...";
        // 追踪协作任务状态
        state.pendingCollaborations.add(item.id);
        for (const tid of item.receiverThreadIds ?? []) {
          state.threadIds.add(tid);
        }
      } else if (item.type === "dynamicToolCall" || item.type === "mcpToolCall") {
        progressMsg = `Using tool: ${item.tool}`;
      } else if (item.type === "enteredReviewMode") {
        progressMsg = "Reviewer started.";
        phase = "reviewing";
      }

      emitProgress(progressMsg, phase);
      break;
    }

    case "item/completed": {
      const item = params.item;
      if (!item) break;
      const messageThreadId = params.threadId ?? null;

      if (item.type === "commandExecution") {
        emitProgress(
          `Command completed (exit ${item.exitCode ?? "?"}).`,
          /test|lint|build|check/i.test(item.command ?? "") ? "verifying" : "running"
        );
      } else if (item.type === "agentMessage" && item.text) {
        // 修复：区分消息 phase
        const isMainThread = !messageThreadId || messageThreadId === state.threadId;
        if (isMainThread) {
          // 始终更新 lastAgentMessage（保证有值）
          state.lastAgentMessage = item.text;
          // 仅 final_answer 触发完成推断
          if (item.phase === "final_answer") {
            state.finalAnswerSeen = true;
            scheduleInferredCompletion(state);
          }
        }
      } else if (item.type === "exitedReviewMode") {
        state.reviewText = item.review ?? "";
        emitProgress("Reviewer finished.", "finalizing");
      } else if (item.type === "collabAgentToolCall") {
        state.pendingCollaborations.delete(item.id);
        scheduleInferredCompletion(state);
      }
      break;
    }

    case "turn/completed": {
      const messageThreadId = params.threadId ?? null;
      if (messageThreadId && messageThreadId !== state.threadId) {
        // 子线程 turn 完成
        state.activeSubagentTurns.delete(messageThreadId);
        scheduleInferredCompletion(state);
        break;
      }
      // 主线程 turn 完成
      emitProgress("Turn completed.", "finalizing");
      completeTurn(state);
      break;
    }

    case "error": {
      state.error = params.error ?? params;
      emitProgress(`Codex error: ${params.error?.message ?? params.message ?? "unknown"}`, "failed");
      break;
    }

    // 其他通知静默忽略
    default:
      break;
  }
}

// 事件驱动的 turn 捕获：注册通知处理器 → 发起请求 → 等待 turn/completed
async function captureTurn(client, threadId, startRequestFn) {
  const state = createTurnState(threadId);

  // 注册通知处理器，将事件路由到 turn 状态机
  client.setNotificationHandler((msg) => {
    // 过滤不属于当前 turn 任何线程的通知
    const messageThreadId = msg.params?.threadId ?? null;
    if (messageThreadId && !state.threadIds.has(messageThreadId)) {
      // thread/started 可能引入新线程，不过滤
      if (msg.method !== "thread/started") return;
    }
    applyNotification(state, msg);
  });

  try {
    // 发起 turn/start 或 review/start 请求
    const response = await startRequestFn();

    // 从响应中提取 turnId
    if (response?.turn?.id) {
      state.turnId = response.turn.id;
    }

    // review/start 返回的 reviewThreadId 也需要追踪
    if (response?.reviewThreadId) {
      state.threadIds.add(response.reviewThreadId);
    }

    // 极少情况：响应中已标记 turn 完成
    if (response?.turn?.status && response.turn.status !== "inProgress") {
      completeTurn(state);
    }

    // 等待 turn/completed 通知（核心等待点）
    // 竞争等待：turn 完成 vs app-server 异常退出（防止进程崩溃时永久挂死）
    const exitRacer = client.exitPromise.then(() => {
      if (!state.completed) {
        throw client.exitError ?? new Error("codex app-server exited before turn completed.");
      }
      return state;
    });

    // 修复：消费 exitRacer 的 rejection，防止 completion 先 resolve 时产生 unhandled rejection
    const result = await Promise.race([state.completion, exitRacer]);
    exitRacer.catch(() => {});
    return result;
  } finally {
    // 确保清理定时器
    if (state.completionTimer) {
      clearTimeout(state.completionTimer);
      state.completionTimer = null;
    }
    // 恢复通知处理器
    client.setNotificationHandler(null);
  }
}

// ─── ReviewTarget 工具 ─────────────────────────────────────────

function parseReviewTarget(input) {
  const normalized = (input || "working-tree").trim();
  if (normalized === "working-tree" || normalized === "uncommitted") {
    return { type: "uncommittedChanges", label: "working tree (uncommitted changes)" };
  }
  return { type: "baseBranch", branch: normalized, label: `branch diff vs ${normalized}` };
}

// ─── 主执行逻辑 ─────────────────────────────────────────────────

async function runForeground() {
  const client = new AppServerClient(options.cd);

  try {
    await client.start();

    let threadId;
    let state;
    const isReviewMode = command === "review" || command === "adversarial-review";

    if (isReviewMode) {
      // ── REVIEW 路径：强制新建 read-only 独立线程 ──
      // 不允许 --session-id（前面已校验），不受 --read-only 影响
      emitProgress("启动审查线程（read-only 隔离）...", "starting");
      const res = await client.request("thread/start", {
        cwd: options.cd,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
      });
      threadId = res.thread.id;

      const targetInput = options.review || options.adversarialReview || "working-tree";
      const target = parseReviewTarget(targetInput);

      if (command === "review") {
        // ── 内置 reviewer（review/start），不传 instructions ──
        emitProgress(`发起内置代码审查 (target: ${target.label})...`, "reviewing");
        state = await captureTurn(client, threadId, () =>
          client.request("review/start", {
            threadId,
            delivery: "inline",
            target: { type: target.type, ...(target.branch ? { branch: target.branch } : {}) },
          })
        );
      } else {
        // ── adversarial-review：turn/start + prompt 模板 ──
        emitProgress(`发起对抗式审查 (target: ${target.label})...`, "reviewing");

        // 加载并插值 adversarial-review prompt 模板
        let prompt;
        try {
          const template = loadPromptTemplate("adversarial-review");
          prompt = interpolateTemplate(template, {
            TARGET_LABEL: target.label,
            USER_FOCUS: options.prompt || "No extra focus provided.",
            REVIEW_INPUT: "(Codex will read the repository context via its own tools)",
          });
        } catch (e) {
          // prompt 模板加载失败时降级使用纯文本
          prompt = `Perform an adversarial code review. Target: ${target.label}. Focus: ${options.prompt || "General review"}. Be aggressive but grounded. Report only material findings.`;
          emitProgress(`Warning: prompt template not found, using fallback.`, "reviewing");
        }

        state = await captureTurn(client, threadId, () =>
          client.request("turn/start", {
            threadId,
            input: [{ type: "text", text: prompt, text_elements: [] }],
          })
        );
      }

      // ── 审查结果输出（充实的 JSON） ──
      const finalAnswer =
        state.reviewText || state.lastAgentMessage || "Review completed without detailed text.";

      await outputResult({
        success: !state.error,
        command,
        sessionId: threadId,
        turnId: state.turnId || null,
        target: { input: targetInput, ...target },
        agentMessages: finalAnswer,
        ...(state.error ? { errorDetail: state.error } : {}),
        ...(client.stderr ? { stderr: client.stderr.slice(-2000) } : {}),
      });

    } else {
      // ── TASK 路径 ──
      threadId = options.sessionId;
      if (threadId) {
        // 恢复已有会话
        emitProgress(`恢复会话 ${threadId}...`, "starting");
        await client.request("thread/resume", {
          threadId,
          cwd: options.cd,
          approvalPolicy: "never",
          sandbox: options.readOnly ? "read-only" : "workspace-write",
        });
      } else {
        // 新建任务线程：ephemeral: false 支持后续 resume
        emitProgress("启动新任务会话...", "starting");
        const res = await client.request("thread/start", {
          cwd: options.cd,
          approvalPolicy: "never",
          sandbox: options.readOnly ? "read-only" : "workspace-write",
          ephemeral: false,
        });
        threadId = res.thread.id;
      }

      emitProgress("开始提交 Task...", "starting");
      state = await captureTurn(client, threadId, () =>
        client.request("turn/start", {
          threadId,
          input: [{ type: "text", text: options.prompt, text_elements: [] }],
        })
      );

      // ── 任务结果输出（充实的 JSON） ──
      const finalAnswer = state.lastAgentMessage || "Turn completed without agent message.";

      await outputResult({
        success: !state.error,
        command: "task",
        sessionId: threadId,
        turnId: state.turnId || null,
        agentMessages: finalAnswer,
        ...(state.error ? { errorDetail: state.error } : {}),
        ...(client.stderr ? { stderr: client.stderr.slice(-2000) } : {}),
      });
    }
  } catch (err) {
    await outputResult({
      success: false,
      command,
      error: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    });
  } finally {
    await client.close();
  }
}

runForeground();
