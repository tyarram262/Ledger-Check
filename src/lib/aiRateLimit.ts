import { createClient } from "@/lib/supabase/server";

/**
 * Shared per-user budget across every endpoint that calls Claude
 * (`digest.ts`, `tradeReview.ts`) — the concern is aggregate AI spend per
 * user, not any one feature, so one budget covers both rather than
 * tracking them separately.
 *
 * Enforced via `check_ai_rate_limit`, a Postgres function using the same
 * `SECURITY INVOKER` + `for update` row-locking pattern as `record_sell`
 * (see CLAUDE.md's Database section) — a fixed-window counter, atomic
 * under concurrent requests. No Redis: Postgres is this app's only shared
 * store by design.
 */
const MAX_AI_CALLS_PER_WINDOW = 5;
const WINDOW_SECONDS = 60 * 60; // 1 hour

export async function checkAiRateLimit(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_ai_rate_limit", {
    p_max_calls: MAX_AI_CALLS_PER_WINDOW,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (error) throw new Error(error.message);
  if (data === false) {
    return {
      ok: false,
      error: `You've hit the AI review limit (${MAX_AI_CALLS_PER_WINDOW} per hour) — try again shortly.`,
    };
  }
  return { ok: true };
}
