import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { Telegram } from "telegraf";
import { buildBot } from "./bot";
import { ActionTracker } from "../agent/action-tracker";
import {
  APPROVAL_TTL_MS,
  MAX_CHUNKS,
  approvalSessions,
  chunkText,
  finishOrApprove,
  reviewText,
  sendLong,
  type Replier,
} from "./approval-sessions";
import { newPlanSession, planSessions } from "./plan-sessions";
import { finish, isRunning, tryStart } from "./run-lock";

const OWNER = 111;
const BOT_INFO = { id: 1, is_bot: true, first_name: "t", username: "t_bot" } as any;

// ---------- harness: record every Telegram API call, send nothing ----------

type Call = { method: string; payload: any };
let calls: Call[] = [];
const realCallApi = Telegram.prototype.callApi;

beforeEach(() => {
  calls = [];
  approvalSessions.clear();
  planSessions.clear();
  finish(OWNER);
  (Telegram.prototype as any).callApi = async (method: string, payload: any) => {
    calls.push({ method, payload });
    return true;
  };
});
afterEach(() => {
  (Telegram.prototype as any).callApi = realCallApi;
});

const makeBot = () => {
  const bot = buildBot("123:fake", OWNER);
  bot.botInfo = BOT_INFO;
  return bot;
};

const user = (id: number) => ({ id, is_bot: false, first_name: "x" });
const chat = (id: number) => ({ id, type: "private", first_name: "x" });

const button = (data: string) =>
  ({
    update_id: 1,
    callback_query: {
      id: "1",
      from: user(OWNER),
      chat_instance: "x",
      data,
      message: { message_id: 1, date: 0, chat: chat(OWNER), text: "x" },
    },
  }) as any;

const command = (text: string) =>
  ({
    update_id: 2,
    message: {
      message_id: 1,
      date: 0,
      from: user(OWNER),
      chat: chat(OWNER),
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }],
    },
  }) as any;

const methods = () => calls.map((c) => c.method);
const alerts = () =>
  calls.filter((c) => c.method === "answerCallbackQuery" && c.payload?.show_alert);

// ---------- fake staged work ----------

type Staged = { files?: number; shells?: string[]; fileContent?: string };

/** Creates a real approval session through finishOrApprove, like the agent does. */
async function stage({ files = 1, shells = [], fileContent = "new" }: Staged = {}) {
  const tracker = new ActionTracker();
  for (let i = 0; i < files; i++) {
    tracker.log({
      type: "file_modify",
      path: `src/file${i}.ts`,
      details: { before: "old", after: fileContent },
      status: "pending",
    });
  }
  for (const command of shells) {
    tracker.log({ type: "tool_execute", path: "shell", details: { command }, status: "pending" });
  }
  const applied: string[][] = [];
  const executor = {
    applyApprovedFromTracker: () => {
      const approved = tracker.getActions().filter((a) => a.status === "approved");
      applied.push(approved.map((a) => a.type));
      return {
        errors: [] as string[],
        shellResults: approved
          .filter((a) => a.type === "tool_execute")
          .map((a) => ({ command: a.details.command!, exitCode: 0, output: "ok" })),
      };
    },
    clearStaging: () => {},
  } as any;

  const sent: string[] = [];
  const ctx: Replier = {
    reply: async (t) => void sent.push(t),
    replyWithDocument: async () => {},
  };
  await finishOrApprove(ctx, OWNER, tracker, executor, "nothing");
  const session = approvalSessions.get(OWNER)!;
  return { session, applied, tracker };
}

// ---------- 1. Stale approvals ----------

test("an old Accept button cannot apply a newer session's changes", async () => {
  const first = await stage();
  const second = await stage({ files: 2 }); // replaces the first
  expect(first.session.id).not.toBe(second.session.id);

  const bot = makeBot();
  await bot.handleUpdate(button(`approval_review:${first.session.id}`));
  await bot.handleUpdate(button(`approval_files:${first.session.id}`));

  expect(alerts().length).toBeGreaterThan(0); // "Expired or replaced"
  expect(second.applied).toEqual([]);
  expect(first.applied).toEqual([]);
});

test("the current session's buttons do work (control)", async () => {
  const s = await stage();
  const bot = makeBot();
  await bot.handleUpdate(button(`approval_review:${s.session.id}`));
  await bot.handleUpdate(button(`approval_files:${s.session.id}`));
  expect(s.applied).toEqual([["file_modify"]]);
});

test("a session that waited too long is refused and its changes dropped", async () => {
  const s = await stage();
  s.session.createdAt = Date.now() - APPROVAL_TTL_MS - 1;
  await makeBot().handleUpdate(button(`approval_review:${s.session.id}`));
  expect(alerts().length).toBeGreaterThan(0);
  expect(approvalSessions.has(OWNER)).toBe(false);
  expect(s.applied).toEqual([]);
});

test("a button with a made-up ID does nothing", async () => {
  const s = await stage();
  await makeBot().handleUpdate(button("approval_files:aaaaaaaaaaaa"));
  expect(s.applied).toEqual([]);
  expect(approvalSessions.has(OWNER)).toBe(true);
});

