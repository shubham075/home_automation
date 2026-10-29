// People in a home: members list, invites (phone + 6-digit code), role changes, removal,
// leaving, ownership transfer. Guests can carry an access window (enforced in siteRole).
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import { assignableRoles, canManageMembers, type InvitationView, type MemberView } from '@sw6/protocol';
import { requireUser, siteRole } from './auth';
import { db } from './db';
import { clearFailures, lockedFor, recordFailure } from './lockout';
import { disconnectUser } from './realtime';
import { parseBody } from './topology';

const INVITE_TTL_MS = 72 * 3600_000;
const MAX_CODE_ATTEMPTS = 5;
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be in international format, e.g. +919812345678');
const window = { validFrom: z.string().datetime().nullable().optional(), validUntil: z.string().datetime().nullable().optional() };

const InviteBody = z.object({ phone, role: z.enum(['admin', 'member', 'guest']), ...window });
const MemberPatch = z.object({ role: z.enum(['admin', 'member', 'guest']).optional(), ...window }).refine((o) => Object.keys(o).length > 0, 'nothing to update');
const Transfer = z.object({ userId: z.string() });
export const AcceptInvite = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().min(1).max(60).optional(),
  password: z.string().min(8).max(200),
  client: z.enum(['web', 'native']).default('web'),
});

export class InviteError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
  ) {
    super(code);
  }
}

const codeHash = (inviteId: string, code: string) => createHash('sha256').update(`${inviteId}:${code}`).digest();

/** Guests only: a window must end after it starts. Other roles never carry one. */
function windowFor(role: string, from?: string | null, until?: string | null) {
  if (role !== 'guest') return { validFrom: null, validUntil: null };
  const validFrom = from ? new Date(from) : null;
  const validUntil = until ? new Date(until) : null;
  if (validFrom && validUntil && validUntil <= validFrom) throw new InviteError('invalid_window', 400);
  return { validFrom, validUntil };
}

