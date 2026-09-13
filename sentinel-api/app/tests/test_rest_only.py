"""REST-only invariant: the API runs no in-process checking engine.

Covers REQ-APIRUN-001..003. The Go worker (sentinel-worker) is the sole polling
engine. These tests fail if the Python scheduler module, its dependency, or its
wiring ever comes back.
"""

import importlib.util
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]  # sentinel-api/app/
THIS_FILE = Path(__file__).resolve()


def test_scheduler_module_is_deleted():
    assert importlib.util.find_spec("app.core.scheduler") is None, (
        "app.core.scheduler must not exist — the API is REST-only; the Go worker "
        "is the sole polling engine"
    )


def test_main_py_has_no_lifespan_wiring():
    import app.main as main_module

    # main.py previously bound `lifespan` via `from app.core.scheduler import lifespan`;
    # the default no-op lifespan must be used instead.
    assert "lifespan" not in vars(main_module), (
        "app.main must not import or bind a custom lifespan"
    )


def test_apscheduler_dependency_removed():
    assert importlib.util.find_spec("apscheduler") is None, (
        "apscheduler is still importable — run `uv sync --group dev` to refresh "
        "the environment after removing it from pyproject.toml"
    )


def test_no_scheduler_code_resurrected():
    forbidden = ("AsyncIOScheduler", "BackgroundScheduler", "check_all_monitors")
    offenders = [
        str(p)
        for p in sorted(APP_DIR.rglob("*.py"))
        if p != THIS_FILE
        and any(tok in p.read_text(encoding="utf-8") for tok in forbidden)
    ]
    assert not offenders, f"Scheduler code resurrected in: {offenders}"
