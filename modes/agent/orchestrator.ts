import { text, isCancel } from "@clack/prompts";
import chalk from "chalk";
import { defaultAgentConfig } from "./types";
import { ActionTracker } from "./action-tracker";
import {Toolexecuter} from './tool-executer';
import { createAgentTools } from "./agent-tools";
import { stepCountIs, ToolLoopAgent } from "ai";
import { getAgentModel } from "../../ai";
import { renderTerminalMarkdown } from "../../tui/terminal-md";
import { runApprovalFlow } from "./approval";
import { assertToolSetIsSafe } from "./tool-policy";
import { tokenBudgetExceeded } from "./run-limits";

export async function runAgentMode() {
  console.log(chalk.green("Running in Agent mode..."));

  const goal = await text({
    message: "What is your goal?",
    placeholder: "Enter your goal here...",
  });

  if (isCancel(goal)) {
    console.log(chalk.yellow("\nAgent operation cancelled.\n"));
    return;
  }
  const config = defaultAgentConfig()
  const tracker = new ActionTracker()
  const executer = new Toolexecuter(tracker, config);
  const tools = createAgentTools(executer);
  assertToolSetIsSafe(tools, "agent");

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: [stepCountIs(40), tokenBudgetExceeded()],

    instructions: [
      `Workspace root: ${config.codebasePath}`,
      `All mutations are staged and require user approval before being applied.`,
    ].join("\n"),
    tools,
  });
  const result = await agent.generate({
    prompt: goal.trim(),
    onStepFinish: ({ toolCalls }) => {
      for (const tc of toolCalls) {
        const preview = JSON.stringify(tc.input).slice(0, 160);
        console.log(
          chalk.green("  ✓"),
          chalk.bold(String(tc.toolName)),
          chalk.dim(preview + (preview.length >= 160 ? "..." : "")),
        );
      }
    },
  });
  // if (result.text?.trim()) console.log(result.text);
  if (result.text?.trim()) console.log(renderTerminalMarkdown(result.text));

  const ok = await runApprovalFlow(tracker);
  if (!ok) return executer.clearStaging();

  const { errors, diff } = executer.applyApprovedFromTracker();

  if (diff) {
    console.log(chalk.cyan("\n--- Post-Sandbox Filesystem Diff ---"));
    console.log(diff);
    console.log(chalk.cyan("-------------------------------------\n"));
  }

  if (errors.length) {
    console.log(chalk.red("\nSome operations reported errors:\n"));
    for (const e of errors) console.log(chalk.red(`  • ${e}`));
  }
  else{
   console.log(chalk.green('\n✓ Applied.\n'));
  }

  executer.clearStaging()
}