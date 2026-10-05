# Adarshclaw

`adarshclaw` is a highly secure, human-in-the-loop AI coding assistant built on Bun. It uses an OpenRouter model to inspect codebases, answer questions, draft implementation plans, and make approved changes. 

Designed with security as a first-class citizen, it ensures no AI operates unsupervised on your machine.

## 🚀 Core Capabilities

- **Agent Mode**: Describe a goal. The AI inspects files, creates/modifies code, and queues shell commands. Changes are staged for your approval before application.
- **Plan Mode**: Ask for a complex goal. The AI researches the workspace, drafts a step-by-step plan, and lets you select specific steps to execute.
- **Ask Mode**: Read-only workspace Q&A. The AI can explore your codebase to answer questions without modifying anything.
- **Web Search (`/web`)**: A dedicated mode to search the internet for documentation. (Strictly isolated: web agents cannot see your files).
- **Telegram Bot**: Access all modes remotely via a secure, owner-only Telegram bot interface.

## 🛡️ Advanced Security Model

Adarshclaw assumes AI models can be tricked (Prompt Injection) and enforces a strict defense-in-depth architecture:

- **Staged Approval & Diffs**: All file mutations are staged in-memory. After you approve and commands run, a post-sandbox `git diff` shows you *exactly* what changed on disk.
- **Docker Sandbox for Shell**: Shell commands never run on your host machine. They run inside an isolated, network-disabled Docker container (`oven/bun:1`) with a read-only root filesystem and dropped privileges.
- **Secondary AI Verification**: Before you see an approval prompt, a secondary read-only AI automatically audits the staged changes for malicious intent, data exfiltration, or prompt injection.
- **Strict Tool Isolation**: An agent that reads your files never has access to the internet. An agent that browses the web never has access to your files.
- **Safe Path Enforcement & Exclusions**: Symlinks are resolved to prevent path traversal. Sensitive files (`.env*`, `.git`, `credentials.json`, `*.pem`, etc.) are hard-blocked.
- **Run Limits & Locks**: Built-in 10-minute deadlines, token budget limits, and single-task locks prevent runaway agents and resource exhaustion.

## ⚙️ Requirements & Setup

1. **Bun** installed on your system.
2. **Docker** (Required if you want the AI to run shell commands).
3. **OpenRouter API Key**.
4. *(Optional)* **Telegram Bot Token** and your Telegram User ID for remote access.

```sh
# 1. Install dependencies
bun install

# 2. Configure environment variables (e.g., in your shell or .env)
export OPENROUTER_API_KEY="your-key"
export OPEN_ROUTER_DEFAULT_MODEL="openrouter/free" # Optional
```

## 💻 Usage

### CLI Mode
Run the interactive terminal UI from your project directory:
```sh
bun index.ts
```

### Telegram Mode
If you configure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID` in your environment, the bot will start automatically. Send commands like `/agent`, `/ask`, `/plan`, and `/web` directly in a private chat with your bot.

---
*Note: Adarshclaw does not maintain a persistent conversation database. Each task starts fresh, relying on workspace analysis rather than chat history.*