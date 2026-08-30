/**
 * The only module that reads `process.env`.
 *
 * GUARDRAILS.md section 5: configuration is validated once, at boot, and fails
 * fast with a message naming the missing variable. An eslint rule forbids
 * `process.env` everywhere else in this app.
 */

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

  ALLOWED_TELEGRAM_IDS: z.string().default(''),

  DEFAULT_TIMEZONE: z.string().default('Asia/Singapore'),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  nodeEnv: Env['NODE_ENV'];
  isProduction: boolean;
  port: number;
  botToken: string;
  webhookSecret: string;
  databaseUrl: string;
  miniappUrl: string;
  serverUrl: string | undefined;
  cronSecret: string;
  /** Empty means "no allowlist". GUARDRAILS.md section 4 wants this populated. */
  allowedTelegramIds: ReadonlySet<bigint>;
  defaultTimezone: string;
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
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    databaseUrl: env.DATABASE_URL,
    miniappUrl: normaliseOrigin(env.MINIAPP_URL),
    serverUrl: env.SERVER_URL ? normaliseOrigin(env.SERVER_URL) : undefined,
    cronSecret: env.CRON_SECRET,
    allowedTelegramIds,
    defaultTimezone: env.DEFAULT_TIMEZONE,
    version: process.env.npm_package_version ?? '0.1.0',
  };
}
