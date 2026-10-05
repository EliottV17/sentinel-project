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
- [x] Campo `is_public` Boolean con default `false` y migración. Solo se asigna desde el seed: sin rol admin ni endpoint para modificarlo. Ningún DTO de POST/PATCH lo acepta; tests de mass assignment para usuarios normales y demo.
- [x] JWT global con `@Public()` explícito. Test de inventario que enumera las rutas y verifica la lista pública exacta: login, registro, demo-login, public/status y el health existente. Una ruta nueva sin declaración explícita debe hacer fallar el test.
- [x] Dueño dedicado identificado por `STATUS_OWNER_EMAIL`, distinto de demo, sin contraseña usable ni pública. El seed debe fallar claramente si el email pertenece a una cuenta existente; nunca apropiarse de ella. Test de aislamiento del reset demo que preserva monitores públicos y su historial.
- [x] Manifiesto raíz `status-monitors.json` separado del demo, targets públicos de ejemplo validados contra SSRF y `seed_key` estable. Seed idempotente que actualiza y nunca borra monitores ni historial.
- [x] `GET /api/v1/public/status` responde 200 sin token. Solo monitores activos con `is_public = true`; privados y demo nunca aparecen. Selección explícita y respuesta con exactamente `name`, `last_state`, `uptime_percentage`, `last_checked_at`, sin id, target, configuración ni dueño.
- [x] Uptime calculado en SQL agregado, sin N+1, sobre ventana configurable (`STATUS_UPTIME_WINDOW_HOURS`, ejemplo 24); `null` sin muestras. Índice `(monitor_id, created_at)` en `check_result` y tests sin datos, mixtos y saludables.
- [x] Caché en memoria configurable (ejemplo 30 segundos), sin Redis, más throttler por defecto por IP. Tests de caché y polling normal sin 429.
- [x] Ruta pública `/status` fuera de autenticación, peticiones sin `Authorization` y sin redirecciones a login. Enlace discreto desde login.
- [x] Una única función de estado testeada: Operacional, Degradado, Caído y Sin datos. Umbral de degradación configurable (ejemplo 99%); chequeos más viejos que `STATUS_STALE_AFTER_MINUTES` (ejemplo 5) son Sin datos, incluido worker caído. Documentar reglas en el README del endpoint.
- [x] UI con resumen del peor estado, icono y texto, uptime y “última verificación hace X”; carga, vacío y error. Refresco cada 30–60 segundos, conservando datos ante fallos y mensajes claros para 429, sin errores crudos.
- [x] Verificación local: unitarios y e2e de API contra PostgreSQL real de Compose, lint y tests aplicables del frontend, `go test -count=1 ./...`, `docker compose up -d --build`, API healthy y curl con las cuatro claves exactas. No se agregan healthchecks de worker/frontend en esta fase.
- [x] Entregar bloque de variables nuevas con valores solo de ejemplo, sin leer ni editar `.env.example`.

El seed reconcilia `is_public` en cada ejecución: solo permanecen públicos los monitores del dueño configurado cuyo `seed_key` aparece en el manifiesto actual. Entradas omitidas, dueños anteriores y claves nulas se ocultan sin borrar monitores ni historial; un manifiesto vacío oculta todo. Sin `STATUS_OWNER_EMAIL`, el seed revoca toda publicación existente y no necesita leer un manifiesto de estado. La reconciliación se confirma junto con los upserts y registra el número realmente ocultado, incluso si es cero.

Validación local de la corrección de publicación: 76 tests unitarios, 46 tests e2e de API contra la base dedicada de PostgreSQL Compose y `bun run build` aprobados.

Verificación local observada: API 74 unitarios y 44 e2e contra PostgreSQL real; frontend 120 tests, lint, typecheck y build; Go 3 paquetes aprobados y 3 sin tests. Compose construido y levantado, API healthy, curl anónimo 200 con dos filas y las cuatro claves exactas. Chromium comprobó sesión vencida, variantes de ruta pública, ausencia de Authorization y conservación de datos ante fallos de refresco.

**Pendiente externo:** CI remoto no ejecutado/observado; no hubo push, PR ni merge. La implementación y la verificación local están completas, pero no se declara cumplida la condición de cierre de fase que exige CI verde. RDD sigue desactivado solo para este clon por decisión explícita del usuario; la revisión bloqueada se conserva sin aprobación.

