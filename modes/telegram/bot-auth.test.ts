import { afterEach, beforeEach, expect, test } from "bun:test";
import { Telegram } from "telegraf";
import { buildBot } from "./bot";
import { approvalSessions } from "./approval-sessions";

const OWNER = 111;
const STRANGER = 999;
const BOT_INFO = { id: 1, is_bot: true, first_name: "t", username: "t_bot" } as any;

// Replace the network call: record the method name, send nothing.
let calls: string[] = [];
const realCallApi = Telegram.prototype.callApi;
beforeEach(() => {
  calls = [];
  approvalSessions.clear();
  (Telegram.prototype as any).callApi = async (method: string) => {
    calls.push(method);
    return true;
  };
});
afterEach(() => {
  (Telegram.prototype as any).callApi = realCallApi;
});

function makeBot() {
  const bot = buildBot("123:fake", OWNER);
  bot.botInfo = BOT_INFO;
  return bot;
}

const user = (id: number) => ({ id, is_bot: false, first_name: "x" });
const chat = (id: number, type = "private") => ({ id, type, first_name: "x" });

function command(from: number, chatId: number, text: string, type = "private") {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      from: user(from),
      chat: chat(chatId, type),
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }],
    },
  } as any;
}

function button(from: number, chatId: number, data: string) {
  return {
    update_id: 2,
    callback_query: {
      id: "1",
      from: user(from),
      chat_instance: "x",
      data,
      message: { message_id: 1, date: 0, chat: chat(chatId), text: "x" },
    },
  } as any;
}

const SID = "aaaaaaaaaaaa"; // approval buttons now carry the session ID

function fakeSession() {
  const log: string[] = [];
  const session = {
    id: SID,
    createdAt: Date.now(),
    reviewed: true, // so a stranger WOULD be able to apply if the owner check failed
    busy: false,
    tracker: { updateStatus: () => log.push("status") },
    executor: {
      applyApprovedFromTracker: () => {
        log.push("applied");
        return { errors: [], shellResults: [] };
      },
      clearStaging: () => log.push("cleared"),
    },
    pending: [{ id: "a1", type: "file_modify", path: "a.ts", details: {}, status: "pending" }],
  } as any;
  return { session, log };
}

test("control: owner command gets a reply (proves the test setup works)", async () => {
  await makeBot().handleUpdate(command(OWNER, OWNER, "/agent"));
  expect(calls).toContain("sendMessage");
});

test("control: owner can press Reject", async () => {
  const { session, log } = fakeSession();
  approvalSessions.set(OWNER, session);
  await makeBot().handleUpdate(button(OWNER, OWNER, `approval_reject:${SID}`));
  expect(log).toContain("cleared");
  expect(approvalSessions.has(OWNER)).toBe(false);
});

test("stranger command is ignored", async () => {
  await makeBot().handleUpdate(command(STRANGER, STRANGER, "/agent delete everything"));
  expect(calls).toEqual([]);
});

test("stranger cannot press Accept, even when the update carries the owner's chat ID", async () => {
  const { session, log } = fakeSession();
  approvalSessions.set(OWNER, session);
  await makeBot().handleUpdate(button(STRANGER, OWNER, `approval_files:${SID}`));
  expect(log).toEqual([]); // nothing applied
  expect(approvalSessions.has(OWNER)).toBe(true); // session untouched
  expect(calls).toEqual([]);
});

test("owner inside a group is ignored (private chat only)", async () => {
  await makeBot().handleUpdate(command(OWNER, -100123, "/agent", "group"));
  expect(calls).toEqual([]);
});