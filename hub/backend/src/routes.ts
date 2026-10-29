import type { FastifyInstance } from 'fastify';
import { verify } from '@node-rs/argon2';
import { z } from 'zod';
import { accessibleSites, requireUser, siteRole } from './auth';
import { CommandError, sendSet } from './commands';
import { db } from './db';
import { mqttClient } from './mqtt-client';
import { join } from './realtime';
import { endpointViews } from './views';

const Login = z.object({ phone: z.string().min(8), password: z.string().min(1) });
const CommandBody = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), on: z.boolean() }),
  z.object({ op: z.literal('toggle') }),
]);

export async function routes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, mqtt: mqttClient.connected }));

  app.post('/api/auth/login', async (req, reply) => {
    const body = Login.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const user = await db.user.findUnique({ where: { phone: body.data.phone } });
    const ok = user?.passwordHash && user.status === 'active' && (await verify(user.passwordHash, body.data.password));
    if (!user || !ok) return reply.code(401).send({ error: 'invalid_credentials' });

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { accessToken: app.jwt.sign({ sub: user.id }), user: { id: user.id, name: user.name, phone: user.phone } };
  });

  app.get('/api/me', { onRequest: requireUser }, async (req) => {
    const { user, sites } = await accessibleSites(req.user.sub);
    return { user: { id: user.id, name: user.name, phone: user.phone }, sites };
  });

  app.get<{ Params: { siteId: string } }>('/api/sites/:siteId/endpoints', { onRequest: requireUser }, async (req, reply) => {
    if (!(await siteRole(req.user.sub, req.params.siteId))) return reply.code(403).send({ error: 'forbidden' });
    return { endpoints: await endpointViews({ device: { siteId: req.params.siteId, deletedAt: null } }) };
  });

  app.post<{ Params: { id: string } }>('/api/endpoints/:id/command', { onRequest: requireUser }, async (req, reply) => {
    const body = CommandBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

    const ep = await db.endpoint.findUnique({ where: { id: req.params.id }, select: { device: { select: { siteId: true } } } });
    const siteId = ep?.device.siteId;
    if (!siteId) return reply.code(404).send({ error: 'endpoint_not_found' });
    if (!(await siteRole(req.user.sub, siteId))) return reply.code(403).send({ error: 'forbidden' });

    try {
      const result = await sendSet({
        endpointId: req.params.id,
        on: body.data.op === 'set' ? body.data.on : undefined,
        userId: req.user.sub,
      });
      return reply.code(202).send(result);
    } catch (err) {
      if (err instanceof CommandError) return reply.code(err.httpStatus).send({ error: err.code });
      throw err;
    }
  });

  // Browsers cannot set headers on WebSocket, so the access token comes as ?token=.
  app.get<{ Querystring: { token?: string } }>('/ws', { websocket: true }, async (socket, req) => {
    try {
      const { sub } = app.jwt.verify<{ sub: string }>(req.query.token ?? '');
      const { sites } = await accessibleSites(sub);
      join(socket, sites.map((s) => s.id));
    } catch {
      socket.close(4401, 'unauthorized');
    }
  });
}
