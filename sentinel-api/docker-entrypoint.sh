#!/bin/sh
set -eu

bunx prisma migrate deploy
bun run prisma:seed
exec "$@"
