"""Create db/preloaded.sql from the current PostgreSQL database."""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

OUTPUT = Path(os.getenv("PRELOADED_DUMP_PATH", "/app/db/preloaded.sql"))
TABLES = [
    "tracker_applications",
    "tracker_frns",
    "tracker_status_history",
    "usac_sync_state",
]


def main() -> None:
    url = os.getenv("DATABASE_URL")
    if not url:
        print("DATABASE_URL required", file=sys.stderr)
        sys.exit(1)

    parsed = urlparse(url)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PGPASSWORD": parsed.password or ""}

    args = [
        "pg_dump",
        "-h", parsed.hostname or "localhost",
        "-p", str(parsed.port or 5432),
        "-U", parsed.username or "",
        "-d", parsed.path.lstrip("/"),
        "--data-only",
        "--column-inserts",
        *sum([["-t", t] for t in TABLES], []),
        "-f", str(OUTPUT),
    ]
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUTPUT} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()