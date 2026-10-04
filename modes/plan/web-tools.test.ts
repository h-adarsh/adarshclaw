import { expect, test } from "bun:test";
import { createWebTools } from "./web-tools";
import { ActionTracker } from "../agent/action-tracker";

test("no web tool fetches arbitrary URLs from this machine", () => {
  const names = Object.keys(createWebTools(new ActionTracker()));
  expect(names).not.toContain("fetch_url");
  expect(names.sort()).toEqual(["web_crawl", "web_search"]);
});