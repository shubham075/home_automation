import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { startBridge } from './bridge';
import { config } from './config';
import { db } from './db';
import { mqttClient } from './mqtt-client';
import { routes } from './routes';

const app = Fastify({
  logger: config.NODE_ENV === 'production' ? true : { transport: { target: 'pino-pretty' } },
});

await app.register(cors, { origin: true });
await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.ACCESS_TOKEN_TTL } });
await app.register(websocket);
await app.register(routes);

startBridge(app.log);
await app.listen({ port: config.PORT, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    mqttClient.end();
    await db.$disconnect();
    process.exit(0);
  });
}
