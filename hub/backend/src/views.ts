import type { Prisma } from '@prisma/client';
import type { EndpointView } from '@sw6/protocol';
import { db } from './db';

/** Includes hidden endpoints; apps filter them out of the control view themselves. */
export async function endpointViews(where: Prisma.EndpointWhereInput): Promise<EndpointView[]> {
  const rows = await db.endpoint.findMany({
    where,
    include: {
      room: { select: { id: true, name: true } },
      device: { select: { status: true, configRevDesired: true, configRevApplied: true } },
      state: true,
    },
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
    favorite: e.favorite,
    hidden: e.hidden,
    restorePolicy: e.restorePolicy,
    deviceOnline: e.device.status === 'online',
    configPending: e.device.configRevApplied < e.device.configRevDesired,
    on: (e.state?.value as { on?: boolean } | null)?.on ?? null,
    changedAt: e.state?.changedAt.toISOString() ?? null,
    source: e.state?.source ?? null,
  }));
}
