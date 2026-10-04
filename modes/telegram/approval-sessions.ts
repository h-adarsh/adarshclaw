import { randomBytes } from "node:crypto";
import { Markup } from "telegraf";
import type { ActionTracker } from "../agent/action-tracker.ts";
import type { Toolexecuter } from "../agent/tool-executer.ts";
import type { ActionLog } from "../agent/types.ts";
import { composeBeforeAfter, formatPatch } from "../agent/diff-view.ts";

/** Staged changes are dropped if nobody approves them within this time. */
export const APPROVAL_TTL_MS = 15 * 60_000;
/** Telegram allows 4096 characters per message. Longer text is sent as a file. */
export const INLINE_LIMIT = 3500;

export interface TextReplier {
  reply: (t: string, o?: object) => Promise<unknown>;
}

export interface Replier extends TextReplier {
  replyWithDocument: (
    doc: { source: Buffer; filename: string },
    o?: object,
  ) => Promise<unknown>;
}

export interface ApprovalSession {
  /** Random ID. Every button carries it, so an old message cannot approve a newer session. */
  id: string;
  createdAt: number;
  tracker: ActionTracker;
  executor: Toolexecuter;
  pending: ActionLog[];
  /** True only after the COMPLETE review text was sent to the user. */
  reviewed: boolean;
  /** True while changes are being applied (blocks double presses). */
  busy: boolean;
  /** True once any part was applied, so messages stay truthful. */
  applied: boolean;
}

/** One pending approval per chat. */
export const approvalSessions = new Map<number, ApprovalSession>();

// ---------- helpers ----------

export const fileActions = (pending: ActionLog[]) =>
  pending.filter((a) => a.type !== "tool_execute");
export const shellActions = (pending: ActionLog[]) =>
  pending.filter((a) => a.type === "tool_execute");

function groupPending(pending: ActionLog[]) {
  const files = new Map<string, ActionLog[]>();
  for (const a of fileActions(pending)) {
    if (!files.has(a.path)) files.set(a.path, []);
    files.get(a.path)!.push(a);
  }
  return { files, shells: shellActions(pending) };
}

/** Flags characters that can make text look different from what it is. */
function flagOddText(s: string): string {
  return /[^\x20-\x7E\n\t]/.test(s)
    ? "\n⚠️ WARNING: contains non-ASCII or hidden characters. Read it carefully."
    : "";
}

/**
 * The COMPLETE review: every diff in full, every shell command in full.
 * Nothing is cut. If it is long, sendLong() delivers it as a file.
 */
export function reviewText(pending: ActionLog[]): string {
  const { files, shells } = groupPending(pending);
  const parts: string[] = [];

  for (const [filePath, actions] of files) {
    const sorted = [...actions].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    if (sorted.every((a) => a.type === "folder_create")) {
      parts.push(`📁 Create folder: ${filePath}${flagOddText(filePath)}`);
      continue;
    }
    const { before, after } = composeBeforeAfter(sorted);
    parts.push(formatPatch(filePath, before, after) + flagOddText(filePath));
  }

  shells.forEach((s, i) => {
    const cmd = s.details.command ?? "(no command)";
    parts.push(
      `🖥 Shell command ${i + 1} (runs inside the Docker sandbox):\n${cmd}${flagOddText(cmd)}`,
    );
  });

  return parts.join("\n\n").trim();
}

export function approvalSummary(pending: ActionLog[]): string {
  const { files, shells } = groupPending(pending);
  return [
    "Staged changes need your approval",
    "",
    `📄 ${files.size} file/folder path(s) changed`,
    `🖥 ${shells.length} shell command(s) queued`,
    "",
    "Press Review to see everything, in full. Apply buttons appear only after that.",
  ].join("\n");
}

export function approvalKeyboard(s: ApprovalSession) {
  const rows = [];
  if (!s.reviewed) {
    rows.push([Markup.button.callback("📋 Review all changes", `approval_review:${s.id}`)]);
  } else {
    if (fileActions(s.pending).length > 0) {
      rows.push([Markup.button.callback("✅ Apply file changes", `approval_files:${s.id}`)]);
    }
    if (shellActions(s.pending).length > 0) {
      rows.push([Markup.button.callback("▶️ Run shell commands (sandbox)", `approval_shell:${s.id}`)]);
    }
  }
  rows.push([Markup.button.callback("❌ Reject all", `approval_reject:${s.id}`)]);
  return Markup.inlineKeyboard(rows);
}

/** Most messages we will send as a fallback before refusing ("too big to review"). */
export const MAX_CHUNKS = 12;

/** Splits text into pieces that fit in one message. Nothing is dropped. */
export function chunkText(text: string, size = INLINE_LIMIT): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size / 2) cut = size; // no good line break
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Sends text in full. Never cuts anything.
 *  - short: one message
 *  - long: a file; if the upload fails, a series of messages
 *  - too long for both: throws, so the caller can refuse instead of showing a partial review
 */
export async function sendLong(ctx: Replier, text: string, filename: string) {
  if (text.length <= INLINE_LIMIT) {
    await ctx.reply(text);
    return;
  }
  try {
    await ctx.replyWithDocument({ source: Buffer.from(text, "utf8"), filename });
    return;
  } catch (e) {
    console.error("File upload failed, falling back to messages:", (e as Error).message);
  }
  const chunks = chunkText(text);
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`Too large to show in full (${text.length} characters)`);
  }
  for (const c of chunks) await ctx.reply(c);
}

// ---------- session lifecycle ----------

function dropSession(chatId: number, s: ApprovalSession) {
  for (const a of s.pending) s.tracker.updateStatus(a.id, "rejected", false);
  s.executor.clearStaging();
  approvalSessions.delete(chatId);
}

/** Returns the session only if the ID matches and it has not expired. */
export function getSession(chatId: number, id: string, now = Date.now()) {
  const s = approvalSessions.get(chatId);
  if (!s) return undefined;
  if (now - s.createdAt > APPROVAL_TTL_MS) {
    dropSession(chatId, s);
    return undefined;
  }
  return s.id === id ? s : undefined;
}

export function hasPendingApproval(chatId: number, now = Date.now()): boolean {
  const s = approvalSessions.get(chatId);
  if (!s) return false;
  if (now - s.createdAt > APPROVAL_TTL_MS) {
    dropSession(chatId, s);
    return false;
  }
  return true;
}

export async function finishOrApprove(
  ctx: TextReplier,
  chatId: number,
  tracker: ActionTracker,
  executor: Toolexecuter,
  noChangesMsg: string,
) {
  const pending = tracker.getPendingMutations();
  if (pending.length === 0) {
    await ctx.reply(noChangesMsg);
    return;
  }

  // Never leave an older session alive next to a new one.
  const old = approvalSessions.get(chatId);
  if (old) dropSession(chatId, old);

  const session: ApprovalSession = {
    id: randomBytes(6).toString("hex"),
    createdAt: Date.now(),
    tracker,
    executor,
    pending,
    reviewed: false,
    busy: false,
    applied: false,
  };
  approvalSessions.set(chatId, session);
  await ctx.reply(approvalSummary(pending), { ...approvalKeyboard(session) });
}