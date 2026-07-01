"""Global state tracking for USAC import initialization.

Uses file-based flags in /tmp so state is shared across the two separate
processes: ensure_import.py (pre-start script) and uvicorn (API server).
Both run inside the same container, so /tmp is a common filesystem.
"""

import os
import threading

_lock = threading.Lock()

_IMPORT_DONE_FILE = "/tmp/.usac_import_done"
_IMPORT_ERROR_FILE = "/tmp/.usac_import_error"


def set_importing(value: bool) -> None:
    """Set whether USAC import is in progress.
    
    Passing False (import complete) writes a sentinel file that persists
    for the life of the container and is visible to the uvicorn process.
    Passing True removes that file (used for testing / reset).
    """
    with _lock:
        if not value:
            with open(_IMPORT_DONE_FILE, "w") as f:
                f.write("done")
        else:
            if os.path.exists(_IMPORT_DONE_FILE):
                os.remove(_IMPORT_DONE_FILE)


def set_import_error(error: str | None) -> None:
    """Set import error message."""
    with _lock:
        if error:
            with open(_IMPORT_ERROR_FILE, "w") as f:
                f.write(error)
        else:
            if os.path.exists(_IMPORT_ERROR_FILE):
                os.remove(_IMPORT_ERROR_FILE)


def is_importing() -> bool:
    """Check if USAC import is in progress."""
    with _lock:
        return not os.path.exists(_IMPORT_DONE_FILE)


def get_import_error() -> str | None:
    """Get import error message."""
    with _lock:
        if os.path.exists(_IMPORT_ERROR_FILE):
            with open(_IMPORT_ERROR_FILE) as f:
                return f.read().strip() or None
        return None
