const running = new Set<number>();

/** Returns false if a task is already running for this chat. */
export function tryStart(chatId: number): boolean {
  if (running.has(chatId)) return false;
  running.add(chatId);
  return true;
}

export function finish(chatId: number): void {
  running.delete(chatId);
}

export function isRunning(chatId: number): boolean {
  return running.has(chatId);
}

// ---------- time limit ----------

/** One task may run at most this long. */
export const RUN_DEADLINE_MS = 10 * 60_000;

export class DeadlineError extends Error {
  constructor(public readonly ms: number) {
    super(`Task exceeded ${ms} ms`);
    this.name = "DeadlineError";
  }
}

/**
 * Runs a task with a time limit.
 *  - The task gets an AbortSignal that is aborted at the deadline.
 *  - The caller gets a DeadlineError at the deadline EVEN IF the task ignores the signal
 *    (for example a hung network call), so nothing waits forever.
 * A task should check `signal.aborted` after each await, so that a late finish
 * sends no messages and stages nothing.
 */
export async function runWithDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number = RUN_DEADLINE_MS,
): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new DeadlineError(ms));
    }, ms);
  });
  try {
    const running = task(ctrl.signal);
    running.catch(() => {}); // a failure after the deadline must not crash the process
    return await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs a task for one chat with the lock and a time limit.
 * The lock is ALWAYS released: after success, after an error, and after the deadline.
 */
export function runLocked(
  chatId: number,
  task: (signal: AbortSignal) => Promise<unknown>,
  onError: (e: unknown) => unknown,
  ms: number = RUN_DEADLINE_MS,
): void {
  void runWithDeadline(task, ms)
    .catch(async (e) => {
      try {
        await onError(e);
      } catch {
        // reporting must never keep the lock held
      }
    })
    .finally(() => finish(chatId));
}