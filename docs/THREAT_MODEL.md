# adarshclaw threat model

This document says what adarshclaw defends against, which test proves each defense, and what is **not** covered. It was written by hand against the code in this repository. It is not an audit by a third party.

Last reviewed: 4 October 2026.

## What is being protected

- **Your files** in the workspace the agent runs in.
- **Your secrets**: `.env`, API keys, the Telegram bot token, SSH keys, cloud credentials.
- **Your machine**: the agent must not run arbitrary commands as you.
- **Your approval**: when you approve a change, it must be the change you actually saw.

## Who and what is trusted

| Party | Trust |
|---|---|
| You (the owner) | Trusted. Telegram access is limited to your user ID in a private chat. |
| Other Telegram users | Not trusted. Ignored. |
| The language model | **Not trusted.** It can be wrong or steered. Every action it takes is staged and needs your approval. |
| Files the agent reads (README, source, docs) | **Not trusted.** They can contain instructions aimed at the model. |
| Web pages the agent reads | **Not trusted.** Same reason. |
| Docker Desktop and its VM | Trusted as the isolation boundary for shell commands. |

## Threats, defenses and proof

Test names are in the files shown. Run all of them with `bun test` (Docker must be running, or the 10 Docker tests are skipped).

| # | Threat | Defense | Proof | What remains |
|---|---|---|---|---|
| 1 | A stranger sends commands or presses buttons on the bot | One middleware runs before every handler. It accepts only the owner's **user** ID, in a **private** chat. The bot refuses to start if the ID is missing or invalid. | `modes/telegram/bot-auth.test.ts` (stranger command, stranger button press, owner in a group) | If your own Telegram account is taken over, the attacker is you. |
| 2 | Path escape: `../`, absolute paths, a sibling folder with the same prefix, null bytes | Paths are resolved and checked against the real workspace root. | `modes/agent/tool-executer.attacks.test.ts` | A path could be swapped for a symlink between the check and the use (race). The sandbox limits what that can reach. |
| 3 | Escape through symlinks, including broken ones, for reads and writes | Symlinks are followed and the real location is checked. Broken symlinks are refused. Directory walks skip symlinks. | `tool-executer.attacks.test.ts` (symlinked file, symlinked folder, write through both, dangling link, search leak) | Same race as #2. |
| 4 | Reading excluded files (`.env`, `.git`) by changing letter case, or through a symlink named something else | Exclusion rules are case-insensitive, any `*` pattern works, and the rule is applied to the real target of a symlink. | `tool-executer.attacks.test.ts` (`.ENV`, `.GIT/config`, symlink to `.env`, `*.pem`) | Only the patterns in `defaultAgentConfig()` are excluded. Other secret file names are readable. |
| 5 | An approved shell command harms the machine | Commands run in a Docker container: non-root, read-only root filesystem, all Linux capabilities dropped, no new privileges, memory, CPU and process limits. | `modes/agent/sandbox.test.ts` (Docker tests: read-only filesystem, home folder unreachable, symlink to a host file not exposed) | The project folder is mounted writable, so a command can change project files. A bug in Docker or its VM would bypass this. |
| 6 | A command leaks secrets | No network by default. No host environment variables are passed into the container. `.env*`, `.npmrc`, `*.pem`, `*.key` are hidden behind empty files. | `sandbox.test.ts` (no network, environment not visible, `.env` hidden) | `sandboxNetwork: true` turns the network on for everything. |
| 7 | A command plants code that runs later on your machine (git hook, changed dependency, `bunfig.toml` preload, `package.json` script, editor task, CI file) | `.git`, `node_modules`, `bunfig.toml`, `package.json`, `.husky`, `.vscode` and `.github` are mounted read-only in the sandbox. They can only be changed through the file tools, which show you the diff. | `modes/agent/sandbox.test.ts` (Docker tests: a command cannot change `package.json`, `bunfig.toml` or `node_modules`; a list test for the protected paths) | Only the top-level paths in `EXEC_TRIGGER_PATHS` are protected. A nested `node_modules` or other script locations (for example a `Makefile` or `scripts/`) are writable. |
| 8 | Docker is missing or stopped, and commands run on the host instead | The runner fails closed: the command is not run. | `sandbox.test.ts` (fails closed, executor does not run on the host) | None known. |
| 9 | A command runs forever or leaves a container behind | Each command has a timeout and the container is removed on timeout. | `sandbox.test.ts` (timeout kills the container) | The bot is blocked while a command runs (up to 60 seconds). |
| 10 | The model reads any local file through a web tool | `fetch_url` was removed. In Bun, `fetch("file:///...")` returns local files. | `modes/plan/web-tools.test.ts` | `web_crawl` sends the URL to Firecrawl, a third party. |
| 11 | A web page steers an agent that can read files, change files or run commands, or file contents leak through a URL | An agent with web tools gets no file tools and no change or shell tools. This is checked in code at startup. Web research is a separate agent (`/web`) with no access to your files. | `modes/agent/tool-policy.test.ts` (including the old unsafe combination being refused, every tool classified, every agent-building file calls the check) | The `/web` agent can still be misled by the pages it reads. Its answers are not verified. |
| 12 | Instructions hidden in repo files steer the agent | Every change is staged, shown in full, and needs approval. Shell commands run only in the sandbox. Hidden or non-ASCII characters in a command are flagged in the review. | `modes/telegram/approval.test.ts` (hidden characters flagged) | **The review is the only defense.** A tired or careless approval defeats it. |
| 13 | An old message approves something you did not review | Every button carries a random session ID. A new request replaces the old session. Sessions expire after 15 minutes (plans after 30). Only one approval can be pending per chat. | `approval.test.ts` (old button, made-up ID, expiry, new `/agent` refused, old plan button) | Sessions live in memory and are lost on restart (this fails safe). |
| 14 | You approve changes you were never shown (cut-off diffs) | Nothing can be applied until the full review was sent. Long reviews go out as a file. If the file upload fails, they go out as messages. If it is too large for both, the bot refuses and nothing can be applied. | `approval.test.ts` (whole change in the review, long text as a file, real HTTP upload, too-large refusal, no apply before review) | The bot can prove the text was sent, not that you read it. |
| 15 | One button or one choice approves a shell command you did not look at | Telegram: file changes and shell commands have separate buttons. Terminal: every staged change and the full shell command are listed before "Approve and apply all". | `modes/telegram/approval.test.ts` (approved separately), `modes/agent/approval.test.ts` (full command listed) | None known. |
| 16 | Two runs at once mix up approvals | One task per chat at a time. | `approval.test.ts` (run lock) | None known. |
| 17 | A hung or runaway agent run locks the bot or burns tokens | Telegram agents stop after 10 minutes. The abort signal is sent, and the lock is released even if the call ignores it. A run that finishes late sends no messages and stages nothing. A token budget stops the loop (default 1,000,000 tokens, set with `ADARSHCLAW_MAX_TOKENS`). | `modes/telegram/run-lock.test.ts`, `modes/agent/run-limits.test.ts` | The budget is approximate and is not a money cap. A call that ignores the abort signal may keep running in the background while its result is discarded. Terminal modes have no time limit. |
| 18 | Text the model or a file controls changes what the **terminal** shows (escape sequences, carriage returns, hidden or direction-changing Unicode), so a diff, a shell command or a plan title looks different from what it is | All model-controlled text printed by the terminal modes is passed through a sanitizer that replaces these characters with visible `\u{....}` markers: markdown output, diffs, the approval list and per-item prompts, and plan step titles. | `tui/safe-text.test.ts`, `modes/agent/approval.test.ts` | Only the places listed are covered. New code that prints model text with `console.log` must use `sanitizeForTerminal()`. Telegram shows plain text and is not affected by escape sequences, but see row 12 for hidden characters. |
| 19 | You start adarshclaw inside a repository you do not control. Bun reads that directory's `bunfig.toml` (which can run code through `preload`) and its `.env` files **before** adarshclaw's own code starts | `bin/adarshclaw` starts Bun with `--config` pointing at adarshclaw's own `bunfig.toml` and `--env-file` pointing at adarshclaw's own `.env` (or `--no-env-file`). Without the launcher, adarshclaw refuses to start unless the current directory is the adarshclaw project. | `modes/agent/launch-guard.test.ts` (a malicious `bunfig.toml` preload runs when Bun is started directly, and does not run through the launcher) | Only the launcher prevents the preload. The refusal inside adarshclaw happens after Bun has already read the files, so it cannot undo a preload that ran. The launcher is `sh`, so macOS and Linux only. The same risk applies to any other Bun command (`bun test`, `bun run`, `bun install`) run inside an untrusted repository. Values set in your own shell are trusted. |
| 20 | Link previews as a data leak: the model, steered by text in a file or web page, writes a URL containing your data into a reply, and Telegram's own servers fetch it to build a preview card | Every message the bot sends or edits has link previews turned off. Links stay clickable, but nothing is fetched automatically. | `modes/telegram/link-preview.test.ts` | A person who clicks such a link still sends the request. Review text and replies are plain text, so read links before clicking. |
| 21 | A shell command changes files and you never see what it really did | After approved commands run, the workspace is compared by content before and after. The report lists every added, changed and deleted path, with diffs for small text files. It does not use git, does not depend on `.gitignore`, and runs no external program. File names and contents are sanitized before printing. It is sent to Telegram too. | `modes/agent/snapshot.test.ts` (files hidden by `.gitignore`, no git repository, restored modification time, `chmod +x`, symlinks, escape sequences), `modes/agent/shell-changes.test.ts` (executor starts no external program; report built from a fake Docker) | The report comes **after** the change. It cannot undo it. Files over 2 MB are compared by size and time, so a same-size edit with a restored time is missed. Only the first 20,000 entries are read, and the report says when it is incomplete. `.git` and `node_modules` are not compared. |
| 22 | The AI review (CLI) is talked into saying "safe", or is blinded by padding | The review is advisory and labelled that way. It is shown **after** the staged-change list. Its input is marked as untrusted data. It has a 30-second limit. Its output is sanitized. If the changes are longer than the reviewer's limit, a warning says how much was not reviewed. | `modes/agent/approval.test.ts` (padding pushes a dangerous command past the reviewer's limit, and the truncation is flagged) | A prompt injection inside the changes can still influence the reviewer. It must never be used to approve anything. It is not part of the Telegram flow. |

