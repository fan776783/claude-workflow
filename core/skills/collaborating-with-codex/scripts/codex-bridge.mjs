#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Portions adapted from codex-plugin-cc (Apache-2.0). See ../NOTICE.
//
// Codex App Server bridge — JSON-RPC over stdio to `codex app-server`.
// Event-driven turn completion (no polling), per-job log files for observation,
// state under ~/.claude/tmp/codex-jobs/<bucket>/.

import { spawn } from "node:child_process";
import readline from "node:readline";
import process from "node:process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TERMINAL_STATES,
  resolveBucketDir,
  ensureBucketDir,
  jobLogPath,
  jobJsonPath,
  readJobJsonSync,
  writeJobJson,
  patchJobJson,
  generateJobId,
} from "./lib/state.mjs";
import { pruneBucket } from "./lib/gc.mjs";
import { captureTurn, emitLogLine, collectTouchedFiles } from "./lib/capture.mjs";
import { loadJob, renderBrief, renderDetail, renderResult, waitForTerminal } from "./lib/result.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");

const VALID_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const MODEL_ALIASES = new Map([["spark", "gpt-5.3-codex-spark"]]);

const OPT_OUT_NOTIFICATIONS = [
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
];

// ─── CLI 解析 ───────────────────────────────────────────────────

const args = process.argv.slice(2);
let command = "task";
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
  result: null,
  detail: false,
  wait: false,
  tickSeconds: 30,
  model: null,
  effort: null,
  internalJobId: null,
};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "task") command = "task";
  else if (a === "--prompt") options.prompt = args[++i] ?? "";
  else if (a === "--cd") options.cd = args[++i] ?? process.cwd();
  else if (a === "--session-id") options.sessionId = args[++i] ?? null;
  else if (a === "--review") {
    command = "review";
    const next = args[i + 1];
    options.review = (next !== undefined && !next.startsWith("--")) ? args[++i] : "working-tree";
  }
  else if (a === "--adversarial-review") {
    command = "adversarial-review";
    const next = args[i + 1];
    options.adversarialReview = (next !== undefined && !next.startsWith("--")) ? args[++i] : "working-tree";
  }
  else if (a === "--read-only") options.readOnly = true;
  else if (a === "--background") options.background = true;
  else if (a === "--status") options.status = args[++i];
  else if (a === "--cancel") options.cancel = args[++i];
  else if (a === "--result") options.result = args[++i];
  else if (a === "--detail") options.detail = true;
  else if (a === "--wait") options.wait = true;
  else if (a === "--tick") options.tickSeconds = Number(args[++i]) || 30;
  else if (a === "--model") options.model = args[++i] ?? null;
  else if (a === "--effort") options.effort = args[++i] ?? null;
  else if (a === "--internal-job-id") options.internalJobId = args[++i];
}

function exitWithError(message) {
  console.log(JSON.stringify({ success: false, error: message }));
  process.exit(1);
}

if (options.effort && !VALID_EFFORTS.has(options.effort)) {
  exitWithError(`--effort must be one of: ${[...VALID_EFFORTS].join(", ")}`);
}
if (options.model && MODEL_ALIASES.has(options.model)) {
  options.model = MODEL_ALIASES.get(options.model);
}

if (command === "task" && !options.status && !options.cancel && !options.result && !options.prompt && !options.internalJobId) {
  exitWithError("--prompt is required for task mode.");
}
if (command === "review" && options.prompt) {
  exitWithError("--review does not accept --prompt. Use --adversarial-review <target> --prompt for focused review.");
}
if (command === "review" && options.sessionId) {
  exitWithError("--review does not support --session-id (always fresh read-only).");
}
if (command === "adversarial-review" && options.sessionId) {
  exitWithError("--adversarial-review does not support --session-id (always fresh read-only).");
}

// ─── 状态查询 / 终态结果 ───────────────────────────────────────

const BUCKET = resolveBucketDir(options.cd);

if (options.status) {
  try {
    if (options.wait) {
      const final = await waitForTerminal(BUCKET, options.status, {
        tickSeconds: options.tickSeconds,
        onTick: (brief) => {
          process.stderr.write(`[codex-bridge] tick: ${brief.phase ?? brief.status} | ${brief.elapsed ?? ""} | ${brief.lastEvent ?? ""}\n`);
        },
      });
      const out = options.detail ? renderDetail(final) : renderBrief(final);
      console.log(JSON.stringify(out, null, 2));
    } else {
      const job = await loadJob(BUCKET, options.status);
      const out = options.detail ? renderDetail(job) : renderBrief(job);
      console.log(JSON.stringify(out, null, 2));
    }
    process.exit(0);
  } catch (err) {
    exitWithError(err.message);
  }
}

