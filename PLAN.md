# Implementation Plan - Sentinel Portfolio Deployment

Contexto: Sentinel (sentinel-api en NestJS 10 + Prisma + PostgreSQL 17, sentinel-worker en Go 1.25 con pgx, frontend React 19 + Vite + Tailwind + TanStack Query + React Router). Se despliega públicamente como proyecto de portfolio, con presupuesto mínimo. Los reclutadores lo prueban sin conocerme: debe ser seguro y fácil de probar. Sin Redis, sin dependencias innecesarias, sin romper los tests existentes. Cada ítem va como casilla [ ].

## FASE 1: Seguridad (obligatoria antes de exponerlo)
Worker (sentinel-worker/internal/checker/http.go):
- [ ] Solo esquemas http/https.
- [ ] Puertos permitidos configurables por ALLOWED_PORTS (por defecto 80, 443, 8080, 8443).
- [ ] http.Transport con DialContext propio: resolver DNS, validar la IP y conectar directamente a la IP validada (pinning) para evitar DNS rebinding.
- [ ] Bloquear: loopback, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 (incluye metadata de la nube), 0.0.0.0/8, 100.64.0.0/10 (CGNAT), multicast, ::1, fc00::/7, fe80::/10 e IPv4-mapped IPv6 (::ffff:0:0/96).
- [ ] Transport con Proxy: nil, para que HTTP_PROXY/HTTPS_PROXY no se salten el filtro.
- [ ] CheckRedirect que revalide cada destino (IP y puerto) y limite a máximo 3 redirects.
- [ ] Timeout estricto y límite de lectura con io.LimitReader.
- [ ] Tests en Go: 127.0.0.1, localhost, 10.x, 192.168.x, 169.254.169.254, redirect a IP interna, hostname que resuelve a IP privada, DNS rebinding, IPv4-mapped IPv6, y los hostnames internos de Docker Compose (http://db:5432, http://api:8000) deben quedar bloqueados.
API (sentinel-api):
- [ ] En CreateMonitorDto/UpdateMonitorDto: validar URL real, solo http/https, rechazar hostnames obvios (localhost, 127.0.0.1, etc.). Es solo un primer filtro: la defensa real está en el worker, que también cubre monitores ya existentes en la base.
- [ ] @nestjs/throttler en memoria (sin Redis): login y registro con límite estricto por IP; POST/PATCH de monitores por usuario autenticado; respuesta 429 con Retry-After.
- [ ] Configurar trust proxy en Express para que el rate limit use la IP real del cliente detrás de Nginx/Caddy, y probar que no se agrupen todos los visitantes bajo la IP del proxy.
- [ ] Cuotas por entorno: MAX_MONITORS_PER_USER (10 por defecto) y MIN_MONITOR_FREQUENCY_SECONDS (60 por defecto), validadas en monitors.service.ts.
- [ ] SECRET_KEY obligatorio: que la app falle al iniciar en producción si usa el valor por defecto. Revisar que no haya secretos hardcodeados.

## FASE 2: Cuenta demo
- [ ] Campo is_demo en el usuario (o detección por DEMO_USER_EMAIL) y cuotas propias: DEMO_MAX_MONITORS (3) y DEMO_MIN_FREQUENCY_SECONDS (60), por entorno.
- [ ] La cuenta demo no puede cambiar su contraseña ni borrar la cuenta, y su JWT dura poco.
- [ ] POST /api/v1/auth/demo-login con rate limit propio.
- [ ] Botón "Probar demo" en LoginPage.tsx y credenciales de respaldo visibles como texto.
- [ ] Seed idempotente con la cuenta demo y monitores de ejemplo (mi portfolio y mis APIs).
- [ ] Reseteo periódico cada DEMO_RESET_INTERVAL_MINUTES que purgue monitores, check_result y alert del usuario demo y restaure el seed.

## FASE 3: Página de estado pública
- [ ] Campo is_public en monitor. Solo se asigna desde el seed o una cuenta admin; ningún usuario normal ni la cuenta demo puede activarlo.
- [ ] GET /api/v1/public/status sin autenticación, con rate limit o caché corto. Expone solo name, last_state, uptime_percentage y last_checked_at; nunca target, configs internas ni datos del dueño.
- [ ] Ruta pública /status en el frontend con estados operacional, degradado y caído.

## FASE 4: Despliegue
- [ ] Docker Compose de producción: db, api, worker, frontend, con healthchecks y depends_on con condition: service_healthy.
- [ ] Reverse proxy con HTTPS automático (Caddy) delante de frontend y API.
- [ ] .env.example completo y documentado.
- [ ] Script de arranque que corra prisma migrate deploy y el seed de forma idempotente.
- [ ] README: link en vivo, video demo, credenciales demo, diagrama de arquitectura, decisiones clave (por qué strategy + registry, por qué worker desacoplado) y sección de seguridad (SSRF con mitigación de DNS rebinding, rate limiting, cuotas).
