import { expect, test } from "bun:test";
import { ActionTracker } from "./action-tracker";
import { describePending } from "./approval";

function staged() {
  const t = new ActionTracker();
  t.log({ type: "file_modify", path: "src/a.ts", details: { before: "x", after: "y" }, status: "pending" });
  t.log({ type: "folder_create", path: "out", details: { after: "out" }, status: "pending" });
  const longCommand = "echo " + "x".repeat(500) + " && echo END-OF-COMMAND";
  t.log({ type: "tool_execute", path: "shell", details: { command: longCommand }, status: "pending" });
  return { pending: t.getPendingMutations(), longCommand };
}

test("CLI approval lists every file change and the FULL shell command before 'approve all'", () => {
  const { pending, longCommand } = staged();
  const lines = describePending(pending);
  expect(lines.length).toBe(3);
  expect(lines.some((l) => l.startsWith("src/a.ts"))).toBe(true);
  expect(lines.some((l) => l.startsWith("Create folder: out"))).toBe(true);
  expect(lines).toContain(`Shell: ${longCommand}`); // not cut
});

test("CLI approval labels cannot carry escape sequences (a command cannot hide itself)", () => {
  const tr = new ActionTracker();
  tr.log({ type: "tool_execute", path: "shell", details: { command: "echo safe\x1b[2K\rrm -rf ~" }, status: "pending" });
  tr.log({ type: "file_create", path: "evil\x1b[8m.txt", details: { after: "x" }, status: "pending" });
  const lines = describePending(tr.getPendingMutations());
  for (const line of lines) {
    expect(line).not.toContain("\x1b");
    expect(line).not.toContain("\r");
  }
  expect(lines.join("\n")).toContain("rm -rf ~"); // the real command is still fully visible
});