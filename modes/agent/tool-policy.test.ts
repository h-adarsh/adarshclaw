import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  CHANGE_TOOLS,
  PRIVATE_READ_TOOLS,
  WEB_TOOLS,
  assertToolSetIsSafe,
} from "./tool-policy";
import { Toolexecuter } from "./tool-executer";
import { ActionTracker } from "./action-tracker";
import { createAgentTools } from "./agent-tools";
import { defaultAgentConfig } from "./types";
import { createWebTools } from "../plan/web-tools";

const set = (...names: readonly string[]) => Object.fromEntries(names.map((n) => [n, {}]));
const realExecutor = () => new Toolexecuter(new ActionTracker(), defaultAgentConfig());

// ---------- the rule itself ----------

test("web tools alone are fine", () => {
  expect(() => assertToolSetIsSafe(set(...WEB_TOOLS))).not.toThrow();
});

test("file reads alone are fine (Ask mode)", () => {
  expect(() => assertToolSetIsSafe(set(...PRIVATE_READ_TOOLS))).not.toThrow();
});

test("file reads plus change tools are fine without web (Agent mode)", () => {
  expect(() => assertToolSetIsSafe(set(...PRIVATE_READ_TOOLS, ...CHANGE_TOOLS))).not.toThrow();
});

test("web plus ANY file-reading tool is refused", () => {
  for (const readTool of PRIVATE_READ_TOOLS) {
    expect(() => assertToolSetIsSafe(set("web_crawl", readTool))).toThrow(/Unsafe tool set/);
  }
});

test("web plus ANY change or shell tool is refused", () => {
  for (const changeTool of CHANGE_TOOLS) {
    expect(() => assertToolSetIsSafe(set("web_search", changeTool))).toThrow(/Unsafe tool set/);
  }
});

// ---------- the real tool sets ----------

test("the real agent tools pass; the real web tools pass", () => {
  expect(() => assertToolSetIsSafe(createAgentTools(realExecutor()))).not.toThrow();
  expect(() => assertToolSetIsSafe(createWebTools(new ActionTracker()))).not.toThrow();
});

test("the OLD plan-mode setup (agent tools + web tools) is now refused", () => {
  const old = { ...createAgentTools(realExecutor()), ...createWebTools(new ActionTracker()) };
  expect(() => assertToolSetIsSafe(old, "plan execution")).toThrow(/Unsafe tool set/);
});

test("every tool is classified, so a new tool cannot slip past the rule", () => {
  const known = new Set<string>([...PRIVATE_READ_TOOLS, ...WEB_TOOLS, ...CHANGE_TOOLS]);
  const all = [
    ...Object.keys(createAgentTools(realExecutor())),
    ...Object.keys(createWebTools(new ActionTracker())),
  ];
  const unclassified = all.filter((n) => !known.has(n));
  expect(unclassified).toEqual([]);
});

// ---------- every place that builds an agent runs the check ----------

const read = (...p: string[]) => fs.readFileSync(path.join(import.meta.dir, ...p), "utf8");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start + 10);
  const next = rest.indexOf("\nexport ");
  return next === -1 ? rest : rest.slice(0, next);
}

test("Telegram: every agent (ask, web, agent, plan steps) calls the policy check", () => {
  const src = read("..", "telegram", "agent-run.ts");
  expect(count(src, /assertToolSetIsSafe\(/g)).toBeGreaterThanOrEqual(4);
});

test("planner and CLI plan execution call the policy check", () => {
  expect(count(read("..", "plan", "planner.ts"), /assertToolSetIsSafe\(/g)).toBeGreaterThanOrEqual(1);
  expect(count(read("..", "plan", "orchestrator.ts"), /assertToolSetIsSafe\(/g)).toBeGreaterThanOrEqual(1);
});

test("CLI Ask mode has no web tools and calls the policy check", () => {
  const src = read("..", "ask", "orchestrator.ts");
  expect(src).not.toMatch(/createWebTools|web-tools/);
  expect(count(src, /assertToolSetIsSafe\(/g)).toBeGreaterThanOrEqual(1);
});

test("Ask mode (Telegram) has no web tools", () => {
  const body = functionBody(read("..", "telegram", "agent-run.ts"), "runAsk");
  expect(body).not.toMatch(/createWebTools|extraWebTools|webTools/);
});

test("the planner has no web tools", () => {
  expect(read("..", "plan", "planner.ts")).not.toMatch(/createWebTools|web-tools/);
});