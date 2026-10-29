import type { Prisma } from '@prisma/client';
import type { EndpointView } from '@sw6/protocol';
import { db } from './db';

export async function endpointViews(where: Prisma.EndpointWhereInput): Promise<EndpointView[]> {
  const rows = await db.endpoint.findMany({
    where: { hidden: false, ...where },
    include: { room: { select: { id: true, name: true } }, device: { select: { status: true } }, state: true },
    orderBy: [{ deviceId: 'asc' }, { channel: 'asc' }],
  });
  return rows.map((e) => ({
    id: e.id,
    deviceId: e.deviceId,
    channel: e.channel,
    kind: e.kind,
    name: e.name,
    loadType: e.loadType,
    room: e.room,
    deviceOnline: e.device.status === 'online',
    on: (e.state?.value as { on?: boolean } | null)?.on ?? null,
    changedAt: e.state?.changedAt.toISOString() ?? null,
    source: e.state?.source ?? null,
  }));
}
