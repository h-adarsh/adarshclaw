import type { Telegraf } from "telegraf";
import { WELCOME } from "./constants";
import { clip, commandArg } from "./text";
import { runAgent, runAsk, runPlanSteps, runWeb } from "./agent-run";
import { generatePlan } from "../plan/planner";
import {
  getPlanSession,
  newPlanSession,
  planKeyboard,
  planMessage,
  planSessions,
  refreshPlanUi,
} from "./plan-sessions";
import {
  approvalKeyboard,
  approvalSessions,
  fileActions,
  getSession,
  hasPendingApproval,
  reviewText,
  sendLong,
  shellActions,
} from "./approval-sessions";
import { finish, tryStart } from "./run-lock";
import { withNativeUpload } from "./telegram-upload";

// NOTE: there is no owner check in this file on purpose.
// bot.use(ownerOnly(...)) in bot.ts runs before every handler below.

/** Runs a task, always releases the lock, and tells the user if it failed. */
function runLocked(
  ctx: { reply: (t: string) => Promise<unknown> },
  chatId: number,
  task: () => Promise<unknown>,
) {
  void task()
    .catch(async (e) => {
      console.error(e);
      await ctx.reply("❌ The task failed. Details are in the terminal.").catch(() => {});
    })
    .finally(() => finish(chatId));
}

const WAITING = "⏳ You still have staged changes waiting for approval. Review or reject them first.";
const BUSY = "⏳ Another task is still running.";

