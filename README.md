# E-Rate 471 Tracker

A web application for tracking USAC FCC Form 471 application status for California entities. Built with a React frontend, Python FastAPI backend, and PostgreSQL database, with automatic import from the [USAC Open Data API](https://opendata.usac.org).

## Features

- **USAC Open Data import** — California Form 471 applications and FRNs from USAC Socrata datasets
- **Preloaded database** — `backend/db/preloaded.sql` (~44 MB) for fast first startup without hitting the API
- **24-hour sync cache** — skips re-import if the last sync was less than 24 hours ago
- **PDF form links** — click an application number to open the certified Form 471 PDF (`usac_file_url`)
- **Dashboard** — portfolio stats, status breakdown, and recent applications
- **Application list** — search and filter by organization, application number, BEN, status, and funding year
- **Application detail** — view FRNs, update status with notes, and review status history
- **New application form** — manually register Form 471 filings with optional FRNs

## Tech Stack

| Layer    | Technology                                      |
|----------|-------------------------------------------------|
| Frontend | React 18, TypeScript, Vite, Material UI         |
| Backend  | Python 3.12, FastAPI, SQLAlchemy, sodapy      |
| Database | PostgreSQL 16                                   |
| Data     | USAC Open Data (Socrata) — datasets `9s6i-myen`, `qdmp-ygft` |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (recommended for the API and database)
- [Node.js](https://nodejs.org/) 20+ (for the frontend)
- Python 3.12+ (optional — for local backend development without Docker)

## Quick Start

### 1. Environment

Create a `.env` file in the project root (or use the provided one):

```env
PORT=3000
DATABASE_URL=postgresql://erate:erate_secret@localhost:5432/erate_471
```

### 2. Database

Start PostgreSQL with Docker Compose (first-time setup):

```bash
docker compose --profile full up -d db
```

If you already have a Postgres instance on the `erate-471-tracker_default` network (hostname `postgres`), you can skip this step.

### 3. API

Build and start the backend with Docker Compose:

```bash
docker compose build api
docker compose up -d api
```

On startup the API runs `ensure_import.py`, which:

1. **Skips import** if the last sync was less than 24 hours ago and the database already has ≥1,000 applications
2. **Restores** `backend/db/preloaded.sql` if the database is empty and the dump file exists
3. **Runs a full USAC import** for California otherwise (can take several minutes)

The API serves at **http://localhost:8000**. Interactive docs are at **http://localhost:8000/docs**.

**Port conflict?** If port 8000 is already in use:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}" | findstr 8000
docker rm -f erate-471-api
docker compose up -d --force-recreate api
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**. The Vite dev server proxies `/api` requests to the backend on port 8000.

## USAC Data Import

### Datasets

| Dataset | ID | Contents |
|---------|-----|----------|
| Form 471 Basic Info | `9s6i-myen` | Application details, status, funding amounts |
| FRN Status | `qdmp-ygft` | Funding Request Numbers, commitments, disbursements |

California records are filtered with `org_state=CA` (applications) and `state=CA` (FRNs). Application data uses **Current** form versions; PDF URLs are pulled from matching **Original** form records (`file_url` field).

### Preloaded database

The file `backend/db/preloaded.sql` contains a snapshot of ~28,000 California applications and ~65,000 FRNs. It is baked into the Docker image for fast cold starts.

To regenerate the dump after a fresh import:

```bash
docker compose run --rm \
  -v ./backend/db:/app/db \
  -e DATABASE_URL=postgresql://erate:erate_secret@postgres:5432/erate_471 \
  api python create_preloaded_dump.py
```

Then rebuild the image so the new dump is included:

```bash
docker compose build api
```

### Manual import commands

```bash
# Force a full re-import from USAC (ignores 24h cache)
docker compose run --rm -e FORCE_USAC_IMPORT=true api python ensure_import.py

# Backfill PDF URLs from Original form records
docker compose run --rm api python backfill_pdf_urls.py

# Check sync status
curl http://localhost:8000/api/sync/status
```

## Local Backend Development (without Docker)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
python ensure_import.py
uvicorn app.main:app --reload --port 8000
```

Run from the `backend` directory. Requires PostgreSQL running and `DATABASE_URL` set (via `.env` or environment).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://erate:erate_secret@localhost:5432/erate_471` | PostgreSQL connection string |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated allowed origins |
| `PORT` | `3000` | Frontend dev server port (Vite) |
| `AUTO_IMPORT_USAC` | `true` | Run USAC import logic on API startup |
| `FORCE_USAC_IMPORT` | `false` | Force full re-import, bypassing 24h cache |
| `USAC_IMPORT_STATE` | `CA` | US state code to filter Open Data records |
| `USAC_SYNC_MIN_INTERVAL_HOURS` | `24` | Skip API import if last sync is within this window |
| `USAC_MIN_IMPORTED_APPS` | `1000` | Minimum applications before skipping restore/import |
| `PRELOADED_DUMP_PATH` | `/app/db/preloaded.sql` | Path to preloaded SQL dump file |
| `USAC_API_BASE` | `https://opendata.usac.org` | USAC Open Data API base URL |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/sync/status` | USAC sync metadata (last sync time, app count) |
| `GET` | `/api/applications/stats` | Dashboard statistics |
| `GET` | `/api/applications` | List applications (filterable) |
| `GET` | `/api/applications/{id}` | Get application with FRNs and history |
| `POST` | `/api/applications` | Create application |
| `PATCH` | `/api/applications/{id}` | Update application / status |
| `DELETE` | `/api/applications/{id}` | Delete application |
| `POST` | `/api/applications/{id}/frns` | Add FRN to application |
| `PATCH` | `/api/applications/frns/{frn_id}` | Update FRN |

### Application Statuses

`draft` · `certified` · `under_review` · `fcdl_approved` · `fcdl_denied` · `cancelled` · `appealing`

USAC statuses map as: Certified → `certified`, Committed → `fcdl_approved`.

### FRN Statuses

`pending` · `funded` · `denied` · `cancelled` · `partial`

## Project Structure

```
erate-471-tracker/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── models.py            # SQLAlchemy models
│   │   ├── schemas.py           # Pydantic schemas
│   │   ├── database.py          # DB session and engine
│   │   ├── config.py            # Settings from .env
│   │   ├── usac/                # USAC Open Data import module
│   │   │   ├── client.py        # Socrata API client
│   │   │   ├── mappers.py       # USAC → app field mapping
│   │   │   ├── importer.py      # Full import logic
│   │   │   └── sync.py          # 24h cache + preloaded restore
│   │   └── routers/
│   │       ├── applications.py
│   │       └── sync.py
│   ├── db/
│   │   └── preloaded.sql        # Preloaded CA USAC data (~44 MB)
│   ├── ensure_import.py         # Startup import orchestration
│   ├── create_preloaded_dump.py # Generate preloaded.sql from DB
│   ├── backfill_pdf_urls.py     # Backfill PDF links from Original forms
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/               # Dashboard, list, detail, form
│   │   ├── components/          # Layout, status badges, stats cards
│   │   ├── api/client.ts        # API client
│   │   └── theme.ts             # MUI colorful theme
│   ├── vite.config.ts           # Dev server + API proxy
│   └── package.json
├── docker-compose.yml
├── .env
└── README.md
```

## Database Tables

Tables use the `tracker_` prefix to avoid conflicts with other schemas in the same database:

| Table | Description |
|-------|-------------|
| `tracker_applications` | Form 471 records (`usac_file_url` for PDF link) |
| `tracker_frns` | Funding Request Numbers |
| `tracker_status_history` | Audit trail of status changes |
| `usac_sync_state` | Single-row USAC import/sync metadata |

Applications are uniquely identified by `(application_number, funding_year)`.

## Production Build

```bash
cd frontend
npm run build
```

Static assets are output to `frontend/dist/`. Serve them behind a reverse proxy that forwards `/api` to the FastAPI backend.

## License

See [LICENSE](LICENSE).