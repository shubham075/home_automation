#!/bin/sh
# Container entrypoint: apply migrations, create the first owner on an empty database, start.
set -e
pnpm exec prisma migrate deploy
SEED_ONLY_IF_EMPTY=true pnpm exec tsx prisma/seed.ts
exec pnpm exec tsx src/index.ts
