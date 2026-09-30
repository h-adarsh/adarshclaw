# Ask Mode

## Question

could you please give a overview of this folder /Users/adarshsingh/Desktop/adarshclaw/modes

## Answer

Here's an overview of the `/Users/adarshsingh/Desktop/adarshclaw/modes` folder.

## Structure

```
modes/
├── cli.ts                          # CLI sub-mode selector
├── agent/
│   ├── action-tracker.ts           # Tracks actions for approval workflow
│   ├── agent-tools.ts              # Tool definitions for Agent mode
│   ├── approval.ts                 # User approval flow
│   ├── diff-view.ts                # Diff rendering
│   ├── orchestrator.ts             # Agent mode entry point
│   ├── tool-executer.ts            # Tool execution engine
│   └── types.ts                    # Shared types & config
└── ask/
    └── orchestrator.ts             # Ask mode entry point
```

## Key Components

**`cli.ts`** — The CLI menu. Presents a `@clack/prompts` selector for three sub-modes:
- **Agent Mode** — fully implemented
- **Ask Mode** — fully implemented
- **Plan Mode** — stubbed out (commented import, no implementation yet)

It loops back to the menu after each mode completes or is cancelled.

**`agent/`** — The core agent runtime:
- **`orchestrator.ts`** — Entry point (`runAgentMode`). Prompts the user for a goal, builds a `ToolLoopAgent` (from the `ai` package), runs up to 40 steps, logs each tool call, then runs an approval flow before applying any staged mutations.
- **`tool-executer.ts`** — Executes tools (file read/write/list/search, etc.) against the workspace, staging mutations for later approval.
- **`action-tracker.ts`** — Records every action with status (`pending`, `executed`, `approved`, `rejected`).
- **`approval.ts`** — The human-in-the-loop review step before changes are applied.
- **`agent-tools.ts`** — Defines the tool set exposed to the agent.
- **`diff-view.ts`** — Renders diffs for review.
- **`types.ts`** — `AgentConfig`, `ActionLog`, `ActionType`, and `defaultAgentConfig()` (workspace root = `process.cwd()`, excludes `node_modules`, `.git`, `dist`, etc.).

**`ask/`** — A read-only Q&A mode:
- **`orchestrator.ts`** — `runAskMode`. Takes a question, runs a `ToolLoopAgent` with read-only tools (file read, list, search, codebase analysis, skills), prints the answer as markdown, and optionally saves it to a `.md` file after approval.
- Tools are restricted: file creation allowed only for the final save; modification, folder creation, and shell execution are disabled.

## Notable Patterns

- Both modes use the `ai` package's `ToolLoopAgent` with `stepCountIs` as the stop condition (40 steps for agent, 20 for ask).
- All mutations are **staged, not applied directly** — they require explicit user approval via `runApprovalFlow`.
- The agent instructions inform the model that the workspace root is `config.codebasePath` and that all mutations require approval.
- `getAgentModel()` (from `../../ai`) supplies the LLM; the exact provider isn't visible in these files.

## Summary

This is a **human-in-the-loop AI coding assistant** with two active modes (Agent and Ask) and a planned third (Plan). The architecture separates tool execution from approval, ensuring the user reviews all changes before they're applied to the filesystem.
