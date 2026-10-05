import { afterEach, expect, test } from "bun:test";
import { DEFAULT_MAX_RUN_TOKENS, maxRunTokens, tokenBudgetExceeded, totalTokens } from "./run-limits";
import { DEFAULT_IMAGE, isPinnedImage } from "./sandbox";

const ORIGINAL = process.env.ADARSHCLAW_MAX_TOKENS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADARSHCLAW_MAX_TOKENS;
  else process.env.ADARSHCLAW_MAX_TOKENS = ORIGINAL;
});

test("totalTokens adds the steps and treats missing numbers as 0", () => {
  expect(totalTokens([])).toBe(0);
  expect(totalTokens([{ usage: { totalTokens: 10 } }, { usage: { inputTokens: 5, outputTokens: 7 } }, {}])).toBe(22);
});

test("the token budget stops the loop once it is used up, not before", () => {
  const stop = tokenBudgetExceeded(100);
  expect(stop({ steps: [{ usage: { totalTokens: 60 } }] })).toBe(false);
  expect(stop({ steps: [{ usage: { totalTokens: 60 } }, { usage: { totalTokens: 40 } }] })).toBe(true);
});

test("the budget can be set with ADARSHCLAW_MAX_TOKENS, and a bad value falls back to the default", () => {
  process.env.ADARSHCLAW_MAX_TOKENS = "5000";
  expect(maxRunTokens()).toBe(5000);
  process.env.ADARSHCLAW_MAX_TOKENS = "abc";
  expect(maxRunTokens()).toBe(DEFAULT_MAX_RUN_TOKENS);
  process.env.ADARSHCLAW_MAX_TOKENS = "-3";
  expect(maxRunTokens()).toBe(DEFAULT_MAX_RUN_TOKENS);
});

test("sandbox image: only name@sha256:<64 hex> counts as pinned", () => {
  const digest = "a".repeat(64);
  expect(isPinnedImage(`oven/bun:1@sha256:${digest}`)).toBe(true);
  expect(isPinnedImage(DEFAULT_IMAGE)).toBe(DEFAULT_IMAGE.includes("@sha256:"));
  expect(isPinnedImage("oven/bun:1")).toBe(false);
  expect(isPinnedImage("oven/bun:latest")).toBe(false);
  expect(isPinnedImage("oven/bun@sha256:short")).toBe(false);
});