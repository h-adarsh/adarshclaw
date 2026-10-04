import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Toolexecuter } from "./tool-executer";
import { ActionTracker } from "./action-tracker";
import { defaultAgentConfig } from "./types";

let base = "";
let ws = ""; // the workspace the agent is allowed to touch
let outside = ""; // sibling folder with a similar name: "proj" vs "proj-evil"
let tracker: ActionTracker;
let ex: Toolexecuter;

const SECRET = "TOP-SECRET";

function makeExecutor(extra: Record<string, unknown> = {}) {
  tracker = new ActionTracker();
  ex = new Toolexecuter(tracker, { ...defaultAgentConfig(), codebasePath: ws, ...extra });
}

function approveAllAndApply() {
  for (const a of tracker.getPendingMutations()) tracker.updateStatus(a.id, "approved", true);
  return ex.applyApprovedFromTracker();
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "claw-"));
  ws = path.join(base, "proj");
  outside = path.join(base, "proj-evil");
  fs.mkdirSync(ws);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(base, "secret.txt"), SECRET);
  fs.writeFileSync(path.join(outside, "secret.txt"), SECRET);
  fs.writeFileSync(path.join(ws, "ok.txt"), "hello");
  fs.writeFileSync(path.join(ws, ".env"), "KEY=1");
  fs.mkdirSync(path.join(ws, ".git"));
  fs.writeFileSync(path.join(ws, ".git", "config"), "[remote]");
  makeExecutor();
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------- Controls: normal use must keep working ----------

test("control: normal read, list and write still work", () => {
  expect(ex.readFile("ok.txt")).toBe("hello");
  expect(ex.listFiles(".", false)).toContain("ok.txt");
  ex.createFile("sub/new.txt", "data");
  approveAllAndApply();
  expect(fs.readFileSync(path.join(ws, "sub", "new.txt"), "utf8")).toBe("data");
});

test("control: a file whose name starts with '..' is allowed", () => {
  fs.writeFileSync(path.join(ws, "..notes"), "fine");
  expect(ex.readFile("..notes")).toBe("fine");
});

// ---------- Path escapes ----------

test("blocks ../ escape", () => {
  expect(() => ex.readFile("../secret.txt")).toThrow();
});

test("blocks absolute path outside the workspace", () => {
  expect(() => ex.readFile(path.join(outside, "secret.txt"))).toThrow();
});

test("blocks sibling folder with the same prefix (proj vs proj-evil)", () => {
  expect(() => ex.readFile("../proj-evil/secret.txt")).toThrow();
});

test("blocks null byte in path", () => {
  expect(() => ex.readFile("ok.txt\0.png")).toThrow();
});

test("blocks reading through a symlinked file", () => {
  fs.symlinkSync(path.join(base, "secret.txt"), path.join(ws, "link.txt"));
  expect(() => ex.readFile("link.txt")).toThrow();
});

test("blocks reading through a symlinked folder", () => {
  fs.symlinkSync(outside, path.join(ws, "linkdir"));
  expect(() => ex.readFile("linkdir/secret.txt")).toThrow();
});

test("blocks writing through a symlinked folder", () => {
  fs.symlinkSync(outside, path.join(ws, "linkdir"));
  try {
    ex.createFile("linkdir/new.txt", "pwned");
    approveAllAndApply();
  } catch {
    // refusing at staging time is also fine
  }
  expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);
});

test("blocks writing through a dangling symlink", () => {
  fs.symlinkSync(path.join(outside, "ghost.txt"), path.join(ws, "ghost"));
  try {
    ex.createFile("ghost", "pwned");
    approveAllAndApply();
  } catch {
    // refusing at staging time is also fine
  }
  expect(fs.existsSync(path.join(outside, "ghost.txt"))).toBe(false);
});

test("search does not leak content of files behind a symlink", () => {
  fs.symlinkSync(path.join(base, "secret.txt"), path.join(ws, "link.txt"));
  expect(ex.searchFiles(".", "*", SECRET)).not.toContain("link.txt");
});

// ---------- Exclusion rules (.env, .git) ----------

test("blocks .env", () => {
  expect(() => ex.readFile(".env")).toThrow(/excluded/);
});

test("blocks .env in different letter case (macOS is case-insensitive)", () => {
  expect(() => ex.readFile(".ENV")).toThrow(/excluded/);
});

test("blocks .git in different letter case", () => {
  expect(() => ex.readFile(".GIT/config")).toThrow(/excluded/);
});

test("blocks a symlink that points at .env", () => {
  fs.symlinkSync(path.join(ws, ".env"), path.join(ws, "notes.txt"));
  expect(() => ex.readFile("notes.txt")).toThrow(/excluded/);
});

test("wildcard patterns other than *.log and .env* are not silently ignored", () => {
  fs.writeFileSync(path.join(ws, "server.pem"), "KEY");
  makeExecutor({ excludePatterns: ["*.pem"] });
  expect(() => ex.readFile("server.pem")).toThrow(/excluded/);
});