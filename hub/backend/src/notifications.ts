// In-app notifications (push arrives with the Capacitor app).
import type { FastifyInstance } from 'fastify';
import { CAN, type NotificationView } from '@sw6/protocol';
import { guardSite, requireUser } from './auth';
import { db } from './db';
import { broadcast } from './realtime';

/** Everyone with access to the site: its members plus staff of the managing organization. */
async function siteUserIds(siteId: string) {
  const site = await db.site.findUnique({
    where: { id: siteId },
    include: { memberships: { select: { userId: true } }, org: { include: { members: { where: { role: { not: 'support' } }, select: { userId: true } } } } },
  });
  if (!site) return [];
  return [...new Set([...site.memberships.map((m) => m.userId), ...site.org.members.map((m) => m.userId)])];
}

export async function notifySite(siteId: string, type: string, title: string, body: string) {
  const userIds = await siteUserIds(siteId);
  await db.notification.createMany({ data: userIds.map((userId) => ({ siteId, userId, type, title, body })) });
  broadcast(siteId, { type: 'notification', title, body });
}

export async function notificationRoutes(app: FastifyInstance) {
  const auth = { onRequest: requireUser };

  app.get<{ Params: { siteId: string } }>('/api/sites/:siteId/notifications', auth, async (req, reply) => {
    if (!(await guardSite(req, reply, req.params.siteId, CAN.control))) return;
    const where = { siteId: req.params.siteId, userId: req.user.sub };
    const [rows, unread] = await Promise.all([
      db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 }),
      db.notification.count({ where: { ...where, readAt: null } }),
    ]);
    const items: NotificationView[] = rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      read: !!n.readAt,
    }));
    return { unread, items };
  });

  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/notifications/read', auth, async (req, reply) => {
    if (!(await guardSite(req, reply, req.params.siteId, CAN.control))) return;
    await db.notification.updateMany({ where: { siteId: req.params.siteId, userId: req.user.sub, readAt: null }, data: { readAt: new Date() } });
    return reply.code(204).send();
  });
}
