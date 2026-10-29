import type { FastifyReply, FastifyRequest } from 'fastify';
import { roleRank } from '@sw6/protocol';
import { db } from './db';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

/**
 * Effective role of a user on a site: a site membership (inside its validity window),
 * otherwise an org membership on the organization that manages the site.
 */
export async function siteRole(userId: string, siteId: string): Promise<string | null> {
  const now = new Date();
  const m = await db.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId } } });
  if (m && (!m.validFrom || m.validFrom <= now) && (!m.validUntil || m.validUntil > now)) return m.role;

  const site = await db.site.findUnique({ where: { id: siteId }, select: { orgId: true } });
  if (!site) return null;
  const om = await db.orgMembership.findUnique({ where: { orgId_userId: { orgId: site.orgId, userId } } });
  return om && om.role !== 'support' ? `org:${om.role}` : null;
}

/**
 * Replies 404/403 and returns false unless the user's role on the site reaches `minRank`
 * (see CAN in @sw6/protocol). A missing site and a forbidden site look the same to the caller.
 */
export async function guardSite(req: FastifyRequest, reply: FastifyReply, siteId: string | null | undefined, minRank: number) {
  if (!siteId) {
    reply.code(404).send({ error: 'not_found' });
    return false;
  }
  if (roleRank(await siteRole(req.user.sub, siteId)) < minRank) {
    reply.code(403).send({ error: 'forbidden' });
    return false;
  }
  return true;
}

export async function accessibleSites(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      siteMemberships: { include: { site: { select: { id: true, name: true, type: true } } } },
      orgMemberships: { include: { org: { include: { sites: { select: { id: true, name: true, type: true } } } } } },
    },
  });
  const sites = new Map<string, { id: string; name: string; type: string; role: string }>();
  for (const om of user.orgMemberships) {
    if (om.role === 'support') continue;
    for (const s of om.org.sites) sites.set(s.id, { ...s, role: `org:${om.role}` });
  }
  const now = new Date();
  for (const sm of user.siteMemberships) {
    if ((sm.validFrom && sm.validFrom > now) || (sm.validUntil && sm.validUntil <= now)) continue; // guest outside window
    sites.set(sm.site.id, { ...sm.site, role: sm.role });
  }
  return { user, sites: [...sites.values()] };
}
