/**
 * Grok CLI runtime layer.
 *
 * Provides the same surface the companion script used against the Codex
 * app-server, but implemented on top of one-shot `grok` headless runs:
 * - turns run via `grok -p <prompt> --output-format streaming-json`
 * - threads map to grok sessions and resume via `grok --resume <session-id>`
 * - structured output uses `--json-schema`, surfaced in the final `end` event
 *
 * @typedef {((update: string | { message: string, phase: string | null, threadId?: string | null, turnId?: string | null, stderrMessage?: string | null, logTitle?: string | null, logBody?: string | null }) => void)} ProgressReporter
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { readJsonFile } from "./fs.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

const TASK_THREAD_PREFIX = "Grok Companion Task";
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved.";
const PROGRESS_TEXT_INTERVAL_MS = 2000;
const AUTH_PROBE_TIMEOUT_MS = 30000;

const SANDBOX_PROFILES = new Map([
  ["read-only", "read-only"],
  ["workspace-write", "workspace"],
  ["workspace", "workspace"]
]);

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function emitProgress(onProgress, message, phase = null, extra = {}) {
  if (!onProgress || !message) {
    return;
  }
  if (!phase && Object.keys(extra).length === 0) {
    onProgress(message);
    return;
  }
  onProgress({ message, phase, ...extra });
}

function emitLogEvent(onProgress, options = {}) {
  if (!onProgress) {
    return;
  }
  onProgress({
    message: options.message ?? "",
    phase: options.phase ?? null,
    stderrMessage: options.stderrMessage ?? null,
    logTitle: options.logTitle ?? null,
    logBody: options.logBody ?? null
  });
}

function buildTaskThreadName(prompt) {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_THREAD_PREFIX}: ${excerpt}` : TASK_THREAD_PREFIX;
}

function resolveSandboxProfile(sandbox) {
  return SANDBOX_PROFILES.get(sandbox ?? "read-only") ?? "read-only";
}

function normalizeReasoningText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function gitChangedFiles(cwd) {
  const result = runCommand("git", ["status", "--porcelain", "--untracked-files=all"], { cwd });
  if (result.error || result.status !== 0) {
    return null;
  }
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => {
        const entry = line.slice(3).trim();
        const renameIndex = entry.indexOf(" -> ");
        return renameIndex === -1 ? entry : entry.slice(renameIndex + 4);
      })
      .filter(Boolean)
  );
}

function diffTouchedFiles(cwd, before, after, startedAtMs) {
  if (!before || !after) {
    return [];
  }
  const touched = [...after].filter((file) => {
    if (!before.has(file)) {
      return true;
    }
    // Already-dirty files stay in both sets even when the run edits them
    // again, so fall back to the modification time to catch re-edits.
    try {
      return fs.lstatSync(path.join(cwd, file)).mtimeMs >= startedAtMs;
    } catch {
      return true;
    }
  });
  for (const file of before) {
    // Present before but gone after: the run deleted the file or fully
    // reverted a pre-existing change.
    if (!after.has(file)) {
      touched.push(file);
    }
  }
  return touched;
}

export function getGrokAvailability(cwd) {
  const versionStatus = binaryAvailable("grok", ["--version"], { cwd });
  if (!versionStatus.available) {
    return versionStatus;
  }
  return {
    available: true,
    detail: versionStatus.detail
  };
}

export function getSessionRuntimeStatus() {
  return {
    mode: "direct",
    label: "one-shot CLI",
    detail: "Each review or task command runs a fresh `grok` headless process; sessions resume via `grok --resume`.",
    endpoint: null
  };
}

export async function getGrokAuthStatus(cwd) {
  const availability = getGrokAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      source: "availability",
      authMethod: null,
      verified: null,
      provider: null
    };
  }

  const result = runCommand("grok", ["models"], { cwd, timeout: AUTH_PROBE_TIMEOUT_MS });
  const stdout = String(result.stdout ?? "");
  const loggedInLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /logged in/i.test(line));

  if (result.status === 0 && loggedInLine) {
    const defaultModel = stdout.match(/Default model:\s*(\S+)/)?.[1] ?? null;
    return {
      available: true,
      loggedIn: true,
      detail: defaultModel ? `${loggedInLine} Default model: ${defaultModel}.` : loggedInLine,
      source: "grok-models",
      authMethod: /api key/i.test(stdout) ? "apiKey" : "browser",
      verified: true,
      provider: "xai"
    };
  }

  const detail =
    String(result.stderr ?? "").trim() ||
    stdout.trim() ||
    (result.error ? result.error.message : "not authenticated");
  return {
    available: true,
    loggedIn: false,
    detail: shorten(detail, 200) || "not authenticated",
    source: "grok-models",
    authMethod: null,
    verified: null,
    provider: "xai"
  };
}

export function interruptGrokTurn() {
  return {
    attempted: false,
    interrupted: false,
    transport: null,
    detail: "Grok headless runs stop when their process tree is terminated."
  };
}

function buildGrokArgs(cwd, options) {
  const args = ["--cwd", cwd, "--sandbox", resolveSandboxProfile(options.sandbox), "--always-approve"];

  if (options.resumeThreadId) {
    args.push("--resume", options.resumeThreadId);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--reasoning-effort", options.effort);
  }
  if (options.outputSchema) {
    args.push("--json-schema", JSON.stringify(options.outputSchema));
  }

  args.push("--output-format", "streaming-json", "-p", options.prompt);
  return args;
}

function createStreamCapture(onProgress) {
  return {
    textBuffer: "",
    thoughtBuffer: "",
    reasoningSections: [],
    endEvent: null,
    errorEvent: null,
    lastTextProgressAt: 0,
    sawText: false,
    onProgress
  };
}

function flushThought(capture) {
  const normalized = normalizeReasoningText(capture.thoughtBuffer);
  capture.thoughtBuffer = "";
  if (!normalized || capture.reasoningSections.includes(normalized)) {
    return;
  }
  capture.reasoningSections.push(normalized);
  emitLogEvent(capture.onProgress, {
    message: `Reasoning: ${shorten(normalized, 96)}`,
    phase: "investigating",
    logTitle: "Reasoning summary",
    logBody: `- ${normalized}`
  });
}

function applyStreamEvent(capture, event) {
  switch (event.type) {
    case "thought":
      capture.thoughtBuffer += String(event.data ?? "");
      if (/[.!?]\s*$/.test(capture.thoughtBuffer) && capture.thoughtBuffer.length > 160) {
        flushThought(capture);
      }
      break;
    case "text": {
      capture.textBuffer += String(event.data ?? "");
      flushThought(capture);
      if (!capture.sawText) {
        capture.sawText = true;
        emitProgress(capture.onProgress, "Grok is writing its answer.", "finalizing");
      }
      const now = Date.now();
      if (now - capture.lastTextProgressAt >= PROGRESS_TEXT_INTERVAL_MS) {
        capture.lastTextProgressAt = now;
        emitProgress(capture.onProgress, `Answer so far: ${shorten(capture.textBuffer.slice(-160), 96)}`, "finalizing");
      }
      break;
    }
    case "error":
      capture.errorEvent = { message: String(event.message ?? "Grok reported an error.") };
      emitProgress(capture.onProgress, `Grok error: ${capture.errorEvent.message}`, "failed");
      break;
    case "end":
      flushThought(capture);
      capture.endEvent = event;
      break;
    default:
      break;
  }
}

function spawnGrokTurn(cwd, args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn("grok", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const capture = createStreamCapture(onProgress);
    let stdoutRemainder = "";
    let stderr = "";

    // /grok-cc:cancel terminates this Node process; the grok child is not in the
    // job record, so forward the signal or it would keep running unattended.
    const forwardTermination = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // The child already exited.
      }
    };
    process.once("SIGTERM", forwardTermination);
    process.once("SIGINT", forwardTermination);

    child.stdout.on("data", (chunk) => {
      stdoutRemainder += chunk.toString();
      let newlineIndex = stdoutRemainder.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutRemainder.slice(0, newlineIndex).trim();
        stdoutRemainder = stdoutRemainder.slice(newlineIndex + 1);
        newlineIndex = stdoutRemainder.indexOf("\n");
        if (!line) {
          continue;
        }
        try {
          applyStreamEvent(capture, JSON.parse(line));
        } catch {
          // Non-JSON stdout lines are kept out of the transcript on purpose.
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      process.removeListener("SIGTERM", forwardTermination);
      process.removeListener("SIGINT", forwardTermination);
      const trailing = stdoutRemainder.trim();
      if (trailing) {
        try {
          applyStreamEvent(capture, JSON.parse(trailing));
        } catch {
          // Ignore partial trailing output.
        }
      }
      flushThought(capture);
      resolve({ capture, exitCode: code ?? 1, stderr });
    });
  });
}

/**
 * Run one Grok turn headlessly. Mirrors the old app-server turn contract:
 * returns the final assistant message, the session (thread) id, reasoning
 * summary sections, and touched files for write-capable runs.
 */
