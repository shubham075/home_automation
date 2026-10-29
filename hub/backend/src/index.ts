import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { automationRoutes, startAutomationEngine } from './automations';
import { startBridge } from './bridge';
import { notificationRoutes } from './notifications';
import { config } from './config';
import { db, tuneDatabase } from './db';
import { mqttClient } from './mqtt-client';
import { routes } from './routes';
import { sceneRoutes } from './scenes';
import { topologyRoutes } from './topology';

const app = Fastify({
  logger: config.NODE_ENV === 'production' ? true : { transport: { target: 'pino-pretty' } },
});

await app.register(cors, { origin: true });
await app.register(cookie);
await app.register(rateLimit, { global: false }); // limits are set per route (login, refresh)
await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.ACCESS_TOKEN_TTL } });
await app.register(websocket);
await app.register(routes);
await app.register(topologyRoutes);
await app.register(sceneRoutes);
await app.register(automationRoutes);
await app.register(notificationRoutes);

await tuneDatabase();
startBridge(app.log);
startAutomationEngine(app.log);
await app.listen({ port: config.PORT, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    mqttClient.end();
    await db.$disconnect();
    process.exit(0);
  });
}
