# Sentinel API

Motor de monitoreo y alertas asíncrono construido con **FastAPI** y **PostgreSQL**. Actúa como un vigilante digital que consulta fuentes externas y notifica cuando se cumplen condiciones específicas.

## Tecnologías
- **FastAPI**: Framework principal aprovechando asincronía total.
- **SQLModel & Alembic**: Gestión de base de datos y migraciones.
- **PostgreSQL**: Almacenamiento persistente de alta fidelidad.
- **Docker & Docker Compose**: Orquestación de infraestructura.
- **uv**: Gestión de paquetes y entornos de última generación.
- **Ruff**: Linting y formateo de código ultra rápido.

# Instalación y Configuración

### 1. Clonar el repositorio
```bash
git clone https://github.com/EliottV17/sentinel-api.git
cd sentinel-api 
```

### 2. Instalar dependencias 
```bash
uv sync --group dev
```
### 3. Configurar variables de entorno
Crea un archivo .env basado en la configuración necesaria:
```bash
- DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/sentinel_db
- SECRET_KEY: Tu llave secreta para JWT.
- ALGORITHM: HS256
```

### 4. Levantar la infraestructura
```bash
docker-compose up -d
```

# Estructura del Proyecto
app/
├── api/      # Endpoints y rutas
├── core/     # Configuración y seguridad
├── db/       # Conexión asíncrona
├── models/   # Modelos de SQLModel
└── services/ # Lógica del centinela