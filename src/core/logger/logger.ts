import pino from 'pino';

import type { Logger } from 'pino';

let rootLogger: Logger | undefined;

export function getLogger(name?: string): Logger {
  if (!rootLogger) {
    const level = process.env.LOG_LEVEL ?? 'info';
    const pretty = (process.env.LOG_PRETTY ?? 'true').toLowerCase() === 'true';
    rootLogger = pino(
      {
        level,
        base: undefined,
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pretty
        ? pino.transport({
            target: 'pino-pretty',
            options: { colorize: true, ignore: 'pid,hostname' },
          })
        : undefined,
    );
  }
  return name ? rootLogger.child({ scope: name }) : rootLogger;
}
