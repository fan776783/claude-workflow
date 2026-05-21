// SPDX-License-Identifier: MIT
// Portions adapted from codex-plugin-cc (Apache-2.0). See ../../NOTICE.

import fs from "node:fs";

const LOG_LINE_MAX = 200;

function nowIso() {
  return new Date().toISOString();
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function looksLikeVerificationCommand(command) {
  return /\b(test|tests|lint|build|typecheck|type-check|check|verify|validate|pytest|jest|vitest|cargo test|npm test|pnpm test|yarn test|go test|mvn test|gradle test|tsc|eslint|ruff)\b/i.test(
    command ?? ""
  );
}

function normalizeReasoningText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function extractReasoningSections(value) {
  if (!value) return [];
  if (typeof value === "string") {
    const normalized = normalizeReasoningText(value);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v) => extractReasoningSections(v));
  if (typeof value === "object") {
    if (typeof value.text === "string") return extractReasoningSections(value.text);
    if ("summary" in value) return extractReasoningSections(value.summary);
    if ("content" in value) return extractReasoningSections(value.content);
    if ("parts" in value) return extractReasoningSections(value.parts);
  }
  return [];
}

export function mergeReasoningSections(existing, next) {
  const merged = [];
  for (const section of [...existing, ...next]) {
    const normalized = normalizeReasoningText(section);
    if (!normalized || merged.includes(normalized)) continue;
    merged.push(normalized);
  }
  return merged;
}

export function collectTouchedFiles(fileChanges) {
  const paths = new Set();
  for (const fc of fileChanges) {
    for (const change of fc.changes ?? []) {
      if (change.path) paths.add(change.path);
    }
  }
  return [...paths];
}

export function truncateForLog(text) {
  const normalized = String(text ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= LOG_LINE_MAX) return normalized;
  const suffix = ` ... (full ${normalized.length} chars in snapshot)`;
  const keep = LOG_LINE_MAX - suffix.length;
  return `${normalized.slice(0, keep)}${suffix}`;
}

export function emitLogLine(logFile, msg) {
  const text = String(msg ?? "").trim();
  if (!logFile || !text) return;
  const line = `[${nowIso()}] ${truncateForLog(text)}\n`;
  try {
    fs.appendFileSync(logFile, line, "utf8");
  } catch {}
}

export function createTurnState(threadId, options = {}) {
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  return {
    threadId,
    rootThreadId: threadId,
    threadIds: new Set([threadId]),
    threadTurnIds: new Map(),
    threadLabels: new Map(),
    turnId: null,
    completion,
    resolveCompletion,
    rejectCompletion,
    finalTurn: null,
    completed: false,
    finalAnswerSeen: false,
    pendingCollaborations: new Set(),
    activeSubagentTurns: new Set(),
    completionTimer: null,
    lastAgentMessage: "",
    reviewText: "",
    reasoningSummary: [],
    messages: [],
    fileChanges: [],
    commandExecutions: [],
    error: null,
    onLog: options.onLog ?? null,
  };
}

function labelForThread(state, threadId) {
  if (!threadId || threadId === state.threadId) return null;
  return state.threadLabels.get(threadId) ?? threadId;
}

function registerThread(state, threadId, options = {}) {
  if (!threadId) return;
  state.threadIds.add(threadId);
  const label =
    options.threadName ??
    options.name ??
    options.agentNickname ??
    options.agentRole ??
    state.threadLabels.get(threadId) ??
    null;
  if (label) state.threadLabels.set(threadId, label);
}

function clearCompletionTimer(state) {
  if (state.completionTimer) {
    clearTimeout(state.completionTimer);
    state.completionTimer = null;
  }
}

function completeTurn(state, turn = null, options = {}) {
  if (state.completed) return;
  clearCompletionTimer(state);
  state.completed = true;
  if (turn) {
    state.finalTurn = turn;
    if (!state.turnId) state.turnId = turn.id;
  } else if (!state.finalTurn) {
    state.finalTurn = { id: state.turnId ?? "inferred-turn", status: "completed" };
  }
  if (options.inferred) state.onLog?.("Turn completion inferred (subagents drained).");
  state.resolveCompletion(state);
}

function scheduleInferredCompletion(state) {
  if (state.completed || state.finalTurn || !state.finalAnswerSeen) return;
  if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) return;
  clearCompletionTimer(state);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (state.completed || state.finalTurn || !state.finalAnswerSeen) return;
    if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) return;
    completeTurn(state, null, { inferred: true });
  }, 250);
  state.completionTimer.unref?.();
}

function describeStartedItem(state, item) {
  switch (item?.type) {
    case "enteredReviewMode":
      return "Reviewer started.";
    case "commandExecution":
      return `Running command: ${shorten(item.command, 120)}`;
    case "fileChange":
      return `Applying ${item.changes?.length ?? 0} file change(s).`;
    case "mcpToolCall":
      return `Calling ${item.server}/${item.tool}.`;
    case "dynamicToolCall":
      return `Running tool: ${item.tool}.`;
    case "collabAgentToolCall": {
      const subs = (item.receiverThreadIds ?? []).map((tid) => labelForThread(state, tid) ?? tid);
      return subs.length
        ? `Delegating to subagent ${subs.join(", ")} via ${item.tool}.`
        : `Delegating via collaboration tool ${item.tool}.`;
    }
    case "webSearch":
      return `Searching: ${shorten(item.query, 120)}`;
    default:
      return null;
  }
}

function describeCompletedItem(state, item) {
  switch (item?.type) {
    case "commandExecution": {
      const exit = item.exitCode ?? "?";
      const verb = looksLikeVerificationCommand(item.command) ? "Verification" : "Command";
      return `${verb} ${item.status ?? "completed"}: ${shorten(item.command, 96)} (exit ${exit})`;
    }
    case "fileChange":
      return `File changes ${item.status ?? "completed"}.`;
    case "mcpToolCall":
      return `Tool ${item.server}/${item.tool} ${item.status ?? "completed"}.`;
    case "dynamicToolCall":
      return `Tool ${item.tool} ${item.status ?? "completed"}.`;
    case "collabAgentToolCall": {
      const subs = (item.receiverThreadIds ?? []).map((tid) => labelForThread(state, tid) ?? tid);
      return subs.length
        ? `Subagent ${subs.join(", ")} ${item.status ?? "completed"}.`
        : `Collaboration tool ${item.tool} ${item.status ?? "completed"}.`;
    }
    case "exitedReviewMode":
      return "Reviewer finished.";
    default:
      return null;
  }
}

function recordItem(state, item, lifecycle, threadId = null) {
  if (item.type === "collabAgentToolCall") {
    if (!threadId || threadId === state.threadId) {
      if (lifecycle === "started" || item.status === "inProgress") {
        state.pendingCollaborations.add(item.id);
      } else if (lifecycle === "completed") {
        state.pendingCollaborations.delete(item.id);
        scheduleInferredCompletion(state);
      }
    }
    for (const tid of item.receiverThreadIds ?? []) registerThread(state, tid);
  }

  if (item.type === "agentMessage" && lifecycle === "completed") {
    state.messages.push({ phase: item.phase ?? null, text: item.text ?? "", threadId: threadId ?? null });
    if (item.text) {
      const isMain = !threadId || threadId === state.threadId;
      if (isMain) {
        state.lastAgentMessage = item.text;
        if (item.phase === "final_answer") {
          state.finalAnswerSeen = true;
          scheduleInferredCompletion(state);
        }
      }
      const label = labelForThread(state, threadId);
      const summary = label
        ? `Subagent ${label} message: ${shorten(item.text, 120)}`
        : `Assistant message: ${shorten(item.text, 120)}`;
      state.onLog?.(summary);
    }
    return;
  }

  if (item.type === "exitedReviewMode") {
    state.reviewText = item.review ?? "";
    if (lifecycle === "completed" && item.review) {
      state.onLog?.(`Review output captured (${item.review.length} chars).`);
    }
    return;
  }

  if (item.type === "reasoning" && lifecycle === "completed") {
    const next = extractReasoningSections(item.summary);
    state.reasoningSummary = mergeReasoningSections(state.reasoningSummary, next);
    if (next.length) {
      const label = labelForThread(state, threadId);
      const head = next[0];
      const summary = label
        ? `Subagent ${label} reasoning: ${shorten(head, 120)}`
        : `Reasoning captured: ${shorten(head, 120)}`;
      state.onLog?.(summary);
    }
    return;
  }

  if (item.type === "fileChange" && lifecycle === "completed") {
    state.fileChanges.push(item);
    return;
  }

  if (item.type === "commandExecution" && lifecycle === "completed") {
    state.commandExecutions.push(item);
  }
}

