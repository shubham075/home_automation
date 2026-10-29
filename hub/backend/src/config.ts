import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().default(8080),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  AUTO_REGISTER_DEVICES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  NODE_ENV: z.string().default('development'),
});

export const config = Env.parse(process.env);
