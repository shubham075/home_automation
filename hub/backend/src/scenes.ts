// Scenes: saved sets of channel states, plus the built-in "All off" and per-room off.
// Running waits for every device ack so the app can say exactly which channels did not respond.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CAN, type ActionResult, type RunResult, type SceneAction, type SceneView } from '@sw6/protocol';
import { guardSite, requireUser } from './auth';
import { CommandError, sendSet } from './commands';
import { db } from './db';
import { broadcast } from './realtime';
import { parseBody } from './topology';

const ALL_OFF = 'all-off';

const SceneBody = z.object({
  name: z.string().trim().min(1).max(40),
  icon: z.string().max(20).nullable().default(null),
  roomId: z.string().nullable().default(null),
  actions: z.array(z.object({ endpointId: z.string(), on: z.boolean() })).min(1).max(64),
});

export async function runActions(
  siteId: string,
  actions: SceneAction[],
  userId: string | null,
  name: string,
  source: 'scene' | 'automation' = 'scene',
): Promise<RunResult> {
  const results = await Promise.all(
    actions.map(async ({ endpointId, on }): Promise<ActionResult> => {
      try {
        const { result } = await sendSet({ endpointId, on, userId: userId ?? undefined, source });
        return { endpointId, status: await result };
      } catch (err) {
        return { endpointId, status: err instanceof CommandError && err.code === 'device_offline' ? 'offline' : 'failed' };
      }
    }),
  );
  await db.auditLog.create({
    data: {
      siteId,
      actorType: userId ? 'user' : 'automation',
      actorId: userId,
      action: 'scene.run',
      data: { name, ok: results.filter((r) => r.status === 'acked').length, total: results.length },
    },
  });
  return { name, results };
}

/** Every action must target a relay endpoint on this site, at most once. */
async function validActions(siteId: string, actions: SceneAction[]) {
  const ids = actions.map((a) => a.endpointId);
  if (new Set(ids).size !== ids.length) return false;
  const owned = await db.endpoint.count({ where: { id: { in: ids }, kind: 'relay', device: { siteId, deletedAt: null } } });
  return owned === ids.length;
}

const toView = (s: { id: string; name: string; icon: string | null; roomId: string | null; actions: { endpointId: string; target: unknown }[] }): SceneView => ({
  id: s.id,
  name: s.name,
  icon: s.icon,
  roomId: s.roomId,
  builtin: false,
  actions: s.actions.map((a) => ({ endpointId: a.endpointId, on: (a.target as { on: boolean }).on })),
});

export async function sceneRoutes(app: FastifyInstance) {
  const auth = { onRequest: requireUser };

  app.get<{ Params: { siteId: string } }>('/api/sites/:siteId/scenes', auth, async (req, reply) => {
    if (!(await guardSite(req, reply, req.params.siteId, CAN.control))) return;
    const rows = await db.scene.findMany({ where: { siteId: req.params.siteId }, include: { actions: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const allOff: SceneView = { id: ALL_OFF, name: 'All off', icon: 'power', roomId: null, builtin: true, actions: [] };
    return { scenes: [allOff, ...rows.map(toView)] };
  });

  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/scenes', auth, async (req, reply) => {
    const { siteId } = req.params;
    if (!(await guardSite(req, reply, siteId, CAN.editScenes))) return;
    const body = parseBody(SceneBody, req.body, reply);
    if (!body) return;
    if (!(await validActions(siteId, body.actions))) return reply.code(400).send({ error: 'invalid_actions' });
    const scene = await db.scene.create({
      data: {
        siteId,
        name: body.name,
        icon: body.icon,
        roomId: body.roomId,
        actions: { create: body.actions.map((a) => ({ endpointId: a.endpointId, target: { on: a.on } })) },
      },
      include: { actions: true },
    });
    broadcast(siteId, { type: 'scenes.changed' });
    return reply.code(201).send(toView(scene));
  });

  app.put<{ Params: { id: string } }>('/api/scenes/:id', auth, async (req, reply) => {
    const scene = await db.scene.findUnique({ where: { id: req.params.id } });
    if (!(await guardSite(req, reply, scene?.siteId, CAN.editScenes))) return;
    const body = parseBody(SceneBody, req.body, reply);
    if (!body) return;
    if (!(await validActions(scene!.siteId, body.actions))) return reply.code(400).send({ error: 'invalid_actions' });
    const [, updated] = await db.$transaction([
      db.sceneAction.deleteMany({ where: { sceneId: scene!.id } }),
      db.scene.update({
        where: { id: scene!.id },
        data: {
          name: body.name,
          icon: body.icon,
          roomId: body.roomId,
          actions: { create: body.actions.map((a) => ({ endpointId: a.endpointId, target: { on: a.on } })) },
        },
        include: { actions: true },
      }),
    ]);
    broadcast(scene!.siteId, { type: 'scenes.changed' });
    return toView(updated);
  });

  app.delete<{ Params: { id: string } }>('/api/scenes/:id', auth, async (req, reply) => {
    const scene = await db.scene.findUnique({ where: { id: req.params.id } });
    if (!(await guardSite(req, reply, scene?.siteId, CAN.editScenes))) return;
    await db.$transaction([db.sceneAction.deleteMany({ where: { sceneId: scene!.id } }), db.scene.delete({ where: { id: scene!.id } })]);
    broadcast(scene!.siteId, { type: 'scenes.changed' });
    return reply.code(204).send();
  });

  app.post<{ Params: { siteId: string; id: string } }>('/api/sites/:siteId/scenes/:id/run', auth, async (req, reply) => {
    const { siteId, id } = req.params;
    if (!(await guardSite(req, reply, siteId, CAN.control))) return;

    if (id === ALL_OFF) {
      const eps = await db.endpoint.findMany({ where: { kind: 'relay', device: { siteId, deletedAt: null } }, select: { id: true } });
      return runActions(siteId, eps.map((e) => ({ endpointId: e.id, on: false })), req.user.sub, 'All off');
    }
    const scene = await db.scene.findFirst({ where: { id, siteId }, include: { actions: true } });
    if (!scene) return reply.code(404).send({ error: 'not_found' });
    return runActions(siteId, toView(scene).actions, req.user.sub, scene.name);
  });

  app.post<{ Params: { id: string } }>('/api/rooms/:id/off', auth, async (req, reply) => {
    const room = await db.room.findUnique({ where: { id: req.params.id }, include: { endpoints: { where: { kind: 'relay' }, select: { id: true } } } });
    if (!(await guardSite(req, reply, room?.siteId, CAN.control))) return;
    return runActions(room!.siteId, room!.endpoints.map((e) => ({ endpointId: e.id, on: false })), req.user.sub, `${room!.name} off`);
  });
}