test("a new /agent is refused while changes are waiting for approval", async () => {
  await stage();
  await makeBot().handleUpdate(command("/agent do something"));
  const texts = calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text);
  expect(texts.some((t) => /waiting for approval/.test(t))).toBe(true);
  expect(texts.some((t) => /Agent is working/.test(t))).toBe(false);
  expect(isRunning(OWNER)).toBe(false);
});

test("run lock: second start is refused until the first finishes", () => {
  expect(tryStart(OWNER)).toBe(true);
  expect(tryStart(OWNER)).toBe(false);
  finish(OWNER);
  expect(tryStart(OWNER)).toBe(true);
});

test("an old plan message cannot proceed or change a newer plan", async () => {
  const mk = () => ({
    goal: "g",
    steps: [{ id: "step-1", title: "a", description: "d" }, { id: "step-2", title: "b", description: "d" }],
  });
  const oldPlan = newPlanSession(mk());
  const newPlan = newPlanSession(mk());
  planSessions.set(OWNER, newPlan); // the old one was overwritten

  const bot = makeBot();
  await bot.handleUpdate(button(`plan_toggle:${oldPlan.id}:step-1`));
  await bot.handleUpdate(button(`plan_none:${oldPlan.id}`));
  await bot.handleUpdate(button(`plan_proceed:${oldPlan.id}`));

  expect(alerts().length).toBe(3);
  expect([...newPlan.selected].sort()).toEqual(["step-1", "step-2"]); // untouched
  expect(isRunning(OWNER)).toBe(false); // nothing started
});

// ---------- 2. Approving what you did not see ----------

test("review text contains the WHOLE change, nothing cut", async () => {
  const huge = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n") + "\nLAST-LINE-MARKER";
  const longCommand = "echo " + "x".repeat(6000) + " && echo END-OF-COMMAND";
  const s = await stage({ fileContent: huge, shells: [longCommand] });
  const text = reviewText(s.session.pending);
  expect(text).toContain("LAST-LINE-MARKER");
  expect(text).toContain("END-OF-COMMAND");
  expect(text.length).toBeGreaterThan(40_000);
});

test("long text is sent as a file with the full content, short text inline", async () => {
  const sent: { kind: string; body: string }[] = [];
  const ctx: Replier = {
    reply: async (t) => void sent.push({ kind: "text", body: t }),
    replyWithDocument: async (d) => void sent.push({ kind: "file", body: d.source.toString("utf8") }),
  };
  await sendLong(ctx, "short", "x.txt");
  const long = "y".repeat(10_000) + "THE-END";
  await sendLong(ctx, long, "x.txt");
  expect(sent[0]).toEqual({ kind: "text", body: "short" });
  expect(sent[1]!.kind).toBe("file");
  expect(sent[1]!.body).toBe(long);
});

test("nothing can be applied before the full review was sent", async () => {
  const s = await stage({ shells: ["echo hi"] });
  const bot = makeBot();
  await bot.handleUpdate(button(`approval_files:${s.session.id}`));
  await bot.handleUpdate(button(`approval_shell:${s.session.id}`));
  expect(s.applied).toEqual([]);
  expect(alerts().length).toBe(2);
});

test("hidden or non-ASCII characters in a command are flagged", async () => {
  const s = await stage({ files: 0, shells: ["echo safe\u202e ; rm -rf ~"] });
  expect(reviewText(s.session.pending)).toContain("WARNING");
});

test("file changes and shell commands are approved separately", async () => {
  const s = await stage({ files: 1, shells: ["echo hi"] });
  const bot = makeBot();
  await bot.handleUpdate(button(`approval_review:${s.session.id}`));

  await bot.handleUpdate(button(`approval_files:${s.session.id}`));
  expect(s.applied).toEqual([["file_modify"]]); // shell NOT run
  expect(approvalSessions.has(OWNER)).toBe(true); // still waiting for the shell decision

  await bot.handleUpdate(button(`approval_shell:${s.session.id}`));
  expect(s.applied).toEqual([["file_modify"], ["tool_execute"]]); // file NOT re-applied
  expect(approvalSessions.has(OWNER)).toBe(false);
});

test("shell output is sent back to the user", async () => {
  const s = await stage({ files: 0, shells: ["echo hi"] });
  const bot = makeBot();
  await bot.handleUpdate(button(`approval_review:${s.session.id}`));
  await bot.handleUpdate(button(`approval_shell:${s.session.id}`));
  const texts = calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text);
  expect(texts.some((t) => t.includes("$ echo hi") && t.includes("exit: 0"))).toBe(true);
});

test("Reject drops everything", async () => {
  const s = await stage({ files: 1, shells: ["echo hi"] });
  await makeBot().handleUpdate(button(`approval_reject:${s.session.id}`));
  expect(s.applied).toEqual([]);
  expect(approvalSessions.has(OWNER)).toBe(false);
  expect(methods()).toContain("editMessageText");
});

// ---------- 3. Web tools next to shell ----------

