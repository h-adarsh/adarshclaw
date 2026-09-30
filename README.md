# adarshclaw

`adarshclaw` is a Bun-based, human-in-the-loop AI coding assistant for a local
workspace. It uses an OpenRouter model to inspect a codebase, answer questions,
create an implementation plan, or make approved changes.

## MVP capabilities

- **Agent Mode**: describe a coding goal. The agent can inspect files and stage
	file, folder, and shell operations. Changes are shown for approval before they
	are applied.
- **Plan Mode**: ask for a goal, let the model research the workspace and draft
	a short plan, select the steps to execute, then review the staged changes.
- **Ask Mode**: ask a read-only question about the workspace. The answer can be
	saved as a Markdown file after approval.
- **Telegram Mode**: available from the wakeup menu when Telegram credentials
	are configured.

## How it works

1. The CLI starts `runWakeup()` and presents the CLI or Telegram entrypoint.
2. CLI mode selects Agent, Plan, or Ask.
3. Each mode creates a `ToolLoopAgent` from the Vercel AI SDK and gets its model
	 from `ai/ai.config.ts`.
4. Tools operate relative to the current working directory. The executor blocks
	 paths outside the workspace and excludes `.git`, dependencies, build output,
	 logs, and `.env` files.
5. Mutations are staged in memory and recorded by `ActionTracker`; they are not
	 written to disk until the approval flow accepts them.

## Requirements

- [Bun](https://bun.sh/) installed
- An OpenRouter API key
- A model available through OpenRouter

## Setup

```sh
bun install
export OPENROUTER_API_KEY="your-key"
export OPEN_ROUTER_DEFAULT_MODEL="openrouter/free"
```

The model variable is optional and defaults to `openrouter/free`. Keep the API
key in your shell environment or a local environment file; do not commit it.

## Run

From the project directory:

```sh
bun index.ts
```

The explicit equivalent is:

```sh
bun index.ts wakeup
```

For development, the package also exposes the `adarshclaw-build` binary after
installing the package locally.

## Project map

```text
index.ts                  Commander CLI entrypoint
tui/wakeup.ts             Banner and top-level mode selector
modes/cli.ts              Agent, Plan, and Ask selector
modes/agent/              Mutable tools, staging, diffs, and approval
modes/plan/               Plan generation and selected-step execution
modes/ask/                Read-only workspace Q&A and Markdown export
modes/telegram/           Telegram adapter and approval sessions
ai/ai.config.ts           OpenRouter model configuration
```

## Safety model

Agent and Plan mutations are staged first. Review the proposed actions and
approve them only when they are correct. Ask Mode disables modification, folder
creation, and shell execution; it only enables file creation for an explicitly
approved Markdown export.

## Current MVP boundaries

- There is no persistent conversation history or database.
- The model can only use tools exposed by the selected mode.
- Shell commands are queued for approval; command execution and other tool
	behavior depend on the implementation in the current executor.
- Telegram requires its own credentials and is not needed for local CLI use.