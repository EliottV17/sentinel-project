# Implementation Plan - Sentinel Portfolio Deployment

Contexto: Sentinel (sentinel-api en NestJS 10 + Prisma + PostgreSQL 17, sentinel-worker en Go 1.25 con pgx, frontend React 19 + Vite + Tailwind + TanStack Query + React Router). Se despliega públicamente como proyecto de portfolio, con presupuesto mínimo. Los reclutadores lo prueban sin conocerme: debe ser seguro y fácil de probar. Sin Redis, sin dependencias innecesarias, sin romper los tests existentes. Cada ítem va como casilla [ ].

## Reglas de trabajo
- PLAN.md es la fuente de verdad: leerlo completo al empezar cualquier sesión o fase. No inventar tareas que no estén aquí; si falta algo, proponerlo antes de agregarlo. Avisar antes de cualquier cambio grande de arquitectura.
- Una rama por fase, creada desde main solo cuando la fase anterior esté fusionada: feat/phase-1-security, feat/phase-2-demo-account, feat/phase-3-public-status, chore/phase-4-deployment.
- Commits pequeños con Conventional Commits. No mezclar fases en un commit.
- Nunca hacer push ni merge a main sin confirmación explícita del usuario.
- Marcar las casillas de cada fase dentro de su misma rama.
- Una fase está terminada cuando: todos sus ítems están marcados, los tests (nuevos y existentes) pasan, el CI está en verde y se entregó un resumen de qué cambió y cómo probarlo.

## FASE 1: Seguridad (obligatoria antes de exponerlo)
Worker (sentinel-worker/internal/checker/http.go):
- [x] Solo esquemas http/https.
- [x] Puertos permitidos configurables por ALLOWED_PORTS (por defecto 80, 443, 8080, 8443).
- [x] http.Transport con DialContext propio: resolver DNS, validar la IP y conectar directamente a la IP validada (pinning) para evitar DNS rebinding.
- [x] Bloquear: loopback, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 (incluye metadata de la nube), 0.0.0.0/8, 100.64.0.0/10 (CGNAT), multicast, ::1, fc00::/7, fe80::/10 e IPv4-mapped IPv6 (::ffff:0:0/96).
- [x] Transport con Proxy: nil, para que HTTP_PROXY/HTTPS_PROXY no se salten el filtro.
- [x] CheckRedirect que revalide cada destino (IP y puerto) y limite a máximo 3 redirects.
- [x] Timeout estricto y límite de lectura con io.LimitReader.
- [x] Tests en Go: 127.0.0.1, localhost, 10.x, 192.168.x, 169.254.169.254, redirect a IP interna, hostname que resuelve a IP privada, DNS rebinding, IPv4-mapped IPv6, y los hostnames internos de Docker Compose (http://db:5432, http://api:8000) deben quedar bloqueados.
API (sentinel-api):
- [x] En CreateMonitorDto/UpdateMonitorDto: validar URL real, solo http/https, rechazar hostnames obvios (localhost, 127.0.0.1, etc.). Es solo un primer filtro: la defensa real está en el worker, que también cubre monitores ya existentes en la base.
- [x] @nestjs/throttler en memoria (sin Redis): login y registro con límite estricto por IP; POST/PATCH de monitores por usuario autenticado; respuesta 429 con Retry-After.
- [x] Configurar trust proxy en Express para que el rate limit use la IP real del cliente detrás de Nginx/Caddy, y probar que no se agrupen todos los visitantes bajo la IP del proxy.
- [x] Cuotas por entorno: MAX_MONITORS_PER_USER (10 por defecto) y MIN_MONITOR_FREQUENCY_SECONDS (60 por defecto), validadas en monitors.service.ts.
- [x] SECRET_KEY obligatorio: que la app falle al iniciar en producción si usa el valor por defecto. Revisar que no haya secretos hardcodeados.

## FASE 2: Cuenta demo
- [x] Campo `is_demo` en el usuario; cuenta identificada por `DEMO_USER_EMAIL`.
- [x] Cuotas configurables de demo: `DEMO_MAX_MONITORS` (3) y `DEMO_MIN_FREQUENCY_SECONDS` (60), aplicadas al crear y actualizar (`PATCH`) monitores.
- [x] La cuenta demo no puede cambiar contraseña, email ni borrar la cuenta; proteger todas las mutaciones de usuario actuales y futuras.
- [x] JWT de demo con `is_demo` y expiración corta dedicada y configurable, independiente de la expiración ordinaria.
- [x] `POST /api/v1/auth/demo-login` sin parámetros; límite de 30 solicitudes/minuto por IP, sin relajar el límite de 5/minuto por IP para login y registro ordinarios.
- [x] Si falta la cuenta demo, el login devuelve 503 y el reset periódico es un no-op.
- [x] Botón "Probar demo" en `LoginPage.tsx` y credenciales de respaldo visibles como texto.
- [x] Seed idempotente de la cuenta demo y monitores de ejemplo; el demo no puede activar monitores públicos.
- [x] El único origen/lista de monitores demo es el manifiesto raíz `demo-monitors.json` (solo definiciones de monitores, sin credenciales), compartido por el seed de API y el reset del worker; no duplicar la lista.
- [x] `docker-compose.yml` monta ese manifiesto exacto, de solo lectura, en `/app/demo-monitors.json` para API y worker; mantener los contextos de build existentes.
- [x] Los targets del manifiesto son destinos públicos SSRF-safe, como `https://example.com` y `https://api.github.com`; omitir campos de publicación o fijarlos en `false`, nunca crear monitores demo públicos.
- [x] Reset periódico con `DEMO_RESET_INTERVAL_MINUTES` configurable, default 60; restaurar monitores desde el manifiesto y purgar idempotentemente el historial de checks y alertas del usuario demo.
- [x] Un reset no elimina datos de otros usuarios y sobrevive al reinicio del worker.
- [x] El worker trata una violación FK por borrado concurrente del monitor durante un check como carrera esperada: la registra, sigue ejecutándose y tiene pruebas deterministas del caso.
- [x] La experiencia autenticada demo muestra un aviso visible de que los datos se restablecen periódicamente.
- [x] **Documentación de variables de entorno:** bloque con valores solo de ejemplo pegado y confirmado por el usuario en `005d555`; el agente no accedió ni modificó ningún `.env.example`.

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
