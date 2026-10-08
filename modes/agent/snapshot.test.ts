import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffSnapshots, formatChanges, takeSnapshot } from "./snapshot";

let ws = "";
const w = (rel: string, content: string) => {
  const p = path.join(ws, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
};

beforeEach(() => {
  ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claw-snap-")));
});
afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

function run(change: () => void, options = {}) {
  const before = takeSnapshot(ws, options);
  change();
  const after = takeSnapshot(ws, options);
  const changes = diffSnapshots(before, after);
  return { before, after, changes, report: formatChanges(before, after, changes) };
}

test("detects added, modified and deleted files", () => {
  w("keep.txt", "same");
  w("edit.txt", "old");
  w("gone.txt", "bye");
  const { changes } = run(() => {
    w("new.txt", "hello");
    w("edit.txt", "new");
    fs.rmSync(path.join(ws, "gone.txt"));
  });
  expect(changes.added).toEqual(["new.txt"]);
  expect(changes.modified).toEqual(["edit.txt"]);
  expect(changes.deleted).toEqual(["gone.txt"]);
});

test("a file hidden by .gitignore is still reported (git diff would miss it)", () => {
  w(".gitignore", "*\n");
  const { changes } = run(() => w("secret-backdoor.js", "evil"));
  expect(changes.added).toContain("secret-backdoor.js");
});

test("works in a folder that is not a git repository", () => {
  expect(fs.existsSync(path.join(ws, ".git"))).toBe(false);
  const { report } = run(() => w("a.txt", "x"));
  expect(report).toContain("+ a.txt");
});

test("restoring the modification time does not hide a content change", () => {
  const p = w("tricky.txt", "original");
  const old = fs.statSync(p);
  const { changes } = run(() => {
    fs.writeFileSync(p, "tampered"); // same size as "original": 8 characters
    fs.utimesSync(p, old.atime, old.mtime); // put the old time back
  });
  expect(changes.modified).toEqual(["tricky.txt"]);
});

test("a permission change (chmod +x) is reported", () => {
  const p = w("run.sh", "echo hi");
  fs.chmodSync(p, 0o644);
  const { changes } = run(() => fs.chmodSync(p, 0o755));
  expect(changes.modified).toEqual(["run.sh"]);
});

test("a new symlink and a new empty folder are reported", () => {
  const { changes, report } = run(() => {
    fs.symlinkSync("/etc/passwd", path.join(ws, "link"));
    fs.mkdirSync(path.join(ws, "emptydir"));
  });
  expect(changes.added.sort()).toEqual(["emptydir", "link"]);
  expect(report).toContain("symlink");
  expect(report).toContain("/etc/passwd");
});

test("changes inside .git and node_modules are not read (they are read-only in the sandbox)", () => {
  w(".git/config", "[core]");
  w("node_modules/pkg/index.js", "a");
  const { changes } = run(() => {
    w(".git/config", "[core] changed");
    w("node_modules/pkg/index.js", "b");
  });
  expect(changes).toEqual({ added: [], modified: [], deleted: [], partial: false });
});

test("the report shows the content of a changed text file", () => {
  w("a.txt", "line one\n");
  const { report } = run(() => w("a.txt", "line one\nline two\n"));
  expect(report).toContain("+line two");
});

test("binary files are listed but their content is not shown", () => {
  const { report, changes } = run(() => fs.writeFileSync(path.join(ws, "b.bin"), Buffer.from([1, 2, 0, 3])));
  expect(changes.added).toEqual(["b.bin"]);
  expect(report).toContain("content not shown");
});

test("a file name or file content with escape sequences cannot reach the terminal", () => {
  const { report } = run(() => {
    w("evil\u001b[2K.txt", "hello \u001b[8mhidden\r\nreal");
  });
  expect(report).not.toContain("\u001b");
  expect(report).not.toContain("\r");
  expect(report).toContain("\\u{001b}");
});

test("no change is reported clearly", () => {
  w("a.txt", "x");
  const { report, changes } = run(() => {});
  expect(changes.added.length + changes.modified.length + changes.deleted.length).toBe(0);
  expect(report).toContain("changed no files");
});

test("a workspace bigger than the limit is flagged as incomplete, never silently cut", () => {
  for (let i = 0; i < 20; i++) w(`f${i}.txt`, String(i));
  const { changes, report } = run(() => w("zz-last.txt", "x"), { maxEntries: 10 });
  expect(changes.partial).toBe(true);
  expect(report).toContain("INCOMPLETE");
});

test("the list of changed paths stays complete even when the detail output is cut", () => {
  const big = "x".repeat(60_000);
  for (let i = 0; i < 6; i++) w(`big${i}.txt`, "a");
  const { changes, report } = run(
    () => {
      for (let i = 0; i < 6; i++) w(`big${i}.txt`, big + i);
    },
    { maxTextBytes: 200_000 },
  );
  expect(changes.modified.length).toBe(6);
  for (let i = 0; i < 6; i++) expect(report).toContain(`~ big${i}.txt`);
  expect(report).toContain("not shown in detail");
});