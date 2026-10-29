// Consistent SQLite backups with VACUUM INTO (safe while the hub is running), kept for 14 nights.
// Restore: hub/scripts/restore.sh <backup file>.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { config } from './config';
import { db } from './db';

const KEEP = 14;
const RUN_AT = '02:30'; // local time of the hub (TZ env)

export async function backupNow(dir = config.BACKUP_DIR): Promise<string> {
  if (!dir) throw new Error('BACKUP_DIR is not set');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(dir, `hub-${stamp}.db`);
  await db.$executeRawUnsafe(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const old = readdirSync(dir)
    .filter((f) => /^hub-.*\.db$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) rmSync(join(dir, f));
  return file;
}

export function scheduleBackups(log: FastifyBaseLogger) {
  if (!config.BACKUP_DIR) return;
  let lastDay = '';
  setInterval(() => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.toDateString();
    if (hhmm !== RUN_AT || day === lastDay) return;
    lastDay = day;
    backupNow()
      .then((file) => log.info({ file }, 'nightly backup written'))
      .catch((err) => log.error({ err: String(err) }, 'nightly backup failed'));
  }, 30_000);
  log.info({ dir: config.BACKUP_DIR, at: RUN_AT }, 'nightly backups scheduled');
}
