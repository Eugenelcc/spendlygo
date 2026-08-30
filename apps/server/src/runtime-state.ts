/**
 * Boot progress, readable from `/healthz`.
 *
 * Diagnosing "the bot does nothing" otherwise means scrolling a deploy log for
 * a single line. These flags put the same answer behind a URL anyone can open,
 * and they are plain booleans so `/healthz` stays dependency-free
 * (GUARDRAILS.md section 7).
 */

export type BotState = 'starting' | 'ready';
export type WebhookState = 'pending' | 'registered' | 'rejected' | 'skipped';

export interface RuntimeState {
  bot: BotState;
  webhook: WebhookState;
}

export function createRuntimeState(): RuntimeState {
  return { bot: 'starting', webhook: 'pending' };
}