## FASE 4: Despliegue

### Reglas específicas
- No leer ni editar ningún archivo `.env*`, incluidos los ejemplos; no buscar rutas alternativas si la seguridad bloquea un archivo. Entregar al final bloques completos y consolidados de raíz y API, con un comentario por variable y valores solo de ejemplo, para que el usuario los pegue.
- Probar con variables de entorno en la línea de comandos o en `env` del workflow, sin secretos reales. No hacer acciones en servicios externos ni en la nube; no hacer push ni merge sin confirmación.
- Primero un commit pequeño que actualice este plan; después commits pequeños por capa: worker, API, Compose/Caddy, CI y backups/documentación. Mantener tests con el comportamiento y dejar aquí un checkpoint breve de hecho y pendiente al cerrar cada capa.
- Mostrar solo resúmenes y fallos de tests. No declarar verificaciones pendientes como aprobadas.

### Worker: salud, deadlines y retención
- [x] Agregar contextos con timeout a todas las consultas del worker, incluido polling, persistencia, reset demo, retención y healthcheck. Tests en Go de consulta lenta y cancelación.
- [x] Heartbeat actualizado por el progreso real de cada ciclo del poller, también sin monitores pendientes; subcomando del propio binario que comprueba frescura y conexión a DB con timeout, sin requerir shell en la imagen. Tests del heartbeat que deja de avanzar y de DB no disponible.
- [x] Retención periódica en el worker para `check_result` mediante `CHECK_RESULT_RETENTION_DAYS` (30 por defecto) y para `alert` con `ALERT_RETENTION_DAYS` (90 por defecto), borrando en lotes pequeños y sin tocar `monitor.last_state` ni datos recientes.
- [x] Fallar al arrancar con error claro si la retención de checks es menor que `STATUS_UPTIME_WINDOW_HOURS`; agregar índices por `created_at`. Tests contra PostgreSQL real: solo borra datos viejos, es idempotente y preserva el agregado SQL de uptime de la ventana pública.
- [x] Verificar además por HTTP que `/api/v1/public/status` conserva el uptime antes/después de retención real: 66,67 %, tres checks recientes, una alerta reciente y estado del monitor preservados.

### API: salud y arranque
- [x] Endpoint público `/api/v1/health` que verifica la conexión a DB; agregar al inventario exacto de rutas públicas y a los tests.
- [x] Con `NODE_ENV=production`, rechazar al arrancar `CORS_ORIGINS` vacío o con `*`; restringir al origen configurado de Caddy. Tests de configuración válida e inválida.
- [x] Entry point: validar variables obligatorias de producción y del seed (`DATABASE_URL`, `SECRET_KEY`, `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`, `STATUS_OWNER_EMAIL` y las necesarias para los manifiestos), ejecutar `prisma migrate deploy`, seed idempotente demo/estado y luego servidor; fallar explícitamente si cualquier paso falla.
- [x] Imagen de producción con CLI local de Prisma y seed compilado; verificar la ruta real del servidor (`dist/main.js`) y usuarios sin root donde sea posible.

### Compose de producción y Caddy
- [x] Crear `docker-compose.prod.yml` separado con db, api, worker, frontend y Caddy; proyecto `sentinel-prod` separado de las redes y los volúmenes de desarrollo.
- [x] Verificar el build y arranque real de desarrollo con las definiciones originales y valores de prueba aislados: API healthy, worker running, estado público y frontend disponibles; los archivos originales no cambiaron.
- [x] Solo Caddy publica 80/443; db, API, worker y frontend sin puertos publicados. Frontend sin root en puerto interno alto (por ejemplo 8080).
- [x] `NODE_ENV=production`; `SECRET_KEY` y contraseña de PostgreSQL obligatorios sin valores por defecto; rechazar contraseña `postgres`. Fallo claro por configuración faltante o inválida.
- [x] Volumen persistente de PostgreSQL, `restart: unless-stopped`, límites de memoria para VM pequeña y logs `json-file` con `max-size`/`max-file`.
- [x] Healthchecks de DB (`pg_isready`), API, frontend y worker, y dependencias con `condition: service_healthy`; worker no arranca antes de que la API haya migrado, sembrado y esté healthy.
- [x] Caddyfile con `SITE_ADDRESS` (localhost para pruebas), HTTPS automático, compresión, HSTS, X-Content-Type-Options, Referrer-Policy, protección contra framing, CSP compatible y caché larga solo para assets con hash.
- [x] Un solo salto a la API: Caddy enruta `/api/*` directamente a API y el resto a frontend; conservar `trust proxy=1`. Test a través de Caddy: variar un `X-Forwarded-For` falso no evita el rate limit (sexta petición → 429).
- [x] Prueba local con `SITE_ADDRESS=localhost`: todos los servicios healthy y web por HTTPS; poller colgado → unhealthy; worker detenido → exited, reiniciado → healthy; DB pausada con `docker compose pause db` → worker unhealthy y recuperación al reanudar. Fixture con plazos de salud acortados para el test, sin desactivar las validaciones.

