/**
 * Limits for one agent run.
 *
 * Time limit:   see RUN_DEADLINE_MS in modes/telegram/run-lock.ts
 * Step limit:   stepCountIs(n) where each agent is created
 * Token budget: this file. It is a rough cost cap, NOT a money cap:
 *   - it is checked after each step, so a run can overshoot by one step
 *   - input tokens are counted again on every step (the history is re-sent)
 *   - it knows tokens, not prices
 */

/** Default total tokens (input + output, all steps) before an agent run is stopped. */
export const DEFAULT_MAX_RUN_TOKENS = 1_000_000;

export function maxRunTokens(): number {
  const fromEnv = Number(process.env.ADARSHCLAW_MAX_TOKENS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_RUN_TOKENS;
}

type StepWithUsage = {
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
};

/** Total tokens used by all steps so far. Missing numbers count as 0. */
export function totalTokens(steps: StepWithUsage[]): number {
  let sum = 0;
  for (const s of steps) {
    const u = s.usage;
    if (!u) continue;
    sum += u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
  }
  return sum;
}

/** A stop condition for the AI SDK: stops the loop once the budget is used up. */
export function tokenBudgetExceeded(max: number = maxRunTokens()) {
  return ({ steps }: { steps: StepWithUsage[] }): boolean => totalTokens(steps) >= max;
}