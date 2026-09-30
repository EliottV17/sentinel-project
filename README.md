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
├── sentinel-api/      # Python / FastAPI — REST API, auth & in-process scheduler
└── sentinel-worker/   # Go — High-frequency independent polling worker
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
                     |  - In-process Cron    |
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

* **Strategy & Registry Pattern:** Plug-and-play checkers (`BaseChecker`) extending ping/HTTP checks without touching the core scheduler.
* **State Machine for Alerts:** Emits alerts only on transitions (`healthy -> unhealthy = DOWN` / `unhealthy -> healthy = RECOVERY`), preventing notification floods while storing immutable audit logs.
* **Zero MQ Overhead:** Multi-language concurrency synchronization directly backed by PostgreSQL query filtering on `last_checked_at + frequency`.

## Quick Start (Full Stack with Docker)

Clone the repository and spin up all services (PostgreSQL 17, FastAPI API, Go Worker):

```bash
git clone https://github.com/EliottV17/sentinel-project.git
cd sentinel

# Build and start all services
docker compose up -d --build
```

* **API Docs (Swagger UI):** http://localhost:8000/docs
* **PostgreSQL:** `localhost:5432`

## Sub-Packages Documentation

For detailed local development instructions, testing requirements, and service architecture:

* [Sentinel API (Python / FastAPI)](./sentinel-api/README.md)
* [Sentinel Worker (Go)](./sentinel-worker/README.md)
