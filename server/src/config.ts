import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({
  path: path.resolve(process.cwd(), '.env'),
});

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  WS_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),
  MAX_VIEWERS: z.coerce.number().int().positive().default(3),
  MAX_FRAME_QUEUE: z.coerce.number().int().min(1).default(2),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://127.0.0.1:5173'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = envSchema.parse(process.env);

export const config = {
  port: parsed.PORT,
  sessionTtlMs: parsed.SESSION_TTL_MS,
  heartbeatMs: parsed.WS_HEARTBEAT_MS,
  maxViewers: parsed.MAX_VIEWERS,
  maxFrameQueue: parsed.MAX_FRAME_QUEUE,
  corsOrigins: parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
  logLevel: parsed.LOG_LEVEL,
};

