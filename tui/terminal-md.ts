import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { sanitizeForTerminal } from "./safe-text.ts";

let ready = false;

function ensureMarked(): void {
  if (ready) return;
  const w = Math.max(40, Math.min(process.stdout.columns || 80, 120));
  //   @ts-ignore
  marked.use(markedTerminal({ width: w, reflowText: true }, {}));
  ready = true;
}

export function renderTerminalMarkdown(source: string): string {
  ensureMarked();
  // SECURITY: neutralise escape sequences BEFORE rendering. The renderer adds its own
  // (harmless) colour codes afterwards, so formatting still works.
  return marked.parse(sanitizeForTerminal(source).trimEnd(), { async: false }) as string;
}