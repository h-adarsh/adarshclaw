import { randomBytes } from 'node:crypto';
import { Markup } from 'telegraf';
import type { Plan } from '../plan/types.ts';

export const PLAN_TTL_MS = 30 * 60_000;

export interface PlanSession {
  /** Random ID. Every button carries it, so an old plan message cannot control a newer plan. */
  id: string;
  createdAt: number;
  plan: Plan;
  selected: Set<string>;
}

export const planSessions = new Map<number, PlanSession>();

export function newPlanSession(plan: Plan): PlanSession {
  return {
    id: randomBytes(6).toString('hex'),
    createdAt: Date.now(),
    plan,
    selected: new Set(plan.steps.map((s) => s.id)),
  };
}

/** Returns the session only if the ID matches and it has not expired. */
export function getPlanSession(chatId: number, id: string, now = Date.now()) {
  const s = planSessions.get(chatId);
  if (!s) return undefined;
  if (now - s.createdAt > PLAN_TTL_MS) {
    planSessions.delete(chatId);
    return undefined;
  }
  return s.id === id ? s : undefined;
}

export function planMessage(session: PlanSession): string {
  const lines = session.plan.steps.map((step, i) => {
    const mark = session.selected.has(step.id) ? '✅' : '⬜';
    const tag = step.complexity ? ` [${step.complexity}]` : '';
    return `${mark} ${i + 1}. *${step.title}*${tag}`;
  });
  return [
    `📋 *Plan for:* ${session.plan.goal}`,
    '',
    ...lines,
    '',
    '_Tap steps to toggle, then hit Proceed._',
  ].join('\n');
}

export function planKeyboard(session: PlanSession) {
  const rows = session.plan.steps.map((step, i) => {
    const mark = session.selected.has(step.id) ? '✅' : '⬜';
    const label = `${mark} Step ${i + 1}: ${step.title}`;
    return [Markup.button.callback(label, `plan_toggle:${session.id}:${step.id}`)];
  });
  return Markup.inlineKeyboard([
    ...rows,
    [
      Markup.button.callback('✅ Select All', `plan_all:${session.id}`),
      Markup.button.callback('⬜ Deselect All', `plan_none:${session.id}`),
    ],
    [Markup.button.callback('🚀 Proceed', `plan_proceed:${session.id}`)],
  ]);
}

export async function refreshPlanUi(
  ctx: { editMessageText: (t: string, o: object) => Promise<unknown> },
  s: PlanSession,
) {
  await ctx.editMessageText(planMessage(s), {
    parse_mode: 'Markdown',
    reply_markup: planKeyboard(s).reply_markup,
  });
}