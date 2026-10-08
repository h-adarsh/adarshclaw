import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Toolexecuter } from "./tool-executer";
import { ActionTracker } from "./action-tracker";
import { defaultAgentConfig } from "./types";

// A fake `docker` that changes files in the workspace mount, like a shell command would.
// It lets us test the change report without Docker.
const FAKE_DOCKER = `#!/bin/sh
WS=""
for a in "$@"; do
  case "$a" in
    type=bind,src=*)
      src="\${a#type=bind,src=}"; src="\${src%%,*}"
      if [ -z "$WS" ]; then WS="$src"; fi
      ;;
  esac
done
printf 'created' > "$WS/created-by-command.txt"
printf 'changed' > "$WS/existing.txt"
rm -f "$WS/doomed.txt"
exit 0
`;

let base = "";
let ws = "";
let fake = "";

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claw-chg-")));
  ws = path.join(base, "proj");
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, "existing.txt"), "old");
  fs.writeFileSync(path.join(ws, "doomed.txt"), "bye");
  fs.writeFileSync(path.join(ws, ".gitignore"), "*\n"); // git would hide everything
  fake = path.join(base, "fake-docker");
  fs.writeFileSync(fake, FAKE_DOCKER);
  fs.chmodSync(fake, 0o755);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

function approveAndApply(ex: Toolexecuter, tracker: ActionTracker) {
  for (const a of tracker.getPendingMutations()) tracker.updateStatus(a.id, "approved", true);
  return ex.applyApprovedFromTracker();
}

test("the report lists what the shell commands changed, even in a folder git would ignore", () => {
  const tracker = new ActionTracker();
  const ex = new Toolexecuter(tracker, { ...defaultAgentConfig(), codebasePath: ws, sandboxDockerBin: fake });
  ex.queueShell("anything");
  const r = approveAndApply(ex, tracker);

  expect(r.errors).toEqual([]);
  expect(r.changes!.added).toContain("created-by-command.txt");
  expect(r.changes!.modified).toContain("existing.txt");
  expect(r.changes!.deleted).toContain("doomed.txt");
  expect(r.diff).toContain("+ created-by-command.txt");
  expect(r.diff).toContain("- doomed.txt");
});

test("approved file changes are not blamed on the shell", () => {
  const tracker = new ActionTracker();
  const ex = new Toolexecuter(tracker, { ...defaultAgentConfig(), codebasePath: ws, sandboxDockerBin: fake });
  ex.createFile("staged-by-agent.txt", "from the file tool");
  ex.queueShell("anything");
  const r = approveAndApply(ex, tracker);
  expect(fs.existsSync(path.join(ws, "staged-by-agent.txt"))).toBe(true);
  expect(r.changes!.added).not.toContain("staged-by-agent.txt");
});

test("no report when the command never ran (Docker missing)", () => {
  const tracker = new ActionTracker();
  const ex = new Toolexecuter(tracker, { ...defaultAgentConfig(), codebasePath: ws, sandboxDockerBin: "no-such-docker-binary" });
  ex.queueShell("anything");
  const r = approveAndApply(ex, tracker);
  expect(r.errors.length).toBe(1);
  expect(r.diff).toBeUndefined();
});

test("the executor starts no external program on the host (no git, no shell)", () => {
  const src = fs.readFileSync(path.join(import.meta.dir, "tool-executer.ts"), "utf8");
  expect(src).not.toMatch(/child_process|execSync|execFileSync|spawn/);
});