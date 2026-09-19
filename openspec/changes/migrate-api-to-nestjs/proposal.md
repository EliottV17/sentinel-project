# Propuesta Técnica: Migración de Sentinel API a NestJS + Prisma

## 1. Contexto y Objetivos

`sentinel-api` actúa actualmente como una API REST pura construida sobre FastAPI, SQLModel y Alembic.
Todo el trabajo de monitoreo pesado, polling periódico y generación de alertas fue delegado de forma exclusiva al worker en Go (`sentinel-worker`).

El objetivo de esta migración es:
- Unificar el stack tecnológico del backend a **TypeScript (NestJS)** para la API REST y **Go** para el worker concurrente.
- Mantener compatibilidad 100% retrocompatible con la base de datos PostgreSQL existente (compartida con el worker de Go).
- Mantener compatibilidad con el frontend SPA y los clientes HTTP existentes.
- Utilizar **Prisma ORM** para el acceso a datos tipado e introspección del esquema actual.
- Mantener la suite de tests automatizados (e2e/unit) garantizando paridad de comportamiento.

---

## 2. Decisiones de Arquitectura

### 2.1 Módulos de NestJS
La arquitectura seguirá la estructura modular estándar de NestJS:
- **`PrismaModule` (`src/prisma/`)**:
  - `PrismaService` singleton que extiende `PrismaClient` con gestión de ciclo de vida (`onModuleInit`, `onModuleDestroy`).
- **`AuthModule` (`src/auth/`)**:
  - Estrategia JWT (`passport-jwt`) para verificar tokens con `HS256` y `sub: email`.
  - Soporte de login tanto en `application/x-www-form-urlencoded` como en `application/json`.
  - Verificación y hash de contraseñas usando la librería nativa `argon2` para garantizar paridad con `argon2-cffi` de Python.
- **`UsersModule` (`src/users/`)**:
  - DTOs con `class-validator` para validar complejidad de contraseñas (mínimo 8 caracteres, letras y números) y username alfanumérico (3-20 caracteres).
  - Endpoints: `POST /api/v1/users/` (registro) y `GET /api/v1/users/me` (perfil autenticado).
- **`MonitorsModule` (`src/monitors/`)**:
  - DTOs con `class-validator` para validar `check_type` ('http') y `frequency >= 10`.
  - Endpoints:
    - `POST /api/v1/monitors/`
    - `GET /api/v1/monitors/`
    - `PATCH /api/v1/monitors/:id`
    - `DELETE /api/v1/monitors/:id` (borrado en cascada de `check_result` y `alert` asociados).
    - `GET /api/v1/monitors/:id/history` (límite por defecto 50, orden desc).
    - `GET /api/v1/monitors/:id/alerts` (límite por defecto 20, orden desc).
- **`AppModule` (`src/app.module.ts`)**:
  - Enrutamiento global con prefijo `/api/v1` (excepto health check raíz `GET /`).
  - Configuración de CORS basada en variables de entorno.

### 2.2 Compatibilidad de Datos con Go (`sentinel-worker`)
El worker de Go mapea directamente sobre las tablas:
- `monitor`
- `check_result`
- `alert`
- `users`

Prisma mapeará estos modelos exactamente a las tablas existentes mediante introspección (`prisma db pull`), preservando los tipos JSON para `check_config` y `extra_data`, claves foráneas e índices.

### 2.3 Seguridad y Criptografía
- **Hashing**: `argon2` (PHC format `$argon2id$v=19$m=65536,t=3,p=4$...`).
- **Tokens**: `@nestjs/jwt` con HMAC SHA-256 (`HS256`), expira en 30 minutos por defecto.

---

## 3. Plan de Migración por Fases

1. **Fase 1: Setup inicial y Schema Prisma (Actual)**
   - Inicializar entorno Node / NestJS con TypeScript y dependencias clave.
   - Configurar Prisma y validar `prisma db pull` contra la base de datos PostgreSQL activa (`sentinel_db`).
   - Generar `PrismaClient` tipado.
2. **Fase 2: Core & Database Module**
   - Configuración global (`@nestjs/config`), validación de variables de entorno (`DATABASE_URL`, `SECRET_KEY`, `ALGORITHM`, `CORS_ORIGINS`).
   - `PrismaService` y `PrismaModule`.
3. **Fase 3: Auth & Users**
   - Hashing Argon2 y generación/validación de JWT.
   - DTOs de registro y login.
   - Guards (`JwtAuthGuard`) y decorador `@CurrentUser()`.
4. **Fase 4: Monitors**
   - CRUD completo de monitores con permisos de usuario.
   - Endpoints de historial y alertas.
   - Lógica de borrado en cascada consistente con la implementación actual.
5. **Fase 5: Testing & Docker**
   - Tests e2e con Jest y Supertest replicando la suite de Pytest existente.
   - Actualizar `sentinel-api/Dockerfile` a Node multi-stage build y ajustar `docker-compose.yml`.