export async function acceptInvitation(input: z.infer<typeof AcceptInvite>) {
  const pending = await db.invitation.findMany({
    where: { phoneOrEmail: input.phone, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  const match = pending.find((inv) => {
    const want = Buffer.from(inv.tokenHash, 'hex');
    return timingSafeEqual(codeHash(inv.id, input.code), want);
  });
  if (!match) {
    // Every wrong try counts against all open invites for this phone; 5 strikes burns them.
    for (const inv of pending) {
      await db.invitation.update({
        where: { id: inv.id },
        data: { attempts: { increment: 1 }, revokedAt: inv.attempts + 1 >= MAX_CODE_ATTEMPTS ? new Date() : null },
      });
    }
    throw new InviteError('invalid_code', 400);
  }

  let user = await db.user.findUnique({ where: { phone: input.phone } });
  if (user) {
    // Same lockout as /login, so this endpoint cannot be used to guess passwords.
    if (lockedFor(input.phone)) throw new InviteError('too_many_attempts', 429);
    if (!user.passwordHash || !(await verify(user.passwordHash, input.password)) || user.status !== 'active') {
      recordFailure(input.phone);
      throw new InviteError('wrong_password', 401);
    }
    clearFailures(input.phone);
  } else {
    if (!input.name) throw new InviteError('name_required', 400);
    user = await db.user.create({ data: { name: input.name, phone: input.phone, passwordHash: await hash(input.password) } });
  }

  await db.$transaction([
    db.siteMembership.upsert({
      where: { siteId_userId: { siteId: match.siteId, userId: user.id } },
      create: { siteId: match.siteId, userId: user.id, role: match.role, validFrom: match.validFrom, validUntil: match.validUntil },
      update: { role: match.role, validFrom: match.validFrom, validUntil: match.validUntil },
    }),
    db.invitation.update({ where: { id: match.id }, data: { acceptedAt: new Date() } }),
    db.auditLog.create({ data: { siteId: match.siteId, actorType: 'user', actorId: user.id, action: 'member.join', targetType: 'invitation', targetId: match.id } }),
  ]);
  return user;
}

export async function memberRoutes(app: FastifyInstance) {
  const auth = { onRequest: requireUser };

  /** Returns the caller's role if they may manage people on this site; otherwise replies 403. */
  const manager = async (userId: string, siteId: string) => {
    const role = await siteRole(userId, siteId);
    return canManageMembers(role) ? role! : null;
  };
  const audit = (siteId: string, actorId: string, action: string, targetId: string, data?: object) =>
    db.auditLog.create({ data: { siteId, actorType: 'user', actorId, action, targetType: 'user', targetId, data } });

  app.get<{ Params: { siteId: string } }>('/api/sites/:siteId/members', auth, async (req, reply) => {
    const { siteId } = req.params;
    const role = await siteRole(req.user.sub, siteId);
    if (!role) return reply.code(403).send({ error: 'forbidden' });
    const rows = await db.siteMembership.findMany({ where: { siteId }, include: { user: true }, orderBy: { createdAt: 'asc' } });
    const members: MemberView[] = rows.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      phone: m.user.phone,
      role: m.role,
      validFrom: m.validFrom?.toISOString() ?? null,
      validUntil: m.validUntil?.toISOString() ?? null,
      you: m.userId === req.user.sub,
    }));
    const invitations: InvitationView[] = canManageMembers(role)
      ? (await db.invitation.findMany({ where: { siteId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })).map((i) => ({
          id: i.id,
          phone: i.phoneOrEmail,
          role: i.role,
          expiresAt: i.expiresAt.toISOString(),
          validFrom: i.validFrom?.toISOString() ?? null,
          validUntil: i.validUntil?.toISOString() ?? null,
        }))
      : [];
    return { role, members, invitations };
  });

  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/invitations', auth, async (req, reply) => {
    const { siteId } = req.params;
    const role = await manager(req.user.sub, siteId);
    if (!role) return reply.code(403).send({ error: 'forbidden' });
    const body = parseBody(InviteBody, req.body, reply);
    if (!body) return;
    if (!assignableRoles(role).includes(body.role)) return reply.code(403).send({ error: 'role_not_allowed' });
    const existing = await db.user.findUnique({ where: { phone: body.phone }, include: { siteMemberships: { where: { siteId } } } });
    if (existing?.siteMemberships.length) return reply.code(409).send({ error: 'already_member' });
    let win;
    try {
      win = windowFor(body.role, body.validFrom, body.validUntil);
    } catch (err) {
      if (err instanceof InviteError) return reply.code(err.httpStatus).send({ error: err.code });
      throw err;
    }

    // Re-inviting the same phone replaces the previous open invite.
    await db.invitation.updateMany({ where: { siteId, phoneOrEmail: body.phone, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = ulid();
    const inv = await db.invitation.create({
      data: {
        id,
        siteId,
        invitedById: req.user.sub,
        phoneOrEmail: body.phone,
        role: body.role,
        tokenHash: codeHash(id, code).toString('hex'),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        ...win,
      },
    });
    await audit(siteId, req.user.sub, 'member.invite', inv.id, { phone: body.phone, role: body.role });
    // The code is returned once and only stored as a hash.
    return reply.code(201).send({ id: inv.id, code, expiresAt: inv.expiresAt.toISOString() });
  });

  app.delete<{ Params: { id: string } }>('/api/invitations/:id', auth, async (req, reply) => {
    const inv = await db.invitation.findUnique({ where: { id: req.params.id } });
    if (!inv || !(await manager(req.user.sub, inv.siteId))) return reply.code(inv ? 403 : 404).send({ error: inv ? 'forbidden' : 'not_found' });
    await db.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  });

  /** Owners can change anyone but owners; admins can change members and guests only. */
  async function guardTarget(callerId: string, siteId: string, targetId: string) {
    const role = await manager(callerId, siteId);
    if (!role) return { error: 'forbidden' as const };
    if (targetId === callerId) return { error: 'cannot_change_self' as const };
    const target = await db.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId: targetId } } });
    if (!target) return { error: 'not_found' as const };
    if (!assignableRoles(role).includes(target.role)) return { error: 'role_not_allowed' as const };
    return { role, target };
  }
  const status = (e: string) => (e === 'not_found' ? 404 : e === 'cannot_change_self' ? 409 : 403);

  app.patch<{ Params: { siteId: string; userId: string } }>('/api/sites/:siteId/members/:userId', auth, async (req, reply) => {
    const { siteId, userId } = req.params;
    const g = await guardTarget(req.user.sub, siteId, userId);
    if ('error' in g) return reply.code(status(g.error!)).send({ error: g.error });
    const body = parseBody(MemberPatch, req.body, reply);
    if (!body) return;
    const role = body.role ?? g.target.role;
    if (!assignableRoles(g.role).includes(role)) return reply.code(403).send({ error: 'role_not_allowed' });
    let win;
    try {
      win = windowFor(role, body.validFrom === undefined ? g.target.validFrom?.toISOString() : body.validFrom, body.validUntil === undefined ? g.target.validUntil?.toISOString() : body.validUntil);
    } catch (err) {
      if (err instanceof InviteError) return reply.code(err.httpStatus).send({ error: err.code });
      throw err;
    }
    await db.siteMembership.update({ where: { id: g.target.id }, data: { role, ...win } });
    await audit(siteId, req.user.sub, 'member.update', userId, { role });
    disconnectUser(userId);
    return reply.code(204).send();
  });

  app.delete<{ Params: { siteId: string; userId: string } }>('/api/sites/:siteId/members/:userId', auth, async (req, reply) => {
    const { siteId, userId } = req.params;
    const g = await guardTarget(req.user.sub, siteId, userId);
    if ('error' in g) return reply.code(status(g.error!)).send({ error: g.error });
    await db.siteMembership.delete({ where: { id: g.target.id } });
    await audit(siteId, req.user.sub, 'member.remove', userId);
    disconnectUser(userId);
    return reply.code(204).send();
  });

  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/leave', auth, async (req, reply) => {
    const { siteId } = req.params;
    const me = await db.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId: req.user.sub } } });
    if (!me) return reply.code(404).send({ error: 'not_found' });
    if (me.role === 'owner' && (await db.siteMembership.count({ where: { siteId, role: 'owner' } })) === 1) {
      return reply.code(409).send({ error: 'last_owner' });
    }
    await db.siteMembership.delete({ where: { id: me.id } });
    await audit(siteId, req.user.sub, 'member.leave', req.user.sub);
    return reply.code(204).send();
  });

  // Hand-over (e.g. builder → buyer): target becomes owner, the caller becomes admin.
  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/transfer', auth, async (req, reply) => {
    const { siteId } = req.params;
    const body = parseBody(Transfer, req.body, reply);
    if (!body) return;
    const me = await db.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId: req.user.sub } } });
    if (me?.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
    const target = await db.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId: body.userId } } });
    if (!target || target.userId === me.userId) return reply.code(404).send({ error: 'not_found' });
    if (target.role === 'guest') return reply.code(409).send({ error: 'guest_cannot_own' });
    await db.$transaction([
      db.siteMembership.update({ where: { id: target.id }, data: { role: 'owner', validFrom: null, validUntil: null } }),
      db.siteMembership.update({ where: { id: me.id }, data: { role: 'admin' } }),
      db.auditLog.create({ data: { siteId, actorType: 'user', actorId: me.userId, action: 'site.transfer_ownership', targetType: 'user', targetId: target.userId } }),
    ]);
    disconnectUser(me.userId);
    disconnectUser(target.userId);
    return reply.code(204).send();
  });
}
