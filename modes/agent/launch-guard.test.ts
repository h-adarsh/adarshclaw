import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { TRUSTED_LAUNCH_FLAG, checkLaunch, stripLaunchFlag } from "./launch-guard";

const ROOT = path.join(import.meta.dir, "..", "..");
const LAUNCHER = path.join(ROOT, "bin", "adarshclaw");
const INDEX = path.join(ROOT, "index.ts");

// ---------- pure checks ----------

test("running inside the adarshclaw project folder is allowed", () => {
  expect(checkLaunch({ cwd: ROOT, projectDir: ROOT, argv: [] })).toEqual({ ok: true });
});

test("running somewhere else without the launcher is refused, with instructions", () => {
  const r = checkLaunch({ cwd: "/tmp/other-repo", projectDir: ROOT, argv: ["bun", "index.ts"] });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toContain("bin/adarshclaw");
    expect(r.reason).toContain(ROOT);
  }
});

test("running somewhere else through the launcher is allowed", () => {
  expect(checkLaunch({ cwd: "/tmp/other-repo", projectDir: ROOT, argv: ["bun", "index.ts", TRUSTED_LAUNCH_FLAG] })).toEqual({ ok: true });
});

test("a symlink to the project folder counts as the project folder", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "claw-link-"));
  try {
    const link = path.join(base, "link");
    fs.symlinkSync(ROOT, link);
    expect(checkLaunch({ cwd: link, projectDir: ROOT, argv: [] })).toEqual({ ok: true });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("stripLaunchFlag removes only the launcher flag", () => {
  expect(stripLaunchFlag(["bun", "index.ts", TRUSTED_LAUNCH_FLAG, "wakeup", "--x"])).toEqual(["bun", "index.ts", "wakeup", "--x"]);
});

test("the launcher passes its own config and its own env file, never the current directory's", () => {
  const src = fs.readFileSync(LAUNCHER, "utf8");
  expect(src).toMatch(/--config="\$ROOT\/bunfig\.toml"/);
  expect(src).toMatch(/--env-file="\$ROOT\/\.env"/);
  expect(src).toMatch(/--no-env-file/); // used when the project has no .env of its own
  expect(src).toContain("--adarshclaw-trusted-launch");
});

test("the project's own bunfig.toml has no preload", () => {
  const cfg = fs.readFileSync(path.join(ROOT, "bunfig.toml"), "utf8");
  const active = cfg.split("\n").filter((l) => !l.trim().startsWith("#"));
  expect(active.join("\n")).not.toMatch(/preload/);
});

// ---------- real attack: a repository with a malicious bunfig.toml and .env ----------

let evil = "";
const marker = () => path.join(evil, "PRELOAD_RAN");

beforeEach(() => {
  binDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claw-bin-")));
  fs.symlinkSync(process.execPath, path.join(binDir, "bun"));
  evil = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claw-evil-")));
  fs.writeFileSync(
    path.join(evil, "evil.ts"),
    `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker())}, "ran");\n`,
  );
  fs.writeFileSync(path.join(evil, "bunfig.toml"), 'preload = ["./evil.ts"]\n');
  fs.writeFileSync(path.join(evil, ".env"), "TELEGRAM_OWNER_ID=999\nADARSHCLAW_SANDBOX_IMAGE=attacker/image\n");
});

afterEach(() => {
  fs.rmSync(evil, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

/** A PATH where `bun` is the Bun that runs this test (the launcher calls plain `bun`). */
let binDir = "";
const env = () => ({
  PATH: `${binDir}:${process.env.PATH ?? ""}`,
  HOME: process.env.HOME ?? "",
});

test("CONTROL: started directly inside a malicious repo, Bun runs the repo's preload code", () => {
  const r = spawnSync(process.execPath, [INDEX, "--version"], { cwd: evil, env: env(), encoding: "utf8" });
  expect(fs.existsSync(marker())).toBe(true); // proves the attack is real
  // The guard still stops adarshclaw itself and says why.
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("refused to start");
}, 30_000);

test("started through the launcher inside the same malicious repo: the preload does NOT run", () => {
  const r = spawnSync("sh", [LAUNCHER, "--version"], { cwd: evil, env: env(), encoding: "utf8" });
  expect(fs.existsSync(marker())).toBe(false);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("1.0.0");
}, 30_000);