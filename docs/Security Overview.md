# Security Overview

This document outlines the security controls currently implemented in the codebase and the gaps that remain to be addressed. It focuses purely on application-level and codebase-level controls.

## What is Already Implemented

- **Owner-Only Authentication (`modes/telegram/auth.ts`, `bot.ts`)**
  - Telegram bot strictly enforces `TELEGRAM_OWNER_ID` matching. Refuses to start without a valid ID.
  - Drops messages from groups and non-private chats.
- **Safe Path Enforcement (`modes/agent/safe-path.ts`)**
  - Resolves all symlinks to real paths.
  - Ensures all file access remains strictly within the workspace.
- **Hardcoded File Exclusions (`modes/agent/tool-executer.ts`)**
  - Case-insensitive blocking of sensitive files (`.env*`, `.git`, `node_modules`, `*.pem`, `*.key`, etc.).
  - Exclusion checks run on the *resolved* path, stopping symlink bypasses.
- **Docker Sandbox Hardening (`modes/agent/sandbox.ts`)**
  - Shell commands run in isolated containers.
  - Image is cryptographically pinned by digest.
  - Container networking is fully disabled (`--network none`).
  - Container root filesystem is read-only; privileges are dropped.
  - Fails closed: If Docker is unavailable, shell commands are blocked.
- **Staged Approval Flow (`modes/agent/tool-executer.ts`, `modes/telegram/approval-sessions.ts`)**
  - No file is written and no command is executed without explicit user approval.
  - File changes and shell commands are staged and approved separately.
  - Approval buttons contain unique session IDs, enforce a 15-minute TTL, and prevent double-clicks.
- **Tool Policy Isolation (`modes/agent/tool-policy.ts`)**
  - Web tools and file/shell tools are strictly isolated. Code-level assertions prevent any agent from having both simultaneously, mitigating exfiltration via prompt injection.
- **Prompt Injection Validation (`modes/agent/approval.ts`)**
  - A secondary, read-only AI agent (`verifyChanges`) scans all staged changes before the user sees the approval prompt.
  - Flags data exfiltration, malicious shell commands, and prompt-injection instructions in a bold "Security Summary".
- **Run Locks & Deadlines (`modes/telegram/run-lock.ts`)**
  - One task at a time per chat.
  - 10-minute wall-clock deadline enforces task termination and lock release.
- **Token Budget Limits (`modes/agent/run-limits.ts`, `modes/agent/orchestrator.ts`)**
  - Enforced consistently across both Telegram agents and terminal (CLI) modes.
  - Forcefully aborts the loop if token usage exceeds the configured max limit (`ADARSHCLAW_MAX_TOKENS`).
- **Extended Exclusion List (`modes/agent/types.ts`)**
  - Default exclusion list blocks sensitive files like `credentials.json`, `id_rsa`, `*.p12`, and `*.pfx`.
- **Post-Sandbox Filesystem Diffing (`modes/agent/tool-executer.ts`, `modes/agent/orchestrator.ts`)**
  - Runs a combined git diff after the sandbox executes and presents the actual filesystem changes (tracked and untracked) made by shell commands to the user.
