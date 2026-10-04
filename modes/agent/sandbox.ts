import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface SandboxOptions {
  /** Real (symlink-resolved) path of the workspace. */
  workspace: string;
  image?: string;
  timeoutMs?: number;
  /** Default false: the container has no network at all. */
  network?: boolean;
  uid?: number;
  gid?: number;
  /** Paths (relative to workspace) mounted read-only. Default: [".git"]. */
  readOnlyPaths?: string[];
  /** Files (relative to workspace) hidden behind an empty file. Default: found automatically. */
  maskFiles?: string[];
  /** Only for tests. */
  dockerBin?: string;
  name?: string;
}

export interface SandboxResult {
  exitCode: number | null;
  output: string;
  /** Set when the command did NOT run, or was killed. */
  error?: string;
}

export const DEFAULT_IMAGE = "oven/bun:1";
const MOUNT = "/workspace";
const SECRET_FILE_PATTERNS = [/^\.env/i, /^\.npmrc$/i, /\.pem$/i, /\.key$/i];

const toPosix = (p: string) => p.split(path.sep).join("/");

function clip(s: string, n = 8000): string {
  return s.length > n ? s.slice(0, n) + "\n…[truncated]" : s;
}

function bindMount(src: string, dst: string, readonly: boolean): string[] {
  for (const s of [src, dst]) {
    if (/[,\n\r]/.test(s)) throw new Error(`Unsafe characters in mount path: ${s}`);
  }
  return ["--mount", `type=bind,src=${src},dst=${dst}${readonly ? ",readonly" : ""}`];
}

function assertRelative(rel: string): void {
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
    throw new Error(`Bad sandbox path: ${rel}`);
  }
}

/** Finds .env*, .npmrc, *.pem, *.key files in the workspace (skips node_modules, .git, symlinks). */
export function findSecretFiles(root: string, maxDepth = 6): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        walk(full, depth + 1);
      } else if (SECRET_FILE_PATTERNS.some((re) => re.test(ent.name))) {
        out.push(path.relative(root, full));
      }
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Builds the `docker run` arguments. Pure function: no Docker needed to test it.
 *
 * What the container gets:
 *  - only the workspace (read-write), nothing else from the host
 *  - NO host environment variables (no API keys, no tokens)
 *  - no network (unless explicitly enabled)
 *  - read-only root filesystem, no Linux capabilities, no new privileges
 *  - .git read-only, secret files hidden
 *  - memory, CPU and process limits
 */
export function buildDockerArgs(
  command: string,
  o: SandboxOptions & { name: string },
): string[] {
  const args = [
    "run",
    "--rm",
    "--name", o.name,
    "--read-only",
    "--tmpfs", "/tmp:rw,size=256m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "256",
    "--memory", "512m",
    "--cpus", "1",
    "--user", `${o.uid || 1000}:${o.gid || 1000}`, // never root: 0 falls back to 1000
    "-e", "HOME=/tmp",
    "-w", MOUNT,
    ...bindMount(o.workspace, MOUNT, false),
  ];
  if (!o.network) args.push("--network", "none");

  for (const rel of o.readOnlyPaths ?? []) {
    assertRelative(rel);
    args.push(...bindMount(path.join(o.workspace, rel), `${MOUNT}/${toPosix(rel)}`, true));
  }
  for (const rel of o.maskFiles ?? []) {
    assertRelative(rel);
    args.push(...bindMount("/dev/null", `${MOUNT}/${toPosix(rel)}`, true));
  }

  // The command is ONE argument to `sh -c` inside the container.
  // The host shell never sees it.
  args.push(o.image ?? DEFAULT_IMAGE, "sh", "-c", command);
  return args;
}

export function dockerReady(dockerBin = "docker"): boolean {
  const r = spawnSync(dockerBin, ["info"], { timeout: 15_000, stdio: "ignore" });
  return !r.error && r.status === 0;
}

/**
 * Runs a command inside the sandbox. FAILS CLOSED: if Docker is missing or
 * not running, the command is NOT run on the host.
 */
export function runInSandbox(command: string, o: SandboxOptions): SandboxResult {
  const bin = o.dockerBin ?? "docker";
  const name = o.name ?? `claw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timeoutMs = o.timeoutMs ?? 60_000;

  let args: string[];
  try {
    const workspace = fs.realpathSync(o.workspace);
    const readOnlyPaths = (o.readOnlyPaths ?? [".git"]).filter((p) =>
      fs.existsSync(path.join(workspace, p)),
    );
    const maskFiles = o.maskFiles ?? findSecretFiles(workspace);
    args = buildDockerArgs(command, { ...o, workspace, name, readOnlyPaths, maskFiles });
  } catch (e) {
    return { exitCode: null, output: "", error: `${(e as Error).message}. Command NOT run.` };
  }

  // The docker CLI itself may use the host environment (it needs it to find
  // the Docker socket). Docker does not pass that environment into the container.
  const r = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      // Killing the docker CLI does NOT stop the container. Remove it explicitly.
      spawnSync(bin, ["rm", "-f", name], { timeout: 10_000, stdio: "ignore" });
      return {
        exitCode: null,
        output: clip(`${r.stdout ?? ""}${r.stderr ?? ""}`),
        error: `timed out after ${timeoutMs} ms, container removed`,
      };
    }
    if (code === "ENOENT") {
      return { exitCode: null, output: "", error: "Docker is not installed. Command NOT run." };
    }
    return { exitCode: null, output: "", error: `${r.error.message}. Command NOT run.` };
  }

  const output = clip(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (r.status === 125) {
    // 125 = Docker itself failed (daemon down, bad mount, image missing).
    return {
      exitCode: 125,
      output,
      error: `Docker could not start the sandbox. Command NOT run. ${output.trim()}`,
    };
  }
  return { exitCode: r.status, output };
}