# E-Rate Form 471 Tracker

A local web application to track **USAC E-Rate FCC Form 471** application status, including Funding Request Numbers (FRNs), PIA review, FCDL dates, and commitment/disbursement amounts.

## Stack

- **Backend:** Node.js + Express
- **Database:** PostgreSQL 16
- **Frontend:** Vanilla HTML/CSS/JS (no build step)

## Quick Start (Docker — recommended)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cd erate-471-tracker
docker compose up --build
```

On **first startup**, the app automatically imports **California Form 471 data (Current + Pending)** from [USAC Open Data](https://opendata.usac.org/). This takes about **10–20 minutes**. Watch progress:

```bash
docker compose logs -f app
```

When you see `E-Rate 471 Tracker running at http://localhost:3000`, open **http://localhost:3000**.

Subsequent restarts skip the import if data is already loaded (Postgres volume persists).

To force a fresh import:

```bash
docker compose down -v
docker compose up --build
```

### Bake a preloaded dump (optional, faster first boot)

After a successful import, snapshot the data for future image builds:

```bash
npm run db:dump
docker compose build
```

If `db/preloaded.sql` exists, Docker restores it instead of calling the USAC API.

## Local development (without Docker app container)

### 1. Start PostgreSQL only

```bash
docker compose up -d postgres
```

### 2. Install dependencies

```bash
npm install
```

### 3. Initialize the database

```bash
npm run db:init
npm run db:seed
```

### 4. Run the app

```bash
npm start
```

### 5. Import California data (optional)

```bash
npm run import:usac
```

Limit to recent funding years (faster for testing):

```bash
npm run import:usac -- --year-min 2024
```

You can also trigger import from the Dashboard (**Import CA Data** button) or via `POST /api/import/usac`.

**Python SDK alternative (sodapy):** Set `USE_PYTHON_USAC_IMPORT=true` (included in the Docker image). This uses `server/scripts/import_usac.py` (official Socrata Python SDK) for the heavy lifting instead of the Node custom client. Run the Python version directly with:

```bash
npm run import:usac:py -- --help
npm run import:usac:py -- --year-min 2025
```

The web button and startup import will use it when the env var is set. See `server/scripts/requirements-usac-import.txt`.

- Normal click on the button performs a smart sync (respects `USAC_SYNC_MODE`/`USAC_SYNC_YEAR_WINDOW`; bypasses the "datasets unchanged" guard so you always get a fresh check against USAC Open Data for the window).
- Hold Shift/Ctrl/Cmd while clicking for a forced full import of all funding years (ignores incremental window + change detection).
- The button now surfaces detailed inserted/updated/unchanged counts and a "Last USAC sync" line (from `GET /api/import/usac/status`) on the dashboard.

## Development

```bash
npm run dev
```

Uses Node's `--watch` flag for auto-restart on file changes.

## Features

- **Dashboard** — application counts, status breakdown, funding by year, recent activity
- **Applications** — search/filter by funding year, BEN, entity name, or status
- **FRNs** — track Category 1/2 funding requests with commitment and disbursement amounts
- **Status history** — automatic audit trail when application or FRN status changes
- **CRUD** — create, edit, and delete applications and FRNs via the web UI
- **USAC import** — bulk import California Form 471 applications and FRNs from USAC Open Data

## Data Model

| Table | Purpose |
|-------|---------|
| `applications` | FCC Form 471 applications (app number, BEN, funding year, status, dates) |
| `frns` | Funding Request Numbers linked to each application |
| `status_history` | Timeline of status changes for applications and FRNs |

### Application Statuses

`draft` → `certified` → `under_review` → `fcdl_issued` / `denied` / `cancelled` / `partially_funded`

### FRN Statuses

`pending` → `under_review` → `committed` / `denied` / `cancelled` / `partially_funded`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check + DB connectivity |
| GET | `/api/dashboard/stats` | Dashboard aggregates |
| GET/POST | `/api/applications` | List / create applications |
| GET/PUT/DELETE | `/api/applications/:id` | Read / update / delete |
| GET/POST | `/api/frns` | List / create FRNs |
| GET/PUT/DELETE | `/api/frns/:id` | Read / update / delete |
| POST | `/api/import/usac` | Import California data from USAC Open Data |
| GET | `/api/import/usac/status` | Check if import is running |

## Configuration

Copy `.env.example` to `.env` and adjust:

```
PORT=3000
DATABASE_URL=postgresql://erate:erate_secret@localhost:5432/erate_471
```

Docker-specific environment variables (set in `docker-compose.yml`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTO_IMPORT_USAC` | `true` | Import CA data on first startup |
| `USAC_IMPORT_STATE` | `CA` | State filter |
| `USAC_IMPORT_INCLUDE_PENDING` | `true` | Include Original-version pending FRNs |
| `FORCE_USAC_IMPORT` | — | Set `true` to re-import even if data exists |

## Without Docker

Install PostgreSQL locally, create a database named `erate_471`, update `DATABASE_URL` in `.env`, then run `npm run db:init` and `npm run db:seed`.