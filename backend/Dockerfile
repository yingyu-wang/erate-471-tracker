# FastAPI backend — USAC import on startup, then uvicorn
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY ensure_import.py create_preloaded_dump.py backfill_pdf_urls.py ./
COPY db ./db

ENV DATABASE_URL=postgresql://erate:erate_secret@db:5432/erate_471
ENV AUTO_IMPORT_USAC=true
ENV USAC_IMPORT_STATE=CA
ENV USAC_SYNC_MIN_INTERVAL_HOURS=24
ENV PRELOADED_DUMP_PATH=/app/db/preloaded.sql

EXPOSE 8000

CMD ["sh", "-c", "python ensure_import.py; uvicorn app.main:app --host 0.0.0.0 --port 8000"]