- [x] Prueba básica local: cinco servicios healthy, HTTPS con CA interna verificada sin modificar el trust store del host, rutas API/SPA/assets y montaje real de React en Chromium.

### CI y ARM
- [x] Definir job obligatorio AMD64 en PR/main/manual: construir imágenes de producción, levantar Compose con valores de prueba, esperar servicios healthy y smoke de `/api/v1/health` y `/api/v1/public/status`. Actionlint, contratos y ejecución local AMD64 aprobados; ejecución remota pendiente de push autorizado.
- [x] Definir job ARM64 Buildx/QEMU separado, opt-in manual y no bloqueante: tres Dockerfiles de producción explícitos, build-only y sin registro. Ejecución real ARM64 aún pendiente.
- [ ] En la VM ARM construir con `docker compose build`, sin registro. Si argon2 o Prisma fallan en Alpine/ARM64, comunicar error exacto antes de cambiar la imagen base y documentar limitaciones en `DEPLOY.md`; el agente no modifica infraestructura externa.

### Backups y documentación
- [x] Script de backup PostgreSQL con `pg_dump` comprimido, rotación y manejo claro de fallos; restauración real local aislada aprobada con verificación independiente.
- [x] Documentar la restauración PostgreSQL en `DEPLOY.md`.
- [x] `DEPLOY.md`: Docker en VM Linux, DNS del subdominio, firewall del proveedor y de la VM (80/443), clonar, configuración, build local, levantar, logs, actualizar, backup/restauración y rollback.
- [x] README en inglés actualizado: descripción, enlaces de demo y status, acceso demo compartido y limitado, arquitectura Mermaid, strategy + registry, worker desacoplado, seguridad implementada, salud/retención/backups y restore en `DEPLOY.md`, stack y comandos locales. Afirmar solo lo implementado.
- [x] README: añadir enlace real proporcionado para el demo y credenciales de acceso documentadas.
- [ ] Añadir enlace al video demo — pendiente de publicación por el usuario; mantener solo un comentario HTML TODO hasta entonces.
- [x] Bloques consolidados de raíz y API documentados en `DEPLOY.md`, con un comentario por variable y solo placeholders; sin acceder a archivos `.env*`.
- [ ] Pegar y completar los ejemplos de configuración — pendiente del usuario; el agente no crea ni edita archivos `.env*`.
- [x] Verificación final local: API 107 unitarios/51 e2e contra PostgreSQL real/build; frontend 121 tests/lint/typecheck/build; Go 7 paquetes/full/race/build e integración PostgreSQL de retención. Smoke: 30 assertions, 15 escenarios producción (142 s), 5 desarrollo (26 s). Registrar por separado checks no ejecutados: ShellCheck no disponible; CI remoto/ARM64/VM/ACME público pendientes.

