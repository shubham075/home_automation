// Floors, rooms and per-channel settings. Editing needs CAN.manageRooms (admin / technician and up).
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, type ZodType } from 'zod';
import { CAN, LOAD_TYPES, ROOM_TYPES, RestorePolicy, type Topology } from '@sw6/protocol';
import { guardSite, requireUser } from './auth';
import { db } from './db';
import { pushDeviceConfig } from './device-config';
import { broadcast } from './realtime';
import { endpointViews } from './views';

const name = z.string().trim().min(1).max(40);
const FloorBody = z.object({ name, level: z.number().int().min(-5).max(200).default(0) });
const FloorPatch = FloorBody.partial();
const RoomBody = z.object({ name, type: z.enum(ROOM_TYPES).default('other'), floorId: z.string().nullable().default(null) });
const RoomPatch = z.object({ name: name.optional(), type: z.enum(ROOM_TYPES).optional(), floorId: z.string().nullable().optional() });
const SiteLocation = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const RoomOrder = z.object({ roomIds: z.array(z.string()).min(1).max(500) });
const EndpointPatch = z
  .object({
    name: name.optional(),
    roomId: z.string().nullable().optional(),
    loadType: z.enum(LOAD_TYPES).optional(),
    favorite: z.boolean().optional(),
    hidden: z.boolean().optional(),
    restorePolicy: RestorePolicy.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'nothing to update');

export function parseBody<T>(schema: ZodType<T, z.ZodTypeDef, unknown>, body: unknown, reply: FastifyReply): T | undefined {
  const r = schema.safeParse(body);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid_body', issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return undefined;
  }
  return r.data;
}

async function topology(siteId: string): Promise<Topology> {
  const [site, floors, rooms] = await Promise.all([
    db.site.findUniqueOrThrow({ where: { id: siteId }, select: { lat: true, lng: true, timezone: true } }),
    db.floor.findMany({ where: { siteId }, orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }], select: { id: true, name: true, level: true } }),
    db.room.findMany({ where: { siteId }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, type: true, floorId: true, sortOrder: true } }),
  ]);
  return { location: site, floors, rooms };
}

/** A referenced floor or room must belong to the same site. */
async function belongs(kind: 'floor' | 'room', id: string | null | undefined, siteId: string) {
  if (!id) return true;
  const row = kind === 'floor' ? await db.floor.findUnique({ where: { id } }) : await db.room.findUnique({ where: { id } });
  return row?.siteId === siteId;
}