test("the agent that can stage shell commands gets no web tools (Telegram plan execution)", () => {
  const src = fs.readFileSync(path.join(import.meta.dir, "agent-run.ts"), "utf8");
  const start = src.indexOf("export async function runPlanSteps");
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start + 10);
  const next = rest.indexOf("\nexport ");
  const body = next === -1 ? rest : rest.slice(0, next);
  expect(body).not.toMatch(/extraWebTools|createWebTools/);
});

test("the agent that can stage shell commands gets no web tools (CLI plan execution)", () => {
  const src = fs.readFileSync(path.join(import.meta.dir, "..", "plan", "orchestrator.ts"), "utf8");
  expect(src).not.toMatch(/createWebTools|web-tools/);
});

// ---------- 4. The review must actually reach you ----------

test("chunkText drops nothing and respects the size limit", () => {
  const text = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
  const chunks = chunkText(text, 3500);
  expect(chunks.join("")).toBe(text);
  expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(3500);
});

test("if the file upload fails, the full text is sent as messages instead", async () => {
  const sent: string[] = [];
  const ctx: Replier = {
    reply: async (t) => void sent.push(t),
    replyWithDocument: async () => {
      throw new Error("upload failed");
    },
  };
  const text = Array.from({ length: 1000 }, (_, i) => `row ${i}`).join("\n") + "\nTHE-END";
  await sendLong(ctx, text, "x.diff");
  expect(sent.join("")).toBe(text);
});

test("if the text is too big for a file AND for messages, it refuses instead of cutting", async () => {
  const ctx: Replier = {
    reply: async () => {},
    replyWithDocument: async () => {
      throw new Error("upload failed");
    },
  };
  const text = "z".repeat(3500 * (MAX_CHUNKS + 2));
  await expect(sendLong(ctx, text, "x.diff")).rejects.toThrow(/too large/i);
});

/** A local stand-in for api.telegram.org that records uploads. */
function fakeTelegram(opts: { failDocument?: boolean } = {}) {
  const uploads: { filename: boolean; marker: boolean; bytes: number }[] = [];
  const server = Bun.serve({
    port: 0,
    idleTimeout: 5,
    async fetch(req) {
      const url = new URL(req.url);
      const body = new Uint8Array(await req.arrayBuffer());
      if (url.pathname.endsWith("/sendDocument")) {
        const text = new TextDecoder().decode(body);
        uploads.push({
          filename: text.includes('filename="changes.diff"'),
          marker: text.includes("END-OF-REVIEW-MARKER"),
          bytes: body.length,
        });
        if (opts.failDocument) {
          return Response.json({ ok: false, description: "Bad Request: nope" }, { status: 400 });
        }
      }
      return Response.json({ ok: true, result: true });
    },
  });
  return { server, uploads, apiRoot: `http://localhost:${server.port}` };
}

test("REAL upload: a big review arrives as a file through real HTTP, complete", async () => {
  (Telegram.prototype as any).callApi = realCallApi; // use the real network code
  const fake = fakeTelegram();
  try {
    const huge = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n") + "\nEND-OF-REVIEW-MARKER";
    const s = await stage({ fileContent: huge });
    const bot = buildBot("123:fake", OWNER, { telegram: { apiRoot: fake.apiRoot } });
    bot.botInfo = BOT_INFO;
    await bot.handleUpdate(button(`approval_review:${s.session.id}`));

    expect(fake.uploads.length).toBe(1);
    expect(fake.uploads[0]!.filename).toBe(true);
    expect(fake.uploads[0]!.marker).toBe(true); // the LAST line made it
    expect(s.session.reviewed).toBe(true);
  } finally {
    fake.server.stop(true);
  }
}, 20_000);

test("REAL upload fails and the review is too big for messages: nothing can be applied", async () => {
  (Telegram.prototype as any).callApi = realCallApi;
  const fake = fakeTelegram({ failDocument: true });
  try {
    const huge = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join("\n");
    const s = await stage({ fileContent: huge });
    const bot = buildBot("123:fake", OWNER, { telegram: { apiRoot: fake.apiRoot } });
    bot.botInfo = BOT_INFO;
    await bot.handleUpdate(button(`approval_review:${s.session.id}`));
    expect(s.session.reviewed).toBe(false);

    await bot.handleUpdate(button(`approval_files:${s.session.id}`));
    expect(s.applied).toEqual([]);
  } finally {
    fake.server.stop(true);
  }
}, 20_000);

test("Reject after applying is honest: it says what stays applied", async () => {
  const s = await stage({ files: 1, shells: ["echo hi"] });
  const bot = makeBot();
  await bot.handleUpdate(button(`approval_review:${s.session.id}`));
  await bot.handleUpdate(button(`approval_files:${s.session.id}`));
  await bot.handleUpdate(button(`approval_reject:${s.session.id}`));
  const edits = calls.filter((c) => c.method === "editMessageText").map((c) => c.payload.text);
  expect(edits.at(-1)).toMatch(/already applied/);
  expect(edits.at(-1)).not.toMatch(/Nothing was applied/);
});