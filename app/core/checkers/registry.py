from app.core.checkers.base import BaseChecker


_checker_registry: dict[str, type["BaseChecker"]] = {}


def register(check_type: str):
    """Decorador que se registra un checker en el registry global."""

    def decorator(cls: type[BaseChecker]):
        _checker_registry[check_type] = cls
        return cls

    return decorator


def get_checker(check_type: str) -> BaseChecker:
    """Devuelve una instancia del checker para el tipo dado."""
    cls = _checker_registry.get(check_type)
    if cls is None:
        raise ValueError(f"Unknown checker type: {check_type}")
    return cls()