export function registerHandlers(bot: Telegraf) {
  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME, { parse_mode: "Markdown" });
  });

  bot.command("ask", async (ctx) => {
    const q = commandArg(ctx.message.text, "ask");
    if (!q)
      return ctx.reply("Usage: `/ask <your question>`", {
        parse_mode: "Markdown",
      });

    await ctx.reply("🔍 Researching your question…");
    void runAsk(ctx, q).catch(console.error);
  });

  bot.command("web", async (ctx) => {
    const q = commandArg(ctx.message.text, "web");
    if (!q)
      return ctx.reply("Usage: `/web <your question>`", {
        parse_mode: "Markdown",
      });

    await ctx.reply("🌐 Searching the web… (this agent cannot see your files)");
    void runWeb(ctx, q).catch(console.error);
  });

  bot.command("agent", async (ctx) => {
    const goal = commandArg(ctx.message.text, "agent");
    if (!goal)
      return ctx.reply("Usage: `/agent <task description>`", {
        parse_mode: "Markdown",
      });

    const chatId = ctx.chat.id;
    if (hasPendingApproval(chatId)) return ctx.reply(WAITING);
    if (!tryStart(chatId)) return ctx.reply(BUSY);

    await ctx.reply("🤖 Agent is working on your task…");
    runLocked(ctx, chatId, () => runAgent(ctx, chatId, goal));
  });

  bot.command("plan", async (ctx) => {
    const goal = commandArg(ctx.message.text, "plan");
    if (!goal)
      return ctx.reply("Usage: `/plan <your goal>`", {
        parse_mode: "Markdown",
      });

    const chatId = ctx.chat.id;
    if (hasPendingApproval(chatId)) return ctx.reply(WAITING);
    if (!tryStart(chatId)) return ctx.reply(BUSY);

    await ctx.reply("🧭 Generating a plan…");
    runLocked(ctx, chatId, async () => {
      const plan = await generatePlan(goal);
      const session = newPlanSession(plan);
      planSessions.set(chatId, session); // set BEFORE the buttons exist
      await ctx.reply(planMessage(session), {
        parse_mode: "Markdown",
        ...planKeyboard(session),
      });
    });
  });

  // ---------- plan buttons: every one carries the plan session ID ----------

  const PLAN_EXPIRED = "This plan expired or was replaced.";

  bot.action(/^plan_toggle:([0-9a-f]{12}):(.+)$/, async (ctx) => {
    const s = getPlanSession(ctx.chat!.id, ctx.match[1]!);
    if (!s) return ctx.answerCbQuery(PLAN_EXPIRED, { show_alert: true });

    const stepId = ctx.match[2]!;
    if (!s.plan.steps.some((x) => x.id === stepId)) return ctx.answerCbQuery();
    if (s.selected.has(stepId)) s.selected.delete(stepId);
    else s.selected.add(stepId);

    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  bot.action(/^plan_all:([0-9a-f]{12})$/, async (ctx) => {
    const s = getPlanSession(ctx.chat!.id, ctx.match[1]!);
    if (!s) return ctx.answerCbQuery(PLAN_EXPIRED, { show_alert: true });
    for (const step of s.plan.steps) s.selected.add(step.id);
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  bot.action(/^plan_none:([0-9a-f]{12})$/, async (ctx) => {
    const s = getPlanSession(ctx.chat!.id, ctx.match[1]!);
    if (!s) return ctx.answerCbQuery(PLAN_EXPIRED, { show_alert: true });
    s.selected.clear();
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  bot.action(/^plan_proceed:([0-9a-f]{12})$/, async (ctx) => {
    const chatId = ctx.chat!.id;
    const s = getPlanSession(chatId, ctx.match[1]!);
    if (!s) return ctx.answerCbQuery(PLAN_EXPIRED, { show_alert: true });

    const steps = s.plan.steps.filter((step) => s.selected.has(step.id));
    if (steps.length === 0) return ctx.answerCbQuery("Select at least one step.");
    if (hasPendingApproval(chatId))
      return ctx.answerCbQuery("Finish the pending approval first.", { show_alert: true });
    if (!tryStart(chatId))
      return ctx.answerCbQuery("Another task is still running.", { show_alert: true });

    const { plan } = s;
    planSessions.delete(chatId);
    const list = steps.map((step, i) => `${i + 1}. ${step.title}`).join("\n");
    await ctx.editMessageText(`🚀 Executing ${steps.length} step(s)…\n\n${list}`);
    await ctx.answerCbQuery();

    runLocked(ctx, chatId, () => runPlanSteps(ctx, chatId, plan, steps));
  });

  // ---------- approval buttons: every one carries the approval session ID ----------

  bot.action(/^approval_(review|files|shell|reject):([0-9a-f]{12})$/, async (ctx) => {
    const chatId = ctx.chat!.id;
    const action = ctx.match[1]!;
    const s = getSession(chatId, ctx.match[2]!);
    if (!s) {
      return ctx.answerCbQuery("Expired or replaced. Nothing was applied.", {
        show_alert: true,
      });
    }
    if (s.busy) return ctx.answerCbQuery("Still working…");

    if (action === "reject") {
      for (const a of s.pending) s.tracker.updateStatus(a.id, "rejected", false);
      s.executor.clearStaging();
      approvalSessions.delete(chatId);
      await ctx.editMessageText(
        s.applied
          ? "❌ The remaining changes were rejected. What you already applied stays applied."
          : "❌ All changes rejected. Nothing was applied.",
      );
      return ctx.answerCbQuery("Rejected");
    }

    if (action === "review") {
      // Answer first so the button stops spinning, whatever happens next.
      await ctx.answerCbQuery("Sending the full review…");
      try {
        await sendLong(withNativeUpload(ctx), reviewText(s.pending), "changes.diff");
      } catch (e) {
        console.error("Review could not be sent:", (e as Error).message);
        await ctx.reply(
          "❌ I could not show you the full review, so nothing can be applied. " +
            "Reject these changes and ask for something smaller.",
        );
        return; // s.reviewed stays false
      }
      s.reviewed = true; // only after the full text went out
      await ctx.editMessageReplyMarkup(approvalKeyboard(s).reply_markup);
      return;
    }

    // "files" or "shell": nothing is applied before the full review was sent.
    if (!s.reviewed) {
      return ctx.answerCbQuery("Press Review first. You must see all changes.", {
        show_alert: true,
      });
    }

    const group = action === "files" ? fileActions(s.pending) : shellActions(s.pending);
    if (group.length === 0) return ctx.answerCbQuery();

    s.busy = true;
    try {
      // Answer first: running a command can take a while.
      await ctx.answerCbQuery(action === "files" ? "Applying…" : "Running in the sandbox…");

      // Approve ONLY this group. The other group stays pending and is not applied.
      for (const a of group) s.tracker.updateStatus(a.id, "approved", true);
      const { errors, shellResults } = s.executor.applyApprovedFromTracker();
      for (const a of group) s.tracker.updateStatus(a.id, "executed");
      s.applied = true;
      s.pending = s.pending.filter((a) => !group.includes(a));

      if (errors.length) await ctx.reply(clip(`⚠️ Problems:\n${errors.join("\n")}`));
      if (action === "shell") {
        for (const r of shellResults) {
          const head = `$ ${r.command}\nexit: ${r.exitCode ?? "n/a"}${r.error ? `\nerror: ${r.error}` : ""}`;
          await sendLong(withNativeUpload(ctx), `${head}\n\n${r.output || "(no output)"}`, "shell-output.txt");
        }
      }

      if (s.pending.length === 0) {
        approvalSessions.delete(chatId);
        s.executor.clearStaging();
        await ctx.editMessageText("✅ Done. Everything you approved has been applied.");
      } else {
        await ctx.editMessageReplyMarkup(approvalKeyboard(s).reply_markup);
      }
    } finally {
      s.busy = false;
    }
  });
}