import { describe, expect, it } from 'vitest';
import { fixedClock } from '@spendlygo/core';
import { desiredWebhookUrl } from './index.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';

function contextWith(overrides: Partial<Config>): AppContext {
  const config = {
    nodeEnv: 'production',
    isProduction: true,
    port: 3000,
    botToken: '111111:token',
    webhookSecretToken: 'secret-secret-secret',
    databaseUrl: 'postgresql://localhost/db',
    miniappUrl: 'https://spendlygo-app.onrender.com',
    serverUrl: 'https://spendlygo-api.onrender.com',
    cronSecret: 'cron-cron-cron-cron',
    allowedTelegramIds: new Set<bigint>(),
    defaultTimezone: 'Asia/Singapore',
    autoSetWebhook: true,
    version: 'test',
    ...overrides,
  } satisfies Config;

  return {
    config,
    db: null as never,
    dbHandle: null as never,
    clock: fixedClock('2026-08-27T04:00:00Z'),
  };
}

describe('desiredWebhookUrl', () => {
  it('builds the webhook URL from the server origin', () => {
    expect(desiredWebhookUrl(contextWith({}))).toBe(
      'https://spendlygo-api.onrender.com/telegram/webhook',
    );
  });

  it('does not register when auto-registration is switched off', () => {
    expect(desiredWebhookUrl(contextWith({ autoSetWebhook: false }))).toBeNull();
  });

  it('does not register a plain-HTTP origin — Telegram rejects those', () => {
    expect(desiredWebhookUrl(contextWith({ serverUrl: 'http://localhost:3000' }))).toBeNull();
  });

  it('does not register when the server origin is unknown', () => {
    expect(desiredWebhookUrl(contextWith({ serverUrl: undefined }))).toBeNull();
  });
});