if (options.result) {
  try {
    const job = await loadJob(BUCKET, options.result);
    console.log(JSON.stringify(renderResult(job), null, 2));
    process.exit(0);
  } catch (err) {
    exitWithError(err.message);
  }
}

if (options.cancel) {
  try {
    const job = await loadJob(BUCKET, options.cancel);
    if (job.status !== "running") {
      console.log(JSON.stringify({ success: false, error: `Job ${job.id} is not running (status: ${job.status}).` }));
      process.exit(0);
    }
    const updated = { ...job, status: "cancelled", phase: "cancelled", completedAt: new Date().toISOString() };
    await writeJobJson(BUCKET, job.id, updated);
    if (job.workerPid) {
      try {
        process.kill(job.workerPid, "SIGTERM");
        console.log(JSON.stringify({ success: true, message: `Job ${job.id} cancelled; worker ${job.workerPid} terminated.` }));
      } catch {
        console.log(JSON.stringify({ success: true, message: `Job ${job.id} marked cancelled (worker already gone).` }));
      }
    } else {
      console.log(JSON.stringify({ success: true, message: `Job ${job.id} marked cancelled.` }));
    }
    process.exit(0);
  } catch (err) {
    exitWithError(err.message);
  }
}

// ─── --background spawn ─────────────────────────────────────────

if (options.background && !options.internalJobId) {
  await ensureBucketDir(BUCKET);
  try {
    await pruneBucket(BUCKET);
  } catch (err) {
    process.stderr.write(`[codex-bridge] prune warning: ${err.message}\n`);
  }

  const jobId = generateJobId();
  const startedAt = new Date().toISOString();
  const promptSummary = options.prompt.length > 120 ? options.prompt.slice(0, 120) + "…" : options.prompt;
  const logFile = jobLogPath(BUCKET, jobId);

  await writeJobJson(BUCKET, jobId, {
    id: jobId,
    status: "launching",
    phase: "starting",
    command,
    promptSummary,
    workerPid: null,
    logFile,
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });

  const childArgs = [
    ...process.argv.slice(2).filter((x) => x !== "--background"),
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
  } catch (err) {
    await writeJobJson(BUCKET, jobId, {
      id: jobId,
      status: "failed",
      phase: "failed",
      command,
      promptSummary,
      error: err.message,
      startedAt,
      completedAt: new Date().toISOString(),
      logFile,
    });
    exitWithError(`Failed to spawn background worker: ${err.message}`);
  }

  await writeJobJson(BUCKET, jobId, {
    id: jobId,
    status: "running",
    phase: "starting",
    command,
    promptSummary,
    workerPid: child.pid ?? null,
    logFile,
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });

  console.log(JSON.stringify({
    success: true,
    jobId,
    logFile,
    message: `Background job started. Observe via: tail -F ${logFile}  OR  --status ${jobId} [--wait]`,
  }, null, 2));
  process.exit(0);
}

// ─── 模板 ─────────────────────────────────────────────────────

function loadPromptTemplate(name) {
  return readFileSync(path.join(SKILL_ROOT, "prompts", `${name}.md`), "utf8");
}

function interpolateTemplate(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
  return out;
}

function parseReviewTarget(input) {
  const n = (input || "working-tree").trim();
  if (n === "working-tree" || n === "uncommitted") {
    return { type: "uncommittedChanges", label: "working tree (uncommitted changes)" };
  }
  return { type: "baseBranch", branch: n, label: `branch diff vs ${n}` };
}

