import type { Context, MiddlewareFn } from "telegraf";

/** Reads the owner's Telegram user ID. Throws if it is missing or not a number. */
export function parseOwnerId(raw: string | undefined): number {
  const id = Number(raw?.trim());
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("TELEGRAM_OWNER_ID is missing or not a valid user ID.");
  }
  return id;
}

/** Runs before every handler. Only the owner, in a private chat, gets through. */
export function ownerOnly(ownerId: number): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (ctx.from?.id === ownerId && ctx.chat?.type === "private") {
      return next();
    }
    // Log only. Never reply, so strangers learn nothing.
    console.warn(
      `Blocked update: user=${ctx.from?.id} chat=${ctx.chat?.id} type=${ctx.updateType}`,
    );
  };
}