export async function runGrokTurn(cwd, options = {}) {
  const availability = getGrokAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "Grok CLI is not installed. Install it with `curl -fsSL https://x.ai/cli/install.sh | bash`, then rerun `/grok-cc:setup`."
    );
  }

  const prompt = options.prompt?.trim() || options.defaultPrompt || "";
  if (!prompt) {
    throw new Error("A prompt is required for this Grok run.");
  }

  const sandboxProfile = resolveSandboxProfile(options.sandbox);
  if (options.resumeThreadId) {
    emitProgress(options.onProgress, `Resuming Grok session ${options.resumeThreadId}.`, "starting");
  } else {
    emitProgress(options.onProgress, "Starting Grok session.", "starting");
  }

  const filesBefore = sandboxProfile === "workspace" ? gitChangedFiles(cwd) : null;
  // 1s margin so filesystems with coarse mtime granularity don't miss edits
  // that land in the same second the run starts.
  const startedAtMs = Date.now() - 1000;
  const { capture, exitCode, stderr } = await spawnGrokTurn(
    cwd,
    buildGrokArgs(cwd, { ...options, prompt }),
    options.onProgress
  );

  const endEvent = capture.endEvent;
  const threadId = endEvent?.sessionId ?? options.resumeThreadId ?? null;
  const turnId = endEvent?.requestId ?? null;
  if (threadId) {
    emitProgress(options.onProgress, `Session ready (${threadId}).`, "finalizing", { threadId, turnId });
  }

  let finalMessage = capture.textBuffer.trim();
  if (endEvent?.structuredOutput !== undefined && endEvent.structuredOutput !== null) {
    finalMessage = JSON.stringify(endEvent.structuredOutput);
  }

  const failed = exitCode !== 0 || Boolean(capture.errorEvent) || !endEvent;
  const error = capture.errorEvent
    ? { message: capture.errorEvent.message }
    : failed && !endEvent
      ? { message: stderr.trim() || `grok exited with code ${exitCode} before finishing the turn.` }
      : null;

  const touchedFiles = filesBefore ? diffTouchedFiles(cwd, filesBefore, gitChangedFiles(cwd), startedAtMs) : [];

  return {
    status: failed ? 1 : 0,
    threadId,
    turnId,
    finalMessage,
    structuredOutput: endEvent?.structuredOutput ?? null,
    reasoningSummary: capture.reasoningSections,
    turn: endEvent ? { id: turnId ?? "grok-turn", status: failed ? "failed" : "completed" } : null,
    error,
    stderr: stderr.trim(),
    fileChanges: [],
    touchedFiles,
    commandExecutions: []
  };
}

