import { expect, test } from "bun:test";
import { sanitizeForTerminal } from "./safe-text";
import { renderTerminalMarkdown } from "./terminal-md";

test("escape sequences become visible text", () => {
  const out = sanitizeForTerminal("ok\x1b[2J\x1b]0;evil\x07 done");
  expect(out).not.toContain("\x1b");
  expect(out).not.toContain("\x07");
  expect(out).toContain("\\u{001b}[2J");
});

test("a carriage return cannot overwrite an earlier line", () => {
  const out = sanitizeForTerminal("rm -rf /\rls");
  expect(out).not.toContain("\r");
  expect(out).toContain("\\u{000d}");
});

test("C1 controls, bidi overrides and zero-width characters are made visible", () => {
  for (const ch of ["\u009b", "\u202e", "\u2066", "\u200b", "\ufeff", "\u2028"]) {
    const out = sanitizeForTerminal(`a${ch}b`);
    expect(out).not.toContain(ch);
    expect(out).toMatch(/\\u\{[0-9a-f]{4}\}/);
  }
});

test("newlines, tabs and normal text (accents, CJK, emoji) are left alone", () => {
  const text = "line1\n\tline2 caf\u00e9 \u4e2d\u6587 \u{1F600}";
  expect(sanitizeForTerminal(text)).toBe(text);
});

test("the markdown renderer does not let escape sequences through", () => {
  const out = renderTerminalMarkdown("# title\n\nhello \x1b[2Jworld \x1b]8;;fake-evil\x07link\n\n```diff\n+a\x1b[8mhidden\n```");
  expect(out).not.toContain("\x1b[2J");
  expect(out).not.toContain("\x1b]8");
  expect(out).not.toContain("\x1b[8m");
  expect(out).not.toContain("\x07");
  expect(out).toContain("hello"); // normal content still renders
});