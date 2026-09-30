import { Telegraf } from "telegraf";
import chalk from "chalk";
import { WELCOME } from "./constants";
import { registerHandlers } from "./handlers";

export async function runTelegramMode() {
  console.log("runTelegramMode started");

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const ownerId = process.env.TELEGRAM_OWNER_ID?.trim();
  if (!token || !ownerId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID. Check your .env path.");
  }

  const bot = new Telegraf(token);
  bot.catch((err) => console.error(chalk.red("Bot error:"), err));
  registerHandlers(bot);

  const me = await bot.telegram.getMe(); // fails right away on a wrong token
  console.log(chalk.green(`Connected as @${me.username}`));

  try {
    await bot.telegram.sendMessage(ownerId, WELCOME, { parse_mode: "Markdown" });
    console.log(chalk.green("Sent welcome message."));
  } catch (e) {
    console.error(chalk.red("Welcome message failed. Wrong owner ID, or you never pressed Start on the bot:"), e);
  }

  bot.launch().catch((e) => {
    console.error(chalk.red("Launch failed (401 = bad token, 409 = another copy is running):"), e);
    process.exit(1);
  });
  console.log(chalk.green("Bot is running. Ctrl+C to stop."));

  await new Promise<void>((done) => {
    const stop = () => { bot.stop("SIGINT"); done(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}