### Checkpoints
- Cierre local: README/DEPLOY en inglés y corrección puntual del generador frontend obsoleto completados; lectura estructural de contratos/configuración/restore aprobada. Evaluación nativa pasiva: no requiere más suites ni verifier separado para estos docs. La verificación funcional independiente final aprobó API 107 unitarios/51 e2e/build, frontend 121 tests/lint/typecheck/build, Go full/race/build e integración de retención, smoke de producción 142 s y desarrollo 26 s. Cero recursos Docker propios filtrados; contenedor previo sigue exited255 sin cambios. Chromium DOM se verificó en D06, no se afirma una ejecución nueva. RDD apagado; sin push, merge, acceso a `.env*` ni operaciones externas. Configuración, enlaces reales, ARM64/VM/CI remoto/ACME público quedan bajo control del usuario.
- Backups: dump privado y atómico validado con gzip, rotación configurable por proyecto y orden UTC seguro ante DST, archivo recién publicado protegido y fallos explícitos. Verificación independiente: 9 regresiones, 14 casos negativos y restore nuevo PostgreSQL 17 de 4 s; schema, IDs/FKs/secuencias, estado/timestamps, 1 usuario/2 monitores/3 checks/2 alertas y uptime SQL 66,67 % preservados. Cero recursos Docker propios filtrados; DB previa no tocada. Gzip no cifra; documentación de restore y suites finales locales completadas. ShellCheck no disponible.
- Plan aprobado y ampliado. La Fase 3 está fusionada en `main` (`e0a4990`, PR #16); su CI verde fue confirmado por el usuario. El registro anterior de pendiente externo corresponde a la sesión previa al merge.
- Worker: deadlines, heartbeat atómico por progreso, subcomando `health`, retención e índices implementados. Suites Go, race y build aprobados con verificación independiente; limpieza real aislada preservó datos recientes, `last_state` y agregado SQL de uptime y fue idempotente. Retención: checks 30 días, alertas 90, lotes de 500, máximo 10 por tabla/pasada, pausa 50 ms, intervalo 60 minutos y deadline 5 segundos. Frescura mínima: `4 × WORKER_DB_TIMEOUT_SECONDS + 27` segundos (67 por defecto). Integración aprobada con smoke aislado: invariancia de uptime por HTTP y recuperación ante poller colgado, worker detenido/reiniciado y DB pausada. Workflow de CI definido y smoke AMD64 local aprobado; ejecución remota/ARM y despliegue externo siguen pendientes; backups y documentación local completados.
- Compose/Caddy: imágenes de producción separadas, DB/API/worker/frontend no-root y sin puertos host; solo Caddy publica 80/443, volúmenes/logs/límites/dependencias y guardas verificadas. 121 tests del frontend, lint, typecheck y builds aprobados con Node real/ICU completo en builder. Cinco servicios healthy, cuatro migraciones/seed, TLS local con CA fijada, HTTP health/estado público/SPA, caché de assets y React en Chromium aprobados. Smoke reutilizable: 30 assertions de seguridad/limpieza, 15 casos de producción y 5 de desarrollo aprobados independientemente. XFF falso sigue limitado; SIGSTOP/CONT, stop/start y pausa/reanudación de DB recuperan la salud. Retención real borró dos checks antiguos y una alerta antigua, preservando tres checks recientes, una alerta reciente, estado y uptime HTTP 66,67 %. Limpieza falla de forma segura ante errores/timeouts y conserva el código de error original; cero recursos propios sobrantes. Sin HTTP de monitoreo externo ni cambios en DB preexistente. Shellcheck no disponible; ARM, TLS público y CI remoto aún pendientes.
- CI: `.github/workflows/deployment-smoke.yml` validado independientemente con actionlint 1.7.12 en imagen temporal aislada (cero errores), YAML/expresiones/argv/contratos y smoke AMD64 completo (134 s, 30 assertions y 15 casos). Job obligatorio de 20 minutos con comando de 900 s; ARM64 opt-in manual/no bloqueante de 30 minutos, tres Dockerfiles `.prod` explícitos y `--load` sin push. Recursos propios limpiados; scripts de smoke no cambiaron. No se ejecutó CI remoto ni ARM64; ACME público/VM externa siguen pendientes.
- API: health público con DB, inventario exacto, CORS estricto y validación de producción implementados; 107 unitarios, 51 e2e y build aprobados con verificación independiente en imagen aislada sin entradas `.env*` del host. Imagen no-root (UID 100), Prisma CLI local, seed compilado y servidor `dist/main.js` verificados. Arranque real en DB nueva: cuatro migraciones → seed → HTTP healthy; nueve configuraciones inválidas rechazadas antes de migrar. Reinicio preservó IDs, `last_state`, `last_checked_at`, tres checks, dos alertas y uptime público por HTTP (66,67 %). Pruebas de orden y abortos de migración/seed con comandos simulados aprobadas. Desarrollo conserva sus rutas originales; integración Compose/Caddy, proxy y worker aprobada en stacks aislados. Nest ignora archivos de entorno en test/producción; Prisma 6 carga dotenv al importar, por lo que las pruebas usan cliente generado en imagen limpia y Node real para Jest.
