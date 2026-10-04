import fs from "node:fs";
import path from "node:path";

function isInside(root: string, target: string): boolean {
  const r = path.relative(root, target);
  return r === "" || (r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r));
}

/**
 * Follows symlinks and finds where `abs` REALLY points.
 * Returns that place relative to the real workspace root.
 * Throws if it is outside the workspace.
 *
 * Works for paths that do not exist yet (new files): it resolves the
 * nearest part that exists, then adds the missing part back.
 */
export function realRelativeInside(root: string, abs: string): string {
  if (abs.includes("\0")) throw new Error("Invalid path");
  const realRoot = fs.realpathSync(root);

  // lstat counts a broken symlink as "existing", so it cannot hide behind a missing target.
  let probe = abs;
  const missing: string[] = [];
  for (;;) {
    try {
      fs.lstatSync(probe);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      missing.unshift(path.basename(probe));
      probe = parent;
    }
  }

  let realProbe: string;
  try {
    realProbe = fs.realpathSync(probe);
  } catch {
    throw new Error(`Path escapes workspace (broken symlink): ${abs}`);
  }

  const real = path.join(realProbe, ...missing);
  if (!isInside(realRoot, real)) {
    throw new Error(`Path escapes workspace: ${abs}`);
  }
  return path.relative(realRoot, real);
}
