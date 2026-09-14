# Sentinel

[![CI](https://github.com/EliottV17/sentinel-project/actions/workflows/ci.yml/badge.svg)](https://github.com/EliottV17/sentinel-project/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

An asynchronous uptime monitoring and alerting engine designed as a polyglot monorepo. It couples a REST API built with **FastAPI** with a high-throughput background polling worker written in **Go**, both operating over a shared PostgreSQL database.

```text
sentinel/
├── sentinel-api/      # Python / FastAPI — REST API + auth (checking runs in the Go worker)
├── sentinel-worker/   # Go — High-frequency independent polling worker
└── frontend/          # React + Vite (TypeScript) SPA — login & monitors dashboard
```

## Architecture Overview

```text
               +----------------------------------+
               |        Client / Dashboard        |
               +-----------------+----------------+
                                 | (HTTP / REST)
                                 v
                     +-----------------------+
                     |  sentinel-api (Py)    |
                     |  - REST Endpoints     |
                     +-----------+-----------+
                                 |
                                 v
+-----------------------+   (Asyncpg / SQLModel)   +-----------------------+
|  sentinel-worker (Go) +------------------------->+      PostgreSQL       |
|  - 2s Polling Loop    |     (pgx pool)           |  - Monitors           |
|  - State Transitions  |<-------------------------+  - Check Results (Log)|
+-----------+-----------+                          |  - Alerts             |
            |                                      +-----------------------+
            v
     [External Targets] (HTTP Checkers)
```

## Core Highlights

* **Strategy & Registry Pattern:** Plug-and-play checkers (`BaseChecker`) — currently an HTTP checker — registered by type name without touching the polling engine.
* **State Machine for Alerts:** Emits alerts only on transitions (`healthy -> unhealthy = DOWN` / `unhealthy -> healthy = RECOVERY`), preventing notification floods while storing immutable audit logs.
* **Zero MQ Overhead:** Multi-language concurrency synchronization directly backed by PostgreSQL query filtering on `last_checked_at + frequency`.

## Quick Start (Full Stack with Docker)

Clone the repository and spin up all services (PostgreSQL 17, FastAPI API, Go Worker):

```bash
git clone https://github.com/EliottV17/sentinel-project.git
cd sentinel-project

# Build and start all services
docker compose up -d --build
```

* **API Docs (Swagger UI):** http://localhost:8000/docs
* **PostgreSQL:** `localhost:5432`

## Frontend (React SPA)

The UI lives in `frontend/` (Vite + React 19 + TypeScript + Tailwind v4). In dev it
proxies `/api` to the API on `http://localhost:8000` (no CORS involved locally);
for a separated prod origin set `VITE_API_BASE_URL` (see `frontend/.env.example`).

```bash
cd frontend
npm install                # install deps (or: npm ci for a clean/reproducible install)
npm run dev                # dev server with HMR on http://localhost:5173
npm run build              # typecheck (tsc -b) + production build to dist/
npm run test               # vitest run (unit/component tests, MSW-mocked API)
npm run test:watch         # vitest watch mode
npm run lint               # eslint (flat config)
npm run typecheck          # tsc -b only
npm run gen:api            # regenerate src/lib/api/schema.ts from a running API's /openapi.json
```

Prerequisites for `gen:api`: a running dev API (`cd sentinel-api && uv run uvicorn
app.main:app`). Regenerate only when the API contract changes; the generated
schema is committed.

## Sub-Packages Documentation

For detailed local development instructions, testing requirements, and service architecture:

* [Sentinel API (Python / FastAPI)](./sentinel-api/README.md)
* [Sentinel Worker (Go)](./sentinel-worker/README.md)
