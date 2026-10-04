/**
 * Rule: one agent must never hold all three of these at once:
 *   1. access to private data (your files)
 *   2. untrusted input (web pages)
 *   3. a way to send data out (web requests) or to change things (files, shell)
 *
 * Web tools give it 2 and 3. So an agent with web tools gets NO file tools
 * and NO change tools. Web research is a separate agent (see runWeb).
 */

/** Tools that read private data from this machine. */
export const PRIVATE_READ_TOOLS = [
  "read_file",
  "list_files",
  "search_files",
  "analyze_codebase",
  "read_skill",
  "list_skills",
] as const;

/** Tools that talk to the internet. */
export const WEB_TOOLS = ["web_search", "web_crawl"] as const;

/** Tools that stage changes or commands. */
export const CHANGE_TOOLS = [
  "create_file",
  "modify_file",
  "delete_file",
  "create_folder",
  "execute_shell",
] as const;

/** Throws if the tool set mixes web access with file reads or change tools. */
export function assertToolSetIsSafe(tools: Record<string, unknown>, label = "agent"): void {
  const names = Object.keys(tools);
  const has = (list: readonly string[]) => names.some((n) => list.includes(n));

  if (!has(WEB_TOOLS)) return;
  if (has(PRIVATE_READ_TOOLS) || has(CHANGE_TOOLS)) {
    throw new Error(
      `Unsafe tool set for ${label}: web tools cannot be combined with file or shell tools ` +
        `(a web page could steer the agent, or file contents could leak through a URL). ` +
        `Tools: ${names.join(", ")}`,
    );
  }
}