// ─── App Server 客户端 ─────────────────────────────────────────

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
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve; });
    this.notificationHandler = null;
  }

  setNotificationHandler(h) { this.notificationHandler = h; }

  async start() {
    const isWin = process.platform === "win32";
    const codexArgs = [
      "-c", "features.multi_agent_v2.enabled=true",
      "-c", "features.multi_agent_v2.min_wait_timeout_ms=480000",
      "-c", "features.multi_agent_v2.default_wait_timeout_ms=480000",
      "app-server",
    ];
    process.stderr.write(`[codex-bridge] effective wait timeout: 8min (480000ms)\n`);

    this.proc = spawn(
      isWin ? "cmd" : "codex",
      isWin ? ["/d", "/s", "/c", "codex", ...codexArgs] : codexArgs,
      { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] }
    );
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.proc.on("error", (err) => this._handleExit(err));
    this.proc.on("exit", (code, signal) => {
      const detail = code === 0 ? null : new Error(
        `codex app-server exited unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).`
      );
      this._handleExit(detail);
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this._handleLine(line));

    await this.request("initialize", {
      clientInfo: { name: "Claude Workflow Bridge", version: "1.0.0" },
      capabilities: { experimentalApi: false, optOutNotificationMethods: OPT_OUT_NOTIFICATIONS },
    });
    this._notify("initialized", {});
  }

  _handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (err) {
      this._handleExit(new Error(`Failed to parse app-server JSONL: ${err.message}`));
      return;
    }
    if (msg.id !== undefined && msg.method) {
      this._sendMessage({ id: msg.id, error: { code: -32601, message: `Unsupported server request: ${msg.method}` } });
      return;
    }
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message ?? "RPC failed"));
      else entry.resolve(msg.result ?? {});
      return;
    }
    if (msg.method && this.notificationHandler) this.notificationHandler(msg);
  }

  _handleExit(error) {
    if (this.exitResolved) return;
    this.exitResolved = true;
    this.exitError = error ?? null;
    for (const { reject } of this.pending.values()) {
      reject(this.exitError ?? new Error("codex app-server connection closed."));
    }
    this.pending.clear();
    this.resolveExit();
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error("App server client is closed."));
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
    if (this.closed) { await this.exitPromise; return; }
    this.closed = true;
    if (this.proc && !this.proc.killed) {
      this.proc.stdin.end();
      const t = setTimeout(() => {
        if (this.proc && !this.proc.killed) this.proc.kill("SIGTERM");
      }, 50);
      t.unref?.();
    }
    await this.exitPromise;
  }
}

// ─── 主流程 ────────────────────────────────────────────────────

async function emitProgressDual(logFile, jobId, phase, msg) {
  emitLogLine(logFile, msg);
  if (options.internalJobId) {
    await patchJobJson(BUCKET, jobId, { phase, lastEvent: msg });
  } else {
    process.stderr.write(`[codex-bridge] ${msg}\n`);
  }
}

async function finalizeJob(jobId, logFile, result) {
  if (!options.internalJobId) return;
  const completedAt = new Date().toISOString();
  await writeJobJson(BUCKET, jobId, {
    ...readJobJsonSync(BUCKET, jobId),
    ...result,
    status: result.success ? "completed" : "failed",
    phase: result.success ? "done" : "failed",
    completedAt,
    logFile,
  });
}

