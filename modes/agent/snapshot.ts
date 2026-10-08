import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { sanitizeForTerminal } from "../../tui/safe-text.ts";

/**
 * Shows what a shell command REALLY changed in the workspace.
 *
 * Why not `git diff`?
 *  - git hides everything in .gitignore, and a command can write there
 *  - git does not work outside a git repository
 *  - git can run programs named in a repository's own config (filters, fsmonitor)
 *
 * This reads the files itself: it compares a content hash before and after.
 * It runs no external program and does not look at .gitignore.
 */

export interface SnapshotOptions {
  maxEntries?: number; // stop walking after this many entries
  maxHashBytes?: number; // files up to this size are hashed by content
  maxTextBytes?: number; // text files up to this size are kept for a diff
  maxTotalTextBytes?: number; // memory budget for kept text
  skipDirs?: string[]; // directories whose CONTENT is not read (at any depth)
}

const DEFAULTS: Required<SnapshotOptions> = {
  maxEntries: 20_000,
  maxHashBytes: 2_000_000,
  maxTextBytes: 100_000,
  maxTotalTextBytes: 20_000_000,
  // .git and node_modules are mounted read-only in the sandbox, so a command cannot change them.
  skipDirs: [".git", "node_modules"],
};

export interface Entry {
  kind: "file" | "dir" | "symlink";
  /** Changes whenever the content, the permissions, the link target or the type changes. */
  sig: string;
  text?: string;
}

export interface Snapshot {
  entries: Map<string, Entry>;
  /** True if the workspace had more entries than maxEntries: the snapshot is incomplete. */
  partial: boolean;
}

export function takeSnapshot(root: string, options: SnapshotOptions = {}): Snapshot {
  const o = { ...DEFAULTS, ...options };
  const entries = new Map<string, Entry>();
  let partial = false;
  let textBudget = o.maxTotalTextBytes;

  const walk = (dir: string, rel: string) => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of dirents) {
      if (entries.size >= o.maxEntries) {
        partial = true;
        return;
      }
      const relP = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(full); // lstat: never follow symlinks
      } catch {
        continue;
      }
      const mode = (st.mode & 0o777).toString(8);

      if (st.isSymbolicLink()) {
        let target = "?";
        try {
          target = fs.readlinkSync(full);
        } catch {}
        entries.set(relP, { kind: "symlink", sig: `l:${target}` });
        continue;
      }
      if (st.isDirectory()) {
        entries.set(relP, { kind: "dir", sig: `d:${mode}` });
        if (!o.skipDirs.includes(ent.name)) walk(full, relP);
        continue;
      }
      if (!st.isFile()) continue; // sockets, pipes, devices

      let sig: string;
      let text: string | undefined;
      if (st.size <= o.maxHashBytes) {
        const buf = fs.readFileSync(full);
        sig = `f:${mode}:${createHash("sha256").update(buf).digest("hex")}`;
        const looksLikeText = !buf.subarray(0, 8000).includes(0);
        if (looksLikeText && st.size <= o.maxTextBytes && textBudget >= st.size) {
          text = buf.toString("utf8");
          textBudget -= st.size;
        }
      } else {
        // Too big to read: size and modification time. A content change that keeps both is not detected.
        sig = `f:${mode}:big:${st.size}:${Math.floor(st.mtimeMs)}`;
      }
      entries.set(relP, { kind: "file", sig, text });
    }
  };

  walk(root, "");
  return { entries, partial };
}

export interface Changes {
  added: string[];
  modified: string[];
  deleted: string[];
  partial: boolean;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): Changes {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [p, e] of after.entries) {
    const b = before.entries.get(p);
    if (!b) added.push(p);
    else if (b.sig !== e.sig || b.kind !== e.kind) modified.push(p);
  }
  for (const p of before.entries.keys()) if (!after.entries.has(p)) deleted.push(p);
  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    partial: before.partial || after.partial,
  };
}

const MAX_PATCH_CHARS = 100_000;

/**
 * A readable report. The list of changed paths is always complete.
 * Contents are shown for small text files, up to a size limit.
 * Everything is passed through sanitizeForTerminal, so file names and file contents
 * cannot carry escape sequences into a terminal.
 */
export function formatChanges(before: Snapshot, after: Snapshot, c: Changes): string {
  const out: string[] = [];
  const total = c.added.length + c.modified.length + c.deleted.length;

  if (total === 0) {
    out.push("The shell commands changed no files in the workspace (compared by content, not by git).");
  } else {
    out.push(
      `Files changed by the shell commands: ${c.added.length} added, ${c.modified.length} modified, ${c.deleted.length} deleted`,
    );
    for (const p of c.added) out.push(`  + ${p}`);
    for (const p of c.modified) out.push(`  ~ ${p}`);
    for (const p of c.deleted) out.push(`  - ${p}`);
  }
  if (c.partial) {
    out.push("WARNING: INCOMPLETE. The workspace has more entries than this check reads, so some changes may not be listed.");
  }
  out.push("(.git and node_modules are not compared. They are mounted read-only in the sandbox.)");

  let used = 0;
  let skipped = 0;
  const details: string[] = [];
  for (const p of [...c.modified, ...c.added, ...c.deleted]) {
    const b = before.entries.get(p);
    const a = after.entries.get(p);
    let piece: string;
    if (a?.kind === "symlink" || b?.kind === "symlink") {
      piece = `${p}: symlink ${b?.sig.slice(2) ?? "(none)"} -> ${a?.sig.slice(2) ?? "(none)"}`;
    } else if (a?.kind === "dir" || b?.kind === "dir") {
      continue; // the list above already shows created or removed directories
    } else {
      const bt = b?.kind === "file" ? b.text : "";
      const at = a?.kind === "file" ? a.text : "";
      if (bt !== undefined && at !== undefined) {
        piece = createTwoFilesPatch(p, p, bt, at, "", "", { context: 3 });
      } else {
        piece = `${p}: binary, large or unreadable file, content not shown`;
      }
    }
    if (used + piece.length > MAX_PATCH_CHARS) {
      skipped++;
      continue;
    }
    used += piece.length;
    details.push(piece);
  }
  if (details.length) out.push("", ...details);
  if (skipped) out.push("", `${skipped} more file(s) not shown in detail (output limit). They are listed above.`);

  return sanitizeForTerminal(out.join("\n"));
}