#!/usr/bin/env bun

import {Command} from "commander";
import {runWakeup} from "./tui/wakeup.js";

const program = new Command();

program
  .name("adarshclaw-build")
  .description("A CLI tool for building and managing projects")
  .version("1.0.0");

program
  .command("wakeup")
  .description("Wake up the system")
  .action(async () => {
  await runWakeup();
});

program.action(async () => {
  await runWakeup();
});

await program.parseAsync(process.argv);