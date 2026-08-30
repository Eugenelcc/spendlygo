/**
 * The contract between the server and the Mini App.
 *
 * Both sides import these schemas, so a change to a response shape is a
 * typecheck failure rather than a runtime surprise. Amounts always cross the
 * wire as integer cents (GUARDRAILS.md section 2).
 */

import { z } from 'zod';

// --- primitives -------------------------------------------------------------

export const directionSchema = z.enum(['in', 'out']);
export type Direction = z.infer<typeof directionSchema>;

export const transactionSourceSchema = z.enum(['chat', 'miniapp', 'recurring']);
export type TransactionSource = z.infer<typeof transactionSourceSchema>;

export const categoryKindSchema = z.enum(['expense', 'income']);
export type CategoryKind = z.infer<typeof categoryKindSchema>;

export const cadenceSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
export type Cadence = z.infer<typeof cadenceSchema>;

export const paceSchema = z.enum(['ahead', 'on_track', 'behind', 'over_budget']);
export type Pace = z.infer<typeof paceSchema>;

/** Integer minor units. Never a decimal — see GUARDRAILS.md section 2. */
export const amountCentsSchema = z
  .number()
  .int('Amounts must be whole cents')
  .positive('Amount must be greater than zero')
  .max(1_000_000_000, 'Amount is implausibly large');

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

// --- errors -----------------------------------------------------------------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Present only for validation failures. */
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// --- GET /healthz -----------------------------------------------------------

/**
 * `bot` and `webhook` are in-memory flags, not live checks — `/healthz` must
 * stay dependency-free (GUARDRAILS.md section 7). They exist so the state that
 * usually requires reading deploy logs can be read from a browser instead.
 * Deliberately free of URLs, tokens and counts, since this endpoint is public.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number(),
  bot: z.enum(['starting', 'ready']),
  webhook: z.enum(['pending', 'registered', 'rejected', 'skipped']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// --- GET /api/me ------------------------------------------------------------

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    telegramId: z.string(),
    firstName: z.string().nullable(),
    username: z.string().nullable(),
    timezone: z.string(),
    currency: z.string(),
    locale: z.string(),
    monthlyBudgetCents: z.number().int().nonnegative().nullable(),
    digestHour: z.number().int().min(0).max(23),
    digestEnabled: z.boolean(),
    nudgeEnabled: z.boolean(),
    onboardedAt: z.string().datetime().nullable(),
  }),
  /** Today's date in the user's timezone — the client must not compute this. */
  today: isoDateSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// --- GET /api/categories ----------------------------------------------------

export const categorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  emoji: z.string(),
  colorToken: z.string(),
  kind: categoryKindSchema,
  excludeFromBudget: z.boolean(),
  sortOrder: z.number().int(),
});
export type Category = z.infer<typeof categorySchema>;

export const categoriesResponseSchema = z.object({
  categories: z.array(categorySchema),
});
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;

// --- POST /tasks/tick -------------------------------------------------------

export const tickResponseSchema = z.object({
  ok: z.literal(true),
  ranAt: z.string().datetime(),
  recurringMaterialised: z.number().int().nonnegative(),
  digestsSent: z.number().int().nonnegative(),
});
export type TickResponse = z.infer<typeof tickResponseSchema>;
