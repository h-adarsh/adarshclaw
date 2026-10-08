import fs from "node:fs";
import path from "node:path";

/** Passed by bin/adarshclaw. Command-line arguments cannot be set by files in a repository. */
export const TRUSTED_LAUNCH_FLAG = "--adarshclaw-trusted-launch";

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * adarshclaw may start if it was started by bin/adarshclaw, or if the current
 * directory IS the adarshclaw project (a folder you trust).
 *
 * LIMIT: this check runs inside adarshclaw, after Bun already read bunfig.toml and .env.
 * It cannot undo a "preload" that already ran. Only the launcher prevents that.
 * What this check does: refuse to continue, and tell you why.
 */
export function checkLaunch(opts: {
  cwd: string;
  projectDir: string;
  argv: string[];
}): { ok: true } | { ok: false; reason: string } {
  if (real(opts.cwd) === real(opts.projectDir)) return { ok: true };
  if (opts.argv.includes(TRUSTED_LAUNCH_FLAG)) return { ok: true };

  return {
    ok: false,
    reason: [
      "adarshclaw refused to start.",
      "It was not started through bin/adarshclaw, and this is not the adarshclaw project folder.",
      "",
      "Bun reads bunfig.toml and .env files from the current directory when it starts.",
      "In a folder you do not control, that can run code or change settings before adarshclaw starts.",
      "(If this folder is not yours, assume that could already have happened.)",
      "",
      `Start it with:  ${path.join(opts.projectDir, "bin", "adarshclaw")}`,
    ].join("\n"),
  };
}

export const stripLaunchFlag = (argv: string[]) => argv.filter((a) => a !== TRUSTED_LAUNCH_FLAG);