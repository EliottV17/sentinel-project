"""Pruebas de CORS — escritas primero (RED) según design §3.3.

El middleware captura ``allow_origins`` al registrarse y ``config.settings``
se instancia al importar, así que cada caso recarga ambos módulos bajo un
valor controlado de la variable de entorno ``CORS_ORIGINS``. No se usan
fixtures de BD (``override_session_db``, ``auth_headers``): el middleware
responde antes del enrutado.
"""

import importlib

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.config as config_module
import app.main as main_module

ALLOWED = "https://ui.example.com"


@pytest.fixture
async def cors_app(monkeypatch):
    """Recarga config+main con un valor controlado de CORS_ORIGINS.

    ``origins=None`` elimina la variable (comportamiento por defecto);
    teardown restaura el estado por defecto de la sesión recargando ambos
    módulos con la variable eliminada.
    """
    clients: list[AsyncClient] = []

    async def _make(origins: str | None) -> AsyncClient:
        if origins is None:
            monkeypatch.delenv("CORS_ORIGINS", raising=False)
        else:
            monkeypatch.setenv("CORS_ORIGINS", origins)
        importlib.reload(config_module)
        importlib.reload(main_module)
        client = AsyncClient(
            base_url="https://test", transport=ASGITransport(app=main_module.app)
        )
        clients.append(client)
        return client

    yield _make

    for client in clients:
        await client.aclose()
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    importlib.reload(config_module)
    importlib.reload(main_module)


async def test_cors_allows_configured_origin(cors_app) -> None:
    client = await cors_app(ALLOWED)
    response = await client.get("/", headers={"Origin": ALLOWED})
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == ALLOWED
    assert response.headers["Access-Control-Allow-Credentials"] == "true"


async def test_cors_preflight_handled(cors_app) -> None:
    client = await cors_app(ALLOWED)
    response = await client.options(
        "/api/v1/monitors/",
        headers={
            "Origin": ALLOWED,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code < 400
    assert response.headers["Access-Control-Allow-Origin"] == ALLOWED
    assert "Access-Control-Allow-Methods" in response.headers
    # Con allow_headers=["*"] el middleware omite la cabecera: la ausencia
    # significa "cualquier cabecera permitida"; "*" explícito también vale.
    allow_headers = response.headers.get("Access-Control-Allow-Headers")
    assert allow_headers is None or allow_headers == "*"


async def test_cors_rejects_unconfigured_origin(cors_app) -> None:
    client = await cors_app(ALLOWED)
    response = await client.get("/", headers={"Origin": "https://evil.example.com"})
    assert response.headers.get("Access-Control-Allow-Origin") is None


async def test_cors_empty_default_blocks_cross_origin(cors_app) -> None:
    client = await cors_app("")
    response = await client.get("/", headers={"Origin": ALLOWED})
    assert response.headers.get("Access-Control-Allow-Origin") is None
