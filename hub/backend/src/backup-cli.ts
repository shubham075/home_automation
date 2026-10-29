// On-demand backup:  docker compose -f hub/docker-compose.prod.yml exec backend pnpm exec tsx src/backup-cli.ts
import { backupNow } from './backup';
import { db } from './db';

const file = await backupNow();
console.log(`Backup written: ${file}`);
await db.$disconnect();
