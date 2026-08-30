/**
 * Time is injected, never read ambiently.
 *
 * GUARDRAILS.md section 9: `new Date()` must not appear inside domain logic —
 * every period boundary, recurrence date, and "today" is a test case, and a
 * test case needs a pinned clock.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock frozen at a given instant. For tests and deterministic replays. */
export function fixedClock(instant: Date | string): Clock {
  const at = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(at.getTime())) {
    throw new TypeError(`fixedClock: invalid instant ${String(instant)}`);
  }
  return { now: () => new Date(at.getTime()) };
}
