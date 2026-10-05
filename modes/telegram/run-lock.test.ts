import { beforeEach, expect, test } from "bun:test";
import { DeadlineError, finish, isRunning, runLocked, runWithDeadline, tryStart } from "./run-lock";

const CHAT = 4242;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => finish(CHAT));

test("a hung task is stopped at the deadline and the lock is released", async () => {
  expect(tryStart(CHAT)).toBe(true);
  let signalSeen: AbortSignal | undefined;
  const errors: unknown[] = [];

  runLocked(
    CHAT,
    (signal) => {
      signalSeen = signal;
      return new Promise(() => {}); // never finishes, like a hung model call
    },
    (e) => void errors.push(e),
    50,
  );

  expect(isRunning(CHAT)).toBe(true); // still locked while it runs
  await sleep(200);
  expect(isRunning(CHAT)).toBe(false); // released by the deadline
  expect(errors[0]).toBeInstanceOf(DeadlineError);
  expect(signalSeen!.aborted).toBe(true);
  expect(tryStart(CHAT)).toBe(true); // the next task can start
});

test("a task that ignores the signal and finishes late sees that it was aborted", async () => {
  let abortedWhenItWoke: boolean | undefined;
  tryStart(CHAT);
  runLocked(
    CHAT,
    async (signal) => {
      await sleep(150);
      abortedWhenItWoke = signal.aborted; // a real task checks this and stays silent
    },
    () => {},
    50,
  );
  await sleep(300);
  expect(abortedWhenItWoke).toBe(true);
  expect(isRunning(CHAT)).toBe(false);
});

test("a failing task releases the lock and reports the error", async () => {
  tryStart(CHAT);
  const errors: unknown[] = [];
  runLocked(CHAT, async () => { throw new Error("boom"); }, (e) => void errors.push(e));
  await sleep(50);
  expect(isRunning(CHAT)).toBe(false);
  expect((errors[0] as Error).message).toBe("boom");
});

test("if reporting the error itself fails, the lock is still released", async () => {
  tryStart(CHAT);
  runLocked(CHAT, async () => { throw new Error("boom"); }, async () => { throw new Error("cannot reply"); });
  await sleep(50);
  expect(isRunning(CHAT)).toBe(false);
});

test("a task that finishes in time releases the lock and reports nothing", async () => {
  tryStart(CHAT);
  const errors: unknown[] = [];
  runLocked(CHAT, async () => "ok", (e) => void errors.push(e), 1000);
  await sleep(50);
  expect(isRunning(CHAT)).toBe(false);
  expect(errors).toEqual([]);
});

test("runWithDeadline returns the value of a task that finishes in time", async () => {
  await expect(runWithDeadline(async () => 7, 1000)).resolves.toBe(7);
});

test("runWithDeadline rejects with DeadlineError for a task that never ends", async () => {
  await expect(runWithDeadline(() => new Promise(() => {}), 30)).rejects.toBeInstanceOf(DeadlineError);
});

test("a second task cannot start while the first holds the lock", () => {
  expect(tryStart(CHAT)).toBe(true);
  expect(tryStart(CHAT)).toBe(false);
});