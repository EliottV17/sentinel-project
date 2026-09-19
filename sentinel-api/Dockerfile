# Stage 1: Build
FROM oven/bun:alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (e.g. argon2)
RUN apk add --no-cache python3 make g++

COPY package.json bun.lock ./
COPY prisma ./prisma/

RUN bun install --frozen-lockfile

COPY tsconfig.json nest-cli.json ./
COPY src ./src

RUN bunx prisma generate
RUN bun run build

# Stage 2: Production runner
FROM oven/bun:alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 8000

CMD ["bun", "dist/main.js"]
