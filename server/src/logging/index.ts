import pino from 'pino';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const isVitest = Boolean(process.env.VITEST);
const LOG_DIR = join(homedir(), '.pragents', 'logs');
if (!isVitest) mkdirSync(LOG_DIR, { recursive: true });

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(isVitest
    ? {}
    : {
        transport: {
          targets: [
            {
              target: 'pino/file',
              options: { destination: join(LOG_DIR, 'pragents.log') },
              level: 'debug',
            },
            {
              target: 'pino-pretty',
              options: { colorize: true },
              level: 'info',
            },
          ],
        },
      }),
});

export function childLogger(context: Record<string, string>) {
  return logger.child(context);
}
