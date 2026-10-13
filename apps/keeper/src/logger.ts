import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: { service: "keeper" },
    // Keys never reach the log, even if a key or the environment ends up in a logged object by mistake (BE-55).
    redact: { paths: ["privateKey", "*.privateKey", "key", "*.key", "env", "*.env"], censor: "[redacted]" },
    ...(pretty ? { transport: { target: "pino-pretty" } } : {}),
  });
}
