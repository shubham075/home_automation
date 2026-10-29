import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { accessibleSites, requireUser, siteRole } from './auth';
import { CommandError, sendSet } from './commands';
import { config } from './config';
import { db } from './db';
import { clearFailures, lockedFor, recordFailure } from './lockout';
import { mqttClient } from './mqtt-client';
import { join } from './realtime';
import { issueRefreshToken, revokeByToken, rotateRefreshToken } from './tokens';
import { endpointViews } from './views';

// Web clients get the refresh token as an httpOnly cookie scoped to /api/auth.
// Native clients (Capacitor) send client:"native" and keep it in Keychain / Keystore.
const Client = z.enum(['web', 'native']).default('web');
const Login = z.object({ phone: z.string().min(8).max(20), password: z.string().min(1).max(200), client: Client });
const Refresh = z.object({ refreshToken: z.string().optional(), client: Client }).default({});
const CommandBody = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), on: z.boolean() }),
  z.object({ op: z.literal('toggle') }),
]);

const RT_COOKIE = 'sw6_rt';
// Verified when the phone is unknown, so response time does not reveal which numbers exist.
const dummyHash = hash('timing-equaliser-not-a-password');

function setRefreshCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(RT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.protocol === 'https',
    path: '/api/auth',
    maxAge: config.REFRESH_TOKEN_DAYS * 86_400,
  });
}

const clearRefreshCookie = (reply: FastifyReply) => reply.clearCookie(RT_COOKIE, { path: '/api/auth' });

export async function routes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, mqtt: mqttClient.connected }));

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = Login.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      const { phone, password, client } = body.data;

      const wait = lockedFor(phone);
      if (wait) return reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: wait });

      const user = await db.user.findUnique({ where: { phone } });
      const ok = await verify(user?.passwordHash ?? (await dummyHash), password);
      if (!user || !ok || user.status !== 'active') {
        recordFailure(phone);
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      clearFailures(phone);
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const { token } = await issueRefreshToken(user.id, req.headers['user-agent']);
      const res = { accessToken: app.jwt.sign({ sub: user.id }), user: { id: user.id, name: user.name, phone: user.phone } };
      if (client === 'native') return { ...res, refreshToken: token };
      setRefreshCookie(req, reply, token);
      return res;
    },
  );

  app.post(
    '/api/auth/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = Refresh.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      const presented = body.data.refreshToken ?? req.cookies[RT_COOKIE];
      if (!presented) return reply.code(401).send({ error: 'session_expired' });

      const result = await rotateRefreshToken(presented, req.headers['user-agent']);
      if (!result.ok) {
        if (result.reason === 'reused') req.log.warn({ reason: result.reason }, 'refresh token reuse: session family revoked');
        clearRefreshCookie(reply);
        return reply.code(401).send({ error: 'session_expired' });
      }

      const accessToken = app.jwt.sign({ sub: result.userId });
      if (body.data.client === 'native') return { accessToken, refreshToken: result.token ?? undefined };
      if (result.token) setRefreshCookie(req, reply, result.token);
      return { accessToken };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const body = Refresh.safeParse(req.body ?? {});
    const presented = (body.success && body.data.refreshToken) || req.cookies[RT_COOKIE];
    if (presented) await revokeByToken(presented);
    clearRefreshCookie(reply);
    return reply.code(204).send();
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