export async function topologyRoutes(app: FastifyInstance) {
  const auth = { onRequest: requireUser };
  const changed = (siteId: string) => broadcast(siteId, { type: 'topology.changed' });

  app.get<{ Params: { siteId: string } }>('/api/sites/:siteId/topology', auth, async (req, reply) => {
    if (!(await guardSite(req, reply, req.params.siteId, CAN.control))) return;
    return topology(req.params.siteId);
  });

  app.patch<{ Params: { siteId: string } }>('/api/sites/:siteId', auth, async (req, reply) => {
    const { siteId } = req.params;
    if (!(await guardSite(req, reply, siteId, CAN.manageRooms))) return;
    const body = parseBody(SiteLocation, req.body, reply);
    if (!body) return;
    await db.site.update({ where: { id: siteId }, data: body });
    changed(siteId);
    return reply.code(204).send();
  });

  // ---- floors
  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/floors', auth, async (req, reply) => {
    const { siteId } = req.params;
    if (!(await guardSite(req, reply, siteId, CAN.manageRooms))) return;
    const body = parseBody(FloorBody, req.body, reply);
    if (!body) return;
    const floor = await db.floor.create({ data: { siteId, ...body } });
    changed(siteId);
    return reply.code(201).send(floor);
  });

  app.patch<{ Params: { id: string } }>('/api/floors/:id', auth, async (req, reply) => {
    const floor = await db.floor.findUnique({ where: { id: req.params.id } });
    if (!(await guardSite(req, reply, floor?.siteId, CAN.manageRooms))) return;
    const body = parseBody(FloorPatch, req.body, reply);
    if (!body) return;
    const updated = await db.floor.update({ where: { id: floor!.id }, data: body });
    changed(floor!.siteId);
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/floors/:id', auth, async (req, reply) => {
    const floor = await db.floor.findUnique({ where: { id: req.params.id }, include: { _count: { select: { rooms: true } } } });
    if (!(await guardSite(req, reply, floor?.siteId, CAN.manageRooms))) return;
    if (floor!._count.rooms > 0) return reply.code(409).send({ error: 'floor_not_empty' });
    await db.floor.delete({ where: { id: floor!.id } });
    changed(floor!.siteId);
    return reply.code(204).send();
  });

  // ---- rooms
  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/rooms', auth, async (req, reply) => {
    const { siteId } = req.params;
    if (!(await guardSite(req, reply, siteId, CAN.manageRooms))) return;
    const body = parseBody(RoomBody, req.body, reply);
    if (!body) return;
    if (!(await belongs('floor', body.floorId, siteId))) return reply.code(400).send({ error: 'invalid_floor' });
    const last = await db.room.aggregate({ where: { siteId }, _max: { sortOrder: true } });
    const room = await db.room.create({ data: { siteId, ...body, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
    changed(siteId);
    return reply.code(201).send(room);
  });

  app.patch<{ Params: { id: string } }>('/api/rooms/:id', auth, async (req, reply) => {
    const room = await db.room.findUnique({ where: { id: req.params.id } });
    if (!(await guardSite(req, reply, room?.siteId, CAN.manageRooms))) return;
    const body = parseBody(RoomPatch, req.body, reply);
    if (!body) return;
    if (!(await belongs('floor', body.floorId, room!.siteId))) return reply.code(400).send({ error: 'invalid_floor' });
    const updated = await db.room.update({ where: { id: room!.id }, data: body });
    changed(room!.siteId);
    return updated;
  });

  // Endpoints and scenes in a deleted room become unassigned rather than being deleted.
  app.delete<{ Params: { id: string } }>('/api/rooms/:id', auth, async (req, reply) => {
    const room = await db.room.findUnique({ where: { id: req.params.id } });
    if (!(await guardSite(req, reply, room?.siteId, CAN.manageRooms))) return;
    await db.$transaction([
      db.endpoint.updateMany({ where: { roomId: room!.id }, data: { roomId: null } }),
      db.scene.updateMany({ where: { roomId: room!.id }, data: { roomId: null } }),
      db.room.delete({ where: { id: room!.id } }),
    ]);
    changed(room!.siteId);
    return reply.code(204).send();
  });

  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/rooms/order', auth, async (req, reply) => {
    const { siteId } = req.params;
    if (!(await guardSite(req, reply, siteId, CAN.manageRooms))) return;
    const body = parseBody(RoomOrder, req.body, reply);
    if (!body) return;
    const owned = await db.room.count({ where: { siteId, id: { in: body.roomIds } } });
    if (owned !== new Set(body.roomIds).size || owned !== body.roomIds.length) return reply.code(400).send({ error: 'invalid_rooms' });
    await db.$transaction(body.roomIds.map((id, i) => db.room.update({ where: { id }, data: { sortOrder: i } })));
    changed(siteId);
    return reply.code(204).send();
  });

  // ---- channels (endpoints)
  app.patch<{ Params: { id: string } }>('/api/endpoints/:id', auth, async (req, reply) => {
    const ep = await db.endpoint.findUnique({ where: { id: req.params.id }, include: { device: { select: { siteId: true } } } });
    const siteId = ep?.device.siteId;
    if (!(await guardSite(req, reply, siteId, CAN.manageRooms))) return;
    const body = parseBody(EndpointPatch, req.body, reply);
    if (!body) return;
    if (!(await belongs('room', body.roomId, siteId!))) return reply.code(400).send({ error: 'invalid_room' });

    await db.endpoint.update({ where: { id: ep!.id }, data: body });
    if (body.restorePolicy && body.restorePolicy !== ep!.restorePolicy) await pushDeviceConfig(ep!.deviceId);
    await db.auditLog.create({
      data: { siteId, actorType: 'user', actorId: req.user.sub, action: 'endpoint.update', targetType: 'endpoint', targetId: ep!.id, data: body },
    });

    const [view] = await endpointViews({ id: ep!.id });
    broadcast(siteId!, { type: 'endpoints.changed', endpoints: [view] });
    return view;
  });
}