## Known gaps

These are open. They are listed so nobody has to find them by reading the code.

1. **Limits are partial.** Telegram agents and the planner have a token budget, and Telegram agents have a 10-minute deadline. The terminal modes (CLI Agent, Plan execution, Ask) have step limits only, with no time limit. There is no cap in money, only in tokens, and it is checked after each step.
2. **The sandbox's project folder is mostly writable.** Approved commands can change or delete ordinary project files. The change report (row 21) lists them afterwards, but it cannot prevent them. Files that run later are read-only (row 7).
3. **The sandbox image is pinned, so it does not get security updates by itself.** It is fixed to one `oven/bun` digest (pulled 4 October 2026). Update it on purpose from time to time: `docker pull oven/bun:1`, `docker inspect --format='{{index .RepoDigests 0}}' oven/bun:1`, and paste the result into `DEFAULT_IMAGE` in `modes/agent/sandbox.ts` (or set `ADARSHCLAW_SANDBOX_IMAGE`).
4. **Shell execution blocks the bot** while it runs (synchronous call, up to 60 seconds).
5. **Data sent to the model provider.** Everything the agent reads goes to OpenRouter and the model's provider. Only the exclusion patterns protect secrets; other secret file names (for example `credentials.json`) are readable. The default model is `openrouter/free`. Free routes can use providers with different data policies; check OpenRouter's privacy settings and set `OPEN_ROUTER_DEFAULT_MODEL` to a model whose policy you accept before pointing this at private code.
6. **Dependencies.** `bun audit` first listed 12 advisories (7 high), all in `axios` 1.18.0, pulled in by `@mendable/firecrawl-js`. After upgrading, `bun audit` reported no known vulnerabilities (136 packages). Re-run `bun audit` before each release. An audit only finds known advisories; it does not check for malicious packages or review this repository's code.

## Not verified end to end

- The approval tests use simulated Telegram updates and a local fake Telegram server. They were **not** run against a second real Telegram account.
- The file upload path was tested against a local fake server. No automated test checks it against the real Telegram servers.
- The sandbox tests were run on Docker Desktop for Mac with the `oven/bun:1` image. Other platforms are untested.

## How this was tested

- Before the executor fixes, 12 of the first 18 executor attack tests failed against the original code (the shell tests have since moved to `sandbox.test.ts`). After the fixes, all pass.
- Several tests were checked by temporarily breaking the defense and confirming the test failed (for example putting web tools back into Ask mode, or removing the owner middleware).
- Current suite: 131 tests across 14 files. 12 of them need Docker and are skipped without it.

## Reporting a problem

Open an issue on this repository or contact the maintainer. Please include steps to reproduce, and do not post real keys or tokens.
