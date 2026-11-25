import pino from "pino";

const redactPaths = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "phone",
  "*.phone",
  "email",
  "*.email",
  "req.headers.cookie",
  "req.headers.authorization",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "townmart-web" },
  redact: { paths: redactPaths, censor: "[redacted]" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
