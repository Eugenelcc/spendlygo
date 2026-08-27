/**
 * Structured logging.
 *
 * GUARDRAILS.md section 6: amounts, notes, merchant names, photo contents and
 * raw initData are NEVER logged. Log identifiers, event kinds, durations and
 * outcomes — never the payload. `redact` exists so that rule is easy to follow.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

let minimumLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...fields,
  };

  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};

/** Reduce an error to something safe to log — never its payload or user data. */
export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message };
  }
  return { errorName: 'Unknown', errorMessage: String(error) };
}

/** Mask a value that must never appear in logs in full. */
export function redact(value: string | null | undefined): string {
  if (!value) return '(empty)';
  return `${value.slice(0, 3)}…(${value.length} chars)`;
}
