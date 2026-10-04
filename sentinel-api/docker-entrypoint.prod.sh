#!/bin/sh
set -eu

step() {
  printf '[startup] %s\n' "$1"
}

step 'production environment preflight'
if ! node -e "require('./dist/common/config/production-env').validateProductionEnvironment(process.env)"; then
  printf '[startup] preflight failed; refusing to modify the database\n' >&2
  exit 1
fi

step 'Prisma migrate deploy'
if ! ./node_modules/.bin/prisma migrate deploy --schema=./prisma/schema.prisma; then
  printf '[startup] Prisma migrate deploy failed; server will not start\n' >&2
  exit 1
fi

step 'compiled demo and status seed'
if ! node ./seed-dist/prisma/seed.js; then
  printf '[startup] compiled seed failed; server will not start\n' >&2
  exit 1
fi

step 'API server'
exec node ./dist/main.js
