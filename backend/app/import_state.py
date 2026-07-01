"""Global state tracking for USAC import initialization."""

import threading

_lock = threading.Lock()
_is_importing = True  # Start as True, set to False when import completes
_import_error: str | None = None


def set_importing(value: bool) -> None:
    """Set whether USAC import is in progress."""
    global _is_importing
    with _lock:
        _is_importing = value


def set_import_error(error: str | None) -> None:
    """Set import error message."""
    global _import_error
    with _lock:
        _import_error = error


def is_importing() -> bool:
    """Check if USAC import is in progress."""
    with _lock:
        return _is_importing


def get_import_error() -> str | None:
    """Get import error message."""
    with _lock:
        return _import_error
