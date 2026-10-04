import { Telegraf, type Context } from "telegraf";
import chalk from "chalk";
import { ownerOnly } from "./auth";
import { registerHandlers } from "./handlers";

/** Builds the bot. The owner check is installed here, before any handler. */
export function buildBot(
  token: string,
  ownerId: number,
  options?: Partial<Telegraf.Options<Context>>,
) {
  const bot = new Telegraf(token, options);
  bot.catch((err) => console.error(chalk.red("Bot error:"), err));
  bot.use(ownerOnly(ownerId)); // must stay above registerHandlers
  registerHandlers(bot);
  return bot;
}