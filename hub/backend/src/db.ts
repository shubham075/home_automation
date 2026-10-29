import { PrismaClient } from '@prisma/client';

export const db = new PrismaClient();

/**
 * SQLite tuning for the hub: WAL lets reads run during writes, and synchronous=NORMAL drops
 * the per-write fsync (still crash-safe in WAL mode; at worst the last instant of history is lost).
 * No-op once the cloud phase switches to Postgres.
 */
export async function tuneDatabase() {
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  await db.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
  await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
}
