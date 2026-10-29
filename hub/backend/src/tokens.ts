// Refresh-token rotation with reuse detection. Only SHA-256 hashes are stored.
import { createHash, randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { config } from './config';
import { db } from './db';

/**
 * A replaced token presented again within this window is treated as a race between two
 * tabs refreshing at once (both sent the same cookie), not as theft.
 */
const REUSE_GRACE_MS = 10_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const expiry = () => new Date(Date.now() + config.REFRESH_TOKEN_DAYS * 86_400_000);

export async function issueRefreshToken(userId: string, clientInfo?: string, familyId = ulid()) {
  const token = randomBytes(32).toString('base64url');
  const row = await db.refreshToken.create({
    data: { userId, familyId, tokenHash: sha256(token), clientInfo: clientInfo?.slice(0, 200), expiresAt: expiry() },
  });
  return { token, row };
}

export type RotateResult =
  | { ok: true; userId: string; token: string | null } // token null: grace-window race, keep the current cookie
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' | 'user_disabled' };

export async function rotateRefreshToken(token: string, clientInfo?: string): Promise<RotateResult> {
  const row = await db.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row) return { ok: false, reason: 'unknown' };

  if (row.revokedAt) {
    if (row.replacedById && Date.now() - row.revokedAt.getTime() < REUSE_GRACE_MS) {
      return { ok: true, userId: row.userId, token: null };
    }
    await revokeFamily(row.familyId);
    return { ok: false, reason: 'reused' };
  }
  if (row.expiresAt <= new Date()) return { ok: false, reason: 'expired' };
  if (row.user.status !== 'active') {
    await revokeFamily(row.familyId);
    return { ok: false, reason: 'user_disabled' };
  }

  const next = await issueRefreshToken(row.userId, clientInfo, row.familyId);
  await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedById: next.row.id } });
  return { ok: true, userId: row.userId, token: next.token };
}

export async function revokeByToken(token: string) {
  const row = await db.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (row) await revokeFamily(row.familyId);
}

async function revokeFamily(familyId: string) {
  await db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}