/**
 * Import a Claude Code session transcript into Grok via `grok import`.
 * Returns the imported session id so the user can `grok --resume` it.
 */
export async function importClaudeSession(cwd, options = {}) {
  const availability = getGrokAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "Grok CLI is not installed. Install it with `curl -fsSL https://x.ai/cli/install.sh | bash`, then rerun `/grok-cc:setup`."
    );
  }
  if (!options.sourcePath) {
    throw new Error("A Claude session source path is required.");
  }

  emitProgress(options.onProgress, "Importing the Claude session into Grok.", "transferring");
  const result = runCommand("grok", ["import", options.sourcePath, "--json"], { cwd });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "").trim() || String(result.stdout ?? "").trim();
    throw new Error(detail ? `grok import failed: ${detail}` : "grok import failed.");
  }

  const threadId = extractImportedSessionId(result.stdout);
  if (!threadId) {
    const detail = String(result.stdout ?? "").trim();
    throw new Error(
      `Grok reported that the import completed, but no imported session id was found in its output.${detail ? `\n${detail}` : ""}`
    );
  }

  emitProgress(options.onProgress, `Claude session imported (${threadId}).`, "completed", { threadId });
  return {
    threadId,
    stderr: String(result.stderr ?? "").trim()
  };
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractImportedSessionId(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let lastId = null;
  for (const line of lines) {
    let candidate = null;
    try {
      const parsed = JSON.parse(line);
      candidate =
        parsed?.sessionId ??
        parsed?.session_id ??
        parsed?.importedSessionId ??
        parsed?.imported_session_id ??
        parsed?.id ??
        null;
    } catch {
      candidate = line.match(UUID_PATTERN)?.[0] ?? null;
    }
    if (typeof candidate === "string" && UUID_PATTERN.test(candidate)) {
      lastId = candidate.match(UUID_PATTERN)[0];
    }
  }
  return lastId;
}

/**
 * The companion resolves resumable threads from its own tracked jobs. There is
 * no reliable way to attribute an arbitrary grok session to a companion task,
 * so the fallback lookup reports nothing rather than resuming the wrong one.
 */
export async function findLatestTaskThread() {
  return null;
}

export function buildPersistentTaskThreadName(prompt) {
  return buildTaskThreadName(prompt);
}

export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "Grok did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback
    };
  }

  try {
    return {
      parsed: JSON.parse(rawOutput),
      parseError: null,
      rawOutput,
      ...fallback
    };
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      ...fallback
    };
  }
}

export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}

export { DEFAULT_CONTINUE_PROMPT, TASK_THREAD_PREFIX };