async function runForeground() {
  // 前台模式也给一个临时 jobId 用于 log 文件
  let activeJobId = options.internalJobId;
  if (!activeJobId) {
    activeJobId = generateJobId();
    await ensureBucketDir(BUCKET);
    await writeJobJson(BUCKET, activeJobId, {
      id: activeJobId,
      status: "running",
      phase: "starting",
      command,
      logFile: jobLogPath(BUCKET, activeJobId),
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  }
  const logFile = jobLogPath(BUCKET, activeJobId);
  emitLogLine(logFile, `Starting ${command} job (${activeJobId}).`);

  const onLog = (msg) => emitLogLine(logFile, msg);
  const setPhase = async (phase, msg) => emitProgressDual(logFile, activeJobId, phase, msg);

  const client = new AppServerClient(options.cd);

  try {
    await client.start();
    const isReview = command === "review" || command === "adversarial-review";
    let threadId;
    let state;

    if (isReview) {
      await setPhase("starting", "Starting review thread (read-only).");
      const res = await client.request("thread/start", {
        cwd: options.cd, approvalPolicy: "never", sandbox: "read-only", ephemeral: true,
      });
      threadId = res.thread.id;
      const target = parseReviewTarget(options.review || options.adversarialReview || "working-tree");

      if (command === "review") {
        await setPhase("reviewing", `Built-in reviewer on ${target.label}.`);
        state = await captureTurn(client, threadId, () =>
          client.request("review/start", {
            threadId, delivery: "inline",
            target: { type: target.type, ...(target.branch ? { branch: target.branch } : {}) },
          }),
          { onLog }
        );
      } else {
        await setPhase("reviewing", `Adversarial reviewer on ${target.label}.`);
        let prompt;
        try {
          const tpl = loadPromptTemplate("adversarial-review");
          prompt = interpolateTemplate(tpl, {
            TARGET_LABEL: target.label,
            USER_FOCUS: options.prompt || "No extra focus provided.",
            REVIEW_INPUT: "(Codex will read the repository context via its own tools)",
          });
        } catch {
          prompt = `Perform an adversarial code review. Target: ${target.label}. Focus: ${options.prompt || "General review"}.`;
        }
        const input = [{ type: "text", text: prompt, text_elements: [] }];
        state = await captureTurn(client, threadId, () =>
          client.request("turn/start", buildTurnStart(threadId, input)),
          { onLog }
        );
      }

      const finalAnswer = state.reviewText || state.lastAgentMessage || "Review completed without text.";
      const touchedFiles = collectTouchedFiles(state.fileChanges);

      const resultObj = {
        success: !state.error,
        command,
        sessionId: threadId,
        threadId,
        turnId: state.turnId || null,
        target: { input: options.review || options.adversarialReview, ...target },
        agentMessages: finalAnswer,
        reviewText: state.reviewText,
        reasoningSummary: state.reasoningSummary,
        touchedFiles,
        fileChanges: state.fileChanges,
        commandExecutions: state.commandExecutions,
        ...(state.error ? { error: state.error } : {}),
        ...(client.stderr ? { stderr: client.stderr.slice(-2000) } : {}),
      };

      await finalizeJob(activeJobId, logFile, resultObj);
      if (!options.internalJobId) {
        // 前台:终态写回 + 打印 JSON
        await writeJobJson(BUCKET, activeJobId, {
          ...readJobJsonSync(BUCKET, activeJobId),
          ...resultObj,
          status: resultObj.success ? "completed" : "failed",
          phase: resultObj.success ? "done" : "failed",
          completedAt: new Date().toISOString(),
        });
        emitLogLine(logFile, "Final result captured.");
        console.log(JSON.stringify(resultObj, null, 2));
        if (!resultObj.success) process.exitCode = 1;
      }
    } else {
      // TASK
      threadId = options.sessionId;
      if (threadId) {
        await setPhase("starting", `Resuming session ${threadId}.`);
        await client.request("thread/resume", {
          threadId, cwd: options.cd,
          approvalPolicy: "never",
          sandbox: options.readOnly ? "read-only" : "workspace-write",
        });
      } else {
        await setPhase("starting", "Starting new task session.");
        const res = await client.request("thread/start", {
          cwd: options.cd, approvalPolicy: "never",
          sandbox: options.readOnly ? "read-only" : "workspace-write",
          ephemeral: false,
        });
        threadId = res.thread.id;
      }

      await setPhase("starting", "Submitting task turn.");
      const input = [{ type: "text", text: options.prompt, text_elements: [] }];
      state = await captureTurn(client, threadId, () =>
        client.request("turn/start", buildTurnStart(threadId, input)),
        { onLog }
      );

      const finalAnswer = state.lastAgentMessage || "Turn completed without agent message.";
      const touchedFiles = collectTouchedFiles(state.fileChanges);

      const resultObj = {
        success: !state.error,
        command: "task",
        sessionId: threadId,
        threadId,
        turnId: state.turnId || null,
        agentMessages: finalAnswer,
        reasoningSummary: state.reasoningSummary,
        touchedFiles,
        fileChanges: state.fileChanges,
        commandExecutions: state.commandExecutions,
        ...(state.error ? { error: state.error } : {}),
        ...(client.stderr ? { stderr: client.stderr.slice(-2000) } : {}),
      };

      await finalizeJob(activeJobId, logFile, resultObj);
      if (!options.internalJobId) {
        await writeJobJson(BUCKET, activeJobId, {
          ...readJobJsonSync(BUCKET, activeJobId),
          ...resultObj,
          status: resultObj.success ? "completed" : "failed",
          phase: resultObj.success ? "done" : "failed",
          completedAt: new Date().toISOString(),
        });
        emitLogLine(logFile, "Final result captured.");
        console.log(JSON.stringify(resultObj, null, 2));
        if (!resultObj.success) process.exitCode = 1;
      }
    }
  } catch (err) {
    const failObj = { success: false, command, error: err.message, ...(err.stack ? { stack: err.stack } : {}) };
    await finalizeJob(activeJobId, logFile, failObj);
    if (!options.internalJobId) {
      await writeJobJson(BUCKET, activeJobId, {
        ...readJobJsonSync(BUCKET, activeJobId),
        ...failObj,
        status: "failed",
        phase: "failed",
        completedAt: new Date().toISOString(),
      });
      console.log(JSON.stringify(failObj, null, 2));
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

function buildTurnStart(threadId, input) {
  const payload = { threadId, input };
  if (options.model) payload.model = options.model;
  if (options.effort) payload.effort = options.effort;
  return payload;
}

runForeground();
