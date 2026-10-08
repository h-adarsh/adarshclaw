import { afterEach, beforeEach, expect, test } from "bun:test";
import { Telegram } from "telegraf";
import { buildBot } from "./bot";
import { approvalSessions } from "./approval-sessions";

const OWNER = 111;
const BOT_INFO = { id: 1, is_bot: true, first_name: "t", username: "t_bot" } as any;

type Call = { method: string; payload: any };
let calls: Call[] = [];
const realCallApi = Telegram.prototype.callApi;

beforeEach(() => {
  calls = [];
  approvalSessions.clear();
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
const user = { id: OWNER, is_bot: false, first_name: "x" };
const chat = { id: OWNER, type: "private", first_name: "x" };

test("every message the bot sends has link previews turned off", async () => {
  await makeBot().handleUpdate({
    update_id: 1,
    message: {
      message_id: 1, date: 0, from: user, chat, text: "/start",
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  } as any);
  const sent = calls.filter((c) => c.method === "sendMessage");
  expect(sent.length).toBeGreaterThan(0);
  for (const c of sent) expect(c.payload.link_preview_options?.is_disabled).toBe(true);
});

test("edited messages have link previews turned off too", async () => {
  approvalSessions.set(OWNER, {
    id: "aaaaaaaaaaaa", createdAt: Date.now(), reviewed: true, busy: false, applied: false,
    tracker: { updateStatus: () => {} },
    executor: { clearStaging: () => {} },
    pending: [],
  } as any);
  await makeBot().handleUpdate({
    update_id: 2,
    callback_query: {
      id: "1", from: user, chat_instance: "x", data: "approval_reject:aaaaaaaaaaaa",
      message: { message_id: 1, date: 0, chat, text: "x" },
    },
  } as any);
  const edits = calls.filter((c) => c.method === "editMessageText");
  expect(edits.length).toBeGreaterThan(0);
  for (const c of edits) expect(c.payload.link_preview_options?.is_disabled).toBe(true);
});

test("other API calls are not changed", async () => {
  approvalSessions.set(OWNER, {
    id: "bbbbbbbbbbbb", createdAt: Date.now(), reviewed: true, busy: false, applied: false,
    tracker: { updateStatus: () => {} }, executor: { clearStaging: () => {} }, pending: [],
  } as any);
  await makeBot().handleUpdate({
    update_id: 3,
    callback_query: {
      id: "1", from: user, chat_instance: "x", data: "approval_reject:bbbbbbbbbbbb",
      message: { message_id: 1, date: 0, chat, text: "x" },
    },
  } as any);
  const answers = calls.filter((c) => c.method === "answerCallbackQuery");
  expect(answers.length).toBeGreaterThan(0);
  for (const c of answers) expect(c.payload.link_preview_options).toBeUndefined();
});