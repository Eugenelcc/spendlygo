import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  BOT_TOKEN: '111111:AAH-token-long-enough-for-schema',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-0123456789',
  DATABASE_URL: 'postgresql://user:pass@host:6543/db',
  CRON_SECRET: 'cron-secret-0123456789',
  MINIAPP_URL: 'https://spendlygo-app.onrender.com',
};

describe('loadConfig', () => {
  it('fails fast and names every missing variable', () => {
    expect(() => loadConfig({})).toThrow(/BOT_TOKEN/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({})).toThrow(/CRON_SECRET/);
  });

  it('accepts a bare hostname, as Render shows it in the dashboard', () => {
    const config = loadConfig({ ...base, MINIAPP_URL: 'spendlygo-app.onrender.com' });
    expect(config.miniappUrl).toBe('https://spendlygo-app.onrender.com');
  });

  it("accepts Render's host:port form from a blueprint fromService value", () => {
    const config = loadConfig({ ...base, MINIAPP_URL: 'spendlygo-app.onrender.com:443' });
    expect(config.miniappUrl).toBe('https://spendlygo-app.onrender.com');
  });

  it('strips a trailing slash so URLs are never built with a double slash', () => {
    const config = loadConfig({ ...base, MINIAPP_URL: 'https://spendlygo-app.onrender.com/' });
    expect(config.miniappUrl).toBe('https://spendlygo-app.onrender.com');
  });

  it('parses the allowlist into telegram ids', () => {
    const config = loadConfig({ ...base, ALLOWED_TELEGRAM_IDS: '123, 456 ,789' });
    expect(config.allowedTelegramIds).toEqual(new Set([123n, 456n, 789n]));
  });

  it('treats an empty allowlist as "no allowlist"', () => {
    expect(loadConfig({ ...base }).allowedTelegramIds.size).toBe(0);
  });

  it('rejects a non-numeric telegram id rather than silently dropping it', () => {
    expect(() => loadConfig({ ...base, ALLOWED_TELEGRAM_IDS: '123,eugene' })).toThrow(
      /non-numeric/,
    );
  });

  it('defaults the timezone to Singapore', () => {
    expect(loadConfig(base).defaultTimezone).toBe('Asia/Singapore');
  });
});
