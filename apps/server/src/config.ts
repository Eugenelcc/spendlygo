/**
 * The only module that reads `process.env`.
 *
 * GUARDRAILS.md section 5: configuration is validated once, at boot, and fails
 * fast with a message naming the missing variable. An eslint rule forbids
 * `process.env` everywhere else in this app.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  BOT_TOKEN: z.string().min(20, 'BOT_TOKEN looks wrong — get it from @BotFather'),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .min(16, 'TELEGRAM_WEBHOOK_SECRET must be at least 16 characters'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a Postgres connection string'),

  MINIAPP_URL: z.string().min(1, 'MINIAPP_URL is required'),
  SERVER_URL: z.string().min(1).optional(),

  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),

  // Optional (PRD F4.6, ADR 0005): without it, photo attachments still work,
  // just without an amount pre-fill.
  OCR_SPACE_API_KEY: z.string().min(1).optional(),

  ALLOWED_TELEGRAM_IDS: z.string().default(''),

  DEFAULT_TIMEZONE: z.string().default('Asia/Singapore'),

  // The server registers its own Telegram webhook at boot so deploying needs no
  // local tooling. Set to "false" when a tunnel points a dev bot at localhost
  // and you do not want the deployed URL overwritten.
  AUTO_SET_WEBHOOK: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  nodeEnv: Env['NODE_ENV'];
  isProduction: boolean;
  port: number;
  botToken: string;
  /**
   * The value sent to Telegram as `secret_token` and compared against the
   * `X-Telegram-Bot-Api-Secret-Token` header. Derived — see
   * `deriveTelegramSecretToken`, and never equal to the configured secret.
   */
  webhookSecretToken: string;
  databaseUrl: string;
  miniappUrl: string;
  serverUrl: string | undefined;
  cronSecret: string;
  /** Undefined when unset — see `OCR_SPACE_API_KEY` above. */
  ocrSpaceApiKey: string | undefined;
  /** Empty means "no allowlist". GUARDRAILS.md section 4 wants this populated. */
  allowedTelegramIds: ReadonlySet<bigint>;
  defaultTimezone: string;
  autoSetWebhook: boolean;
  version: string;
}

/**
 * Render's dashboard shows a service address as a bare host, and its
 * `fromService` blueprint property returns `host:port`. Accepting both, rather
 * than demanding a scheme, means a value pasted from Render cannot fail boot.
 */
function normaliseOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withScheme).origin;
  } catch {
    throw new Error(`Not a usable URL or hostname: "${value}"`);
  }
}

/** Telegram's rule for `secret_token`: 1-256 chars of A-Z, a-z, 0-9, _ and -. */
const TELEGRAM_SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Turn any configured secret into one Telegram will accept.
 *
 * Telegram rejects a `secret_token` containing anything outside
 * `[A-Za-z0-9_-]`, and Render's `generateValue` produces base64-style values
 * that routinely include `+`, `/` or `=`. Rather than push that constraint
 * onto whoever sets the variable — which would mean generating secrets by hand
 * again — we hash it. SHA-256 hex is 64 characters drawn from `[0-9a-f]`, so
 * the result is always legal, always the same for a given input, and needs no
 * storage.
 *
 * The configured secret itself is therefore never sent to Telegram, which is a
 * small bonus: what crosses the wire is a hash of it.
 */
export function deriveTelegramSecretToken(secret: string): string {
  const token = createHash('sha256').update(secret, 'utf8').digest('hex');

  /* c8 ignore next 3 -- unreachable: hex output always matches the pattern. */
  if (!TELEGRAM_SECRET_TOKEN_PATTERN.test(token)) {
    throw new Error('Derived Telegram secret token is not URL-safe');
  }
  return token;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${formatIssues(parsed.error)}\n\n` +
        'Copy .env.example to .env and fill in the blanks.',
    );
  }

  const env = parsed.data;

  const allowedTelegramIds = new Set(
    env.ALLOWED_TELEGRAM_IDS.split(',')
      .map((value) => value.trim())
      .filter((value) => value !== '')
      .map((value) => {
        try {
          return BigInt(value);
        } catch {
          throw new Error(`ALLOWED_TELEGRAM_IDS contains a non-numeric id: "${value}"`);
        }
      }),
  );

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    botToken: env.BOT_TOKEN,
    webhookSecretToken: deriveTelegramSecretToken(env.TELEGRAM_WEBHOOK_SECRET),
    databaseUrl: env.DATABASE_URL,
    miniappUrl: normaliseOrigin(env.MINIAPP_URL),
    serverUrl: env.SERVER_URL ? normaliseOrigin(env.SERVER_URL) : undefined,
    cronSecret: env.CRON_SECRET,
    ocrSpaceApiKey: env.OCR_SPACE_API_KEY,
    allowedTelegramIds,
    defaultTimezone: env.DEFAULT_TIMEZONE,
    autoSetWebhook: env.AUTO_SET_WEBHOOK,
    version: process.env.npm_package_version ?? '0.1.0',
  };
}
