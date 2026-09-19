# Sentinel API (NestJS + Bun)

REST API de Sentinel construida con [NestJS](https://nestjs.com/), [Prisma ORM](https://www.prisma.io/) y [Bun](https://bun.sh/), encargada de la autenticación de usuarios, administración de monitores y consulta de métricas e historial.

El motor de ejecución y polling pesado es ejecutado de manera concurrente por `sentinel-worker` (Go).

## Requisitos

- [Bun](https://bun.sh/) >= 1.2
- Docker y Docker Compose (PostgreSQL 17)

## Configuración de Entorno

Crear o copiar el archivo `.env` basado en `.env.example` o `env.template`:

```bash
cp env.template .env
```

Variables disponibles:

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `DATABASE_URL` | URL de conexión PostgreSQL (formato `postgresql://...`) | `postgresql://postgres:postgres@localhost:5432/sentinel_db` |
| `SECRET_KEY` | Clave secreta para la firma de tokens JWT | `change-me-secret-key-sentinel` |
| `ALGORITHM` | Algoritmo de firma JWT | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Tiempo de expiración del token JWT en minutos | `30` |
| `CORS_ORIGINS` | Orígenes permitidos separados por comas | `http://localhost:5173` |
| `PORT` | Puerto en el que escucha el servidor | `8000` |

## Setup Local

```bash
# 1. Instalar dependencias
bun install

# 2. Generar cliente de Prisma
bunx prisma generate

# 3. Sincronizar el esquema con la base de datos
bunx prisma db push

# 4. Iniciar servidor en modo desarrollo
bun run start:dev
```

## Endpoints Principales

Todos los endpoints (excepto el healthcheck) tienen el prefijo `/api/v1`:

### Healthcheck
- `GET /` — Estado general del servicio (`Sentinel API está en línea y vigilando`).

### Auth & Usuarios
- `POST /api/v1/auth/login` — Autenticación con email o username y password (soporta JSON y `x-www-form-urlencoded`). Retorna `access_token` JWT.
- `POST /api/v1/users` — Registro de nuevo usuario (valida complejidad de password).
- `GET /api/v1/users/me` — Perfil del usuario autenticado (requiere `Authorization: Bearer <token>`).

### Monitores
- `POST /api/v1/monitors` — Crear monitor (`name`, `target`, `check_type`, `frequency` >= 10s).
- `GET /api/v1/monitors` — Listar monitores pertenecientes al usuario autenticado.
- `PATCH /api/v1/monitors/:id` — Actualizar monitor existente.
- `DELETE /api/v1/monitors/:id` — Eliminar monitor y sus registros asociados (`check_result`, `alert`) en cascada.
- `GET /api/v1/monitors/:id/history?limit=50` — Consultar historial de chequeos (`check_result`) del monitor.
- `GET /api/v1/monitors/:id/alerts?limit=20` — Consultar alertas emitidas por transiciones de estado del monitor.

## Tests y Build

```bash
# Compilar TypeScript
bun run build

# Tests unitarios (Jest)
bun run test

# Tests end-to-end (Supertest + Jest)
bun run test:e2e
```
