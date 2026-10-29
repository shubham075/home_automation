import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().default(8080),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_ADMIN_USER: z.string().min(1),
  MQTT_ADMIN_PASSWORD: z.string().min(12, 'MQTT_ADMIN_PASSWORD must be at least 12 characters'),
  MQTT_BOOTSTRAP_PASSWORD: z.string().min(12, 'MQTT_BOOTSTRAP_PASSWORD must be at least 12 characters'),
  DEV_AUTO_APPROVE_SITE: z.string().default(''),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  NODE_ENV: z.string().default('development'),
});

export const config = Env.parse(process.env);
