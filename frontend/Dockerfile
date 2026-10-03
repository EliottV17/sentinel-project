# ---- build stage: bake the SPA with bun ----
FROM oven/bun:1.4 AS build
WORKDIR /app

# Install dependencies first (leverages layer caching). bun.lock is text-format.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Bake the rest of the source and produce the static dist/.
COPY . .
# VITE_API_BASE_URL is baked at build time by Vite. Default empty = same-origin
# /api, which nginx proxies to the api service.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
# Public demo credentials are displayed by the SPA and intentionally baked at build time.
ARG VITE_DEMO_USER_EMAIL="demo@sentinel.dev"
ARG VITE_DEMO_USER_PASSWORD="DemoPassword123!"
ENV VITE_DEMO_USER_EMAIL=${VITE_DEMO_USER_EMAIL}
ENV VITE_DEMO_USER_PASSWORD=${VITE_DEMO_USER_PASSWORD}
ARG VITE_STATUS_STALE_AFTER_MINUTES="5"
ENV VITE_STATUS_STALE_AFTER_MINUTES=${VITE_STATUS_STALE_AFTER_MINUTES}
ARG VITE_STATUS_DEGRADED_THRESHOLD_PERCENT="99"
ENV VITE_STATUS_DEGRADED_THRESHOLD_PERCENT=${VITE_STATUS_DEGRADED_THRESHOLD_PERCENT}
RUN bun run build

# ---- serve stage: static files behind nginx ----
FROM nginx:alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