export function applyNotification(state, message) {
  const method = message.method;
  const params = message.params ?? {};

  switch (method) {
    case "thread/started":
      registerThread(state, params.thread?.id, {
        threadName: params.thread?.name,
        name: params.thread?.name,
        agentNickname: params.thread?.agentNickname,
        agentRole: params.thread?.agentRole,
      });
      break;
    case "thread/name/updated":
      registerThread(state, params.threadId, { threadName: params.threadName ?? null });
      break;
    case "turn/started": {
      const tid = params.threadId ?? null;
      registerThread(state, tid);
      if (params.turn?.id) state.threadTurnIds.set(tid, params.turn.id);
      if (tid && tid !== state.threadId) {
        state.activeSubagentTurns.add(tid);
      } else if (!state.turnId && params.turn?.id) {
        state.turnId = params.turn.id;
      }
      state.onLog?.(`Turn started (${params.turn?.id ?? "?"}).`);
      break;
    }
    case "item/started": {
      recordItem(state, params.item, "started", params.threadId ?? null);
      const desc = describeStartedItem(state, params.item);
      if (desc) state.onLog?.(desc);
      break;
    }
    case "item/completed": {
      recordItem(state, params.item, "completed", params.threadId ?? null);
      const desc = describeCompletedItem(state, params.item);
      if (desc) state.onLog?.(desc);
      break;
    }
    case "error":
      state.error = params.error ?? params;
      state.onLog?.(`Codex error: ${params.error?.message ?? params.message ?? "unknown"}`);
      break;
    case "turn/completed": {
      const tid = params.threadId ?? null;
      if (tid && tid !== state.threadId) {
        state.activeSubagentTurns.delete(tid);
        scheduleInferredCompletion(state);
        break;
      }
      state.onLog?.("Turn completed.");
      completeTurn(state, params.turn);
      break;
    }
    default:
      break;
  }
}

export async function captureTurn(client, threadId, startRequest, options = {}) {
  const state = createTurnState(threadId, { onLog: options.onLog });
  const previousHandler = client.notificationHandler;

  client.setNotificationHandler((msg) => {
    if (msg.method === "thread/started" || msg.method === "thread/name/updated") {
      applyNotification(state, msg);
      return;
    }
    const tid = msg.params?.threadId ?? null;
    if (tid && !state.threadIds.has(tid)) {
      if (previousHandler) previousHandler(msg);
      return;
    }
    applyNotification(state, msg);
  });

  try {
    const response = await startRequest();
    if (response?.turn?.id) state.turnId = response.turn.id;
    if (response?.reviewThreadId) state.threadIds.add(response.reviewThreadId);
    options.onResponse?.(response, state);

    if (response?.turn?.status && response.turn.status !== "inProgress") {
      completeTurn(state, response.turn);
    }

    const exitRacer = client.exitPromise.then(() => {
      if (!state.completed) {
        throw client.exitError ?? new Error("codex app-server exited before turn completed.");
      }
      return state;
    });

    const result = await Promise.race([state.completion, exitRacer]);
    exitRacer.catch(() => {});
    return result;
  } finally {
    clearCompletionTimer(state);
    client.setNotificationHandler(previousHandler ?? null);
  }
}

export { shorten, looksLikeVerificationCommand };
