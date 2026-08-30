import { describe, expect, it } from 'vitest';
import { deriveTelegramSecretToken } from '../config.js';

/** Telegram: 1-256 characters, only A-Z, a-z, 0-9, _ and - are allowed. */
const TELEGRAM_ALLOWED = /^[A-Za-z0-9_-]{1,256}$/;

describe('deriveTelegramSecretToken', () => {
  it('produces a token Telegram accepts from a value it would reject', () => {
    // The shape Render's generateValue emits — base64, with the characters
    // that earned us "400: secret token contains illegal characters".
    const rendersValue = 'aB3+xY9/kL2mN8pQ4rS6tU0vW1zA5cD7eF=';
    expect(TELEGRAM_ALLOWED.test(rendersValue)).toBe(false);

    const token = deriveTelegramSecretToken(rendersValue);
    expect(TELEGRAM_ALLOWED.test(token)).toBe(true);
    expect(token).toHaveLength(64);
  });

  it.each([
    ['base64 padding', 'abcd1234efgh5678=='],
    ['slashes and plus', 'a/b+c/d+e/f+g/h+i'],
    ['punctuation', 'p@ssw0rd!#$%^&*()'],
    ['spaces', 'a secret with spaces'],
    ['unicode', 'ünïcodë-sécrét-værdi'],
    ['already legal', 'already_legal-Token123'],
  ])('handles %s', (_label, input) => {
    expect(TELEGRAM_ALLOWED.test(deriveTelegramSecretToken(input))).toBe(true);
  });

  it('is stable, so a restart keeps matching the registered webhook', () => {
    const secret = 'some-secret-value';
    expect(deriveTelegramSecretToken(secret)).toBe(deriveTelegramSecretToken(secret));
  });

  it('never returns the configured secret itself', () => {
    const secret = 'already_legal-Token123';
    expect(deriveTelegramSecretToken(secret)).not.toBe(secret);
  });

  it('gives different secrets different tokens', () => {
    expect(deriveTelegramSecretToken('secret-a')).not.toBe(deriveTelegramSecretToken('secret-b'));
  });
});
