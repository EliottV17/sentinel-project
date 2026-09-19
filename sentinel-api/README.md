# Sentinel API (NestJS + Bun)

REST API de Sentinel construida con [NestJS](https://nestjs.com/), [Prisma ORM](https://www.prisma.io/) y [Bun](https://bun.sh/), encargada de la autenticación de usuarios, administración de monitores y consulta de métricas e historial.

El motor de ejecución y polling pesado es ejecutado de manera concurrente por `sentinel-worker` (Go).

## Requisitos

- [Bun](https://bun.sh/) >= 1.2
- Docker y Docker Compose (PostgreSQL 17)

## Setup Local

```bash
# 1. Instalar dependencias
bun install

# 2. Generar cliente de Prisma
bunx prisma generate

# 3. Iniciar servidor en modo desarrollo
bun run start:dev
```

## Tests y Build

```bash
# Compilar TypeScript
bun run build

# Tests unitarios
bun run test

# Tests end-to-end
bun run test:e2e
```
