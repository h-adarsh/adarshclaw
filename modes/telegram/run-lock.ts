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