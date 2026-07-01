# E-Rate 471 Tracker

A web application for tracking USAC FCC Form 471 application status for California entities. Built with a React frontend, Python FastAPI backend, and PostgreSQL database, with automatic import from the [USAC Open Data API](https://opendata.usac.org).

## Features

- **USAC Open Data import** — California Form 471 applications and FRNs from USAC Socrata datasets
- **Preloaded database** — `backend/db/preloaded.sql` (~44 MB) for fast first startup without hitting the API
- **24-hour sync cache** — skips re-import if the last sync was less than 24 hours ago
- **PDF form links** — click an application number to open the certified Form 471 PDF (`usac_file_url`)
- **Dashboard** — portfolio stats, status breakdown, and recent applications
- **Application list** — search and filter by organization, application number, BEN, status, and funding year with pagination
- **Live 471 status refresh** — exact Form 471 number searches can trigger a real-time USAC status refresh
- **Application detail** — view FRNs, update status with notes, and review status history
- **New application form** — manually register Form 471 filings with optional FRNs
- **Startup readiness check** — loading screen with status polling until API is ready
- **Optional API authentication** — X-API-Key header for production deployments

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

### Quickstart (Docker only, no VS Code/Python/Node)

Use this when you just want to pull images and run locally with one command.

```bash
docker compose -f docker-compose.quickstart.yml up -d
```

Then open **http://localhost:3000**.

This quickstart file starts:
- Local PostgreSQL container
- API image: `yingyuwang/erate-471-tracker-api:0.2.0`
- Frontend image: `yingyuwang/erate-471-tracker-frontend:0.2.1`

Useful commands:

```bash
# Check status
docker compose -f docker-compose.quickstart.yml ps

# Stop services
docker compose -f docker-compose.quickstart.yml down

# Stop and remove local database data
docker compose -f docker-compose.quickstart.yml down -v
```

### Production Deployment (with Docker Hub images)

For production or trying out the latest release, use the published Docker Hub images:

```bash
# Copy environment template and configure
cp .env.example .env
# Edit .env with your DATABASE_URL and optional API_KEY

# Start all services with published images
docker compose -f docker-compose-prod.yml up -d
```

Then open **http://localhost:3000** in your browser. See [DEPLOY.md](DEPLOY.md) for detailed production configuration, database options, HTTPS setup, and troubleshooting.

### Development (Docker - All-in-One)

For development or testing, build and run locally:

```bash
# Start everything: database, backend API, and frontend (first-time setup)
docker compose --profile full up -d

# Or if PostgreSQL is already running:
docker compose up -d
```

Then open **http://localhost:3000** in your browser.

**First-time startup:** The app shows a loading screen while the API initializes. This involves:
- Running database migrations
- Loading or importing USAC data (preloaded dump restored in ~1-2 seconds, or full import in 2-5 minutes on first cold start)
- Once ready, the dashboard loads automatically

The frontend polls `/api/health/ready` every 2 seconds and displays:
- ✅ **"E-Rate 471 Tracker"** card with loading spinner while initializing
- **Error message** if import fails (with auto-retry)
- **Dashboard** once the API responds with status 200

**API docs** available at **http://localhost:8000/docs** (once ready).

**Troubleshooting port conflicts:**
```bash
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep "3000\|8000"
docker compose down  # stop all containers
```

### Without Docker (Local Development)

**Prerequisites:** Node.js 20+, Python 3.12+, PostgreSQL 16+

```bash
# Terminal 1: Start the backend API
cd backend
python -m venv .venv
source .venv/bin/activate  # macOS/Linux; Windows: .venv\Scripts\activate
pip install -r requirements.txt
python ensure_import.py
uvicorn app.main:app --reload --port 8000
```

```bash
# Terminal 2: Start the frontend
cd frontend
npm install
npm run dev
```

Then open **http://localhost:3000**. The Vite dev server proxies `/api` to the backend.

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

## Architecture

- **Frontend**: React 18 + TypeScript + Vite + Material UI (Nginx reverse proxy in Docker)
- **Backend**: FastAPI + SQLAlchemy ORM + sodapy (USAC data client)
- **Database**: PostgreSQL 16 with preloaded snapshot of CA Form 471 data
- **API Proxy**: Nginx (in Docker) proxies `/api` requests from frontend to backend

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://erate:erate_secret@localhost:5432/erate_471` | PostgreSQL connection string (required for production) |
| `API_KEY` | *(unset)* | Optional X-API-Key authentication (leave empty to disable auth) |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated allowed origins |
| `AUTO_IMPORT_USAC` | `true` | Run USAC import logic on API startup |
| `USAC_IMPORT_STATE` | `CA` | US state code to filter Open Data records |
| `USAC_SYNC_MIN_INTERVAL_HOURS` | `24` | Skip API import if last sync is within this window |
| `USAC_MIN_IMPORTED_APPS` | `1000` | Minimum applications before skipping restore/import |
| `PRELOADED_DUMP_PATH` | `/app/db/preloaded.sql` | Path to preloaded SQL dump file |
| `USAC_API_BASE` | `https://opendata.usac.org` | USAC Open Data API base URL |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness check (always returns 200 if API is running) |
| `GET` | `/api/health/ready` | Readiness check (returns 503 while importing, 200 when ready) |
| `GET` | `/api/sync/status` | USAC sync metadata (last sync time, app count) |
| `GET` | `/api/applications/stats` | Dashboard statistics |
| `GET` | `/api/applications` | List applications (filterable, paginated with `limit` and `offset` params, supports `live_status_check`) |
| `GET` | `/api/applications/{id}` | Get application with FRNs and history |
| `POST` | `/api/applications` | Create application |
| `PATCH` | `/api/applications/{id}` | Update application / status |
| `DELETE` | `/api/applications/{id}` | Delete application |
| `POST` | `/api/applications/{id}/frns` | Add FRN to application |
| `PATCH` | `/api/applications/frns/{frn_id}` | Update FRN |

### Authentication

API authentication is optional and controlled by the `API_KEY` environment variable:

- **Disabled (development)**: `API_KEY=""` or not set — all requests work without authentication
- **Enabled (production)**: `API_KEY=your-secret-key` — clients must include `X-API-Key: your-secret-key` header

Example with authentication:
```bash
curl -H "X-API-Key: sk-prod-abc123xyz" http://localhost:8000/api/applications
```

### Pagination

The `/api/applications` endpoint supports pagination with `limit` (default: 50, max: 500) and `offset` (default: 0):

```bash
# First 50 applications
curl http://localhost:8000/api/applications?limit=50&offset=0

# Next 50 applications
curl http://localhost:8000/api/applications?limit=50&offset=50

# Response includes total count:
# {"items": [...], "total": 28000, "limit": 50, "offset": 0}
```

### Live 471 Status Check

When searching by an exact Form 471 application number, clients can request a live status refresh from USAC Open Data before results are returned.

```bash
curl "http://localhost:8000/api/applications?search=181035670&live_status_check=true"
```

Notes:
- `live_status_check=true` is intended for exact application number searches.
- If a newer status is found in USAC, the local record is updated and status history is recorded.
- If USAC is temporarily unavailable, search still returns local cached results.

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
│   ├── Dockerfile               # Multi-stage build: Node builder + Nginx server
│   ├── nginx.conf               # Nginx reverse proxy config (app + /api → backend)
│   ├── vite.config.ts           # Dev server + API proxy
│   ├── package.json
│   └── .dockerignore
├── docker-compose.yml           # Orchestrates db, backend API, and frontend
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

## Production Deployment

### With Published Docker Images (Recommended)

Published images are available on Docker Hub:

- **Backend API**: [`yingyuwang/erate-471-tracker-api:0.2.0`](https://hub.docker.com/r/yingyuwang/erate-471-tracker-api)
- **Frontend**: [`yingyuwang/erate-471-tracker-frontend:0.2.0`](https://hub.docker.com/r/yingyuwang/erate-471-tracker-frontend)

For production deployment, see [DEPLOY.md](DEPLOY.md) for:
- Detailed setup instructions
- Database configuration (local PostgreSQL or managed services)
- HTTPS/TLS reverse proxy setup
- Environment variables and API key authentication
- Monitoring, logging, and backup procedures
- Troubleshooting guide

Quick start:

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL and optional API_KEY

docker compose -f docker-compose-prod.yml up -d
```

### With Docker (Development)

Build and start all services locally:

```bash
docker compose --profile full up -d
```

## License

See [LICENSE](LICENSE).