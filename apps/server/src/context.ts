import type { Clock } from '@spendlygo/core';
import type { Database, DatabaseHandle } from '@spendlygo/db';
import type { Config } from './config.js';

/** Everything a request handler or bot command needs, passed explicitly. */
export interface AppContext {
  config: Config;
  db: Database;
  dbHandle: DatabaseHandle;
  clock: Clock;
}
