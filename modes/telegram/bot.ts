import { Telegraf, type Context } from "telegraf";
import chalk from "chalk";
import { ownerOnly } from "./auth";
import { registerHandlers } from "./handlers";
import { noLinkPreviews } from "./no-link-previews";

/** Builds the bot. The owner check is installed here, before any handler. */
export function buildBot(
  token: string,
  ownerId: number,
  options?: Partial<Telegraf.Options<Context>>,
) {
  const bot = new Telegraf(token, options);
  bot.catch((err) => console.error(chalk.red("Bot error:"), err));
  bot.use(ownerOnly(ownerId)); // must stay above registerHandlers
  bot.use(noLinkPreviews); // no automatic link fetching by Telegram
  registerHandlers(bot);
  return bot;
}