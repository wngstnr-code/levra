import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: { service: "api" },
    ...(pretty ? { transport: { target: "pino-pretty" } } : {}),
  });
}
