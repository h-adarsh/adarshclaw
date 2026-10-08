#!/usr/bin/env bun

import {Command} from "commander";
import { checkLaunch, stripLaunchFlag } from "./modes/agent/launch-guard.ts";

// SECURITY: refuse to run from a directory we do not trust unless started by bin/adarshclaw.
// See modes/agent/launch-guard.ts and docs/THREAT_MODEL.md (row 19).
const launch = checkLaunch({ cwd: process.cwd(), projectDir: import.meta.dir, argv: process.argv });
if (!launch.ok) {
  console.error(launch.reason);
  process.exit(1);
}
process.argv = stripLaunchFlag(process.argv);

const program = new Command();

program
  .name("adarshclaw-build")
  .description("A CLI tool for building and managing projects")
  .version("1.0.0");

program
  .command("wakeup")
  .description("Wake up the system")
  .action(async () => {
  const { runWakeup } = await import("./tui/wakeup.js");
  await runWakeup();
});

program.action(async () => {
  const { runWakeup } = await import("./tui/wakeup.js");
  await runWakeup();
});

await program.parseAsync(process.argv);