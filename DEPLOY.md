# Production Deployment Guide

This guide explains how to deploy the e-Rate 471 Tracker using Docker Compose with publicly published images from Docker Hub.

## Quick Start

### 1. Prerequisites
- Docker Engine 20.10+
- Docker Compose 2.0+
- A PostgreSQL database (local or managed service like Azure Database for PostgreSQL)

### 2. Environment Setup

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` with your production values:

```bash
# Required: PostgreSQL connection string
DATABASE_URL=postgresql://erate_user:password123@db.example.com:5432/erate_471

# Optional: Strong API key for X-API-Key authentication
API_KEY=sk-prod-abc123xyz789def456ghi789jkl012mno

# Optional: Allowed CORS origins
CORS_ORIGINS=https://erate.example.com,https://www.erate.example.com

# Only for initial import of USAC data (first deployment)
AUTO_IMPORT_USAC=false
```

### 3. Start Services

```bash
# Start all services in background
docker compose -f docker-compose-prod.yml up -d

# Wait for initialization (API import takes 10-15 minutes on first run)
# Monitor progress:
docker compose -f docker-compose-prod.yml logs -f api

# Expected output after ~15 minutes:
# "INFO:     Uvicorn running on http://0.0.0.0:8000"
```

### 4. Verify Deployment

```bash
# Check all services are running
docker compose -f docker-compose-prod.yml ps

# Test API health
curl http://localhost:8000/api/health

# Test readiness (should be 200 after import completes)
curl http://localhost:8000/api/health/ready

# Access frontend
open http://localhost:3000

# If browser cache is stale after redeploy, use a cache-busting URL
open "http://localhost:3000/?v=$(date +%s)"
```

Frontend cache behavior note:
- Static assets (`.js/.css`) are immutable and versioned.
- SPA shell (`index.html`) is served with no-cache headers.
- The app includes a one-time fallback reload if loading appears stuck.

## Database Options

### Option A: Local PostgreSQL (Included in docker-compose-prod.yml)

Uses the PostgreSQL container defined in the compose file. Data persists in the `erate-db-data` volume.

**Pros:** Simple, self-contained, no external dependencies  
**Cons:** Limited scalability, no managed backups  
**Best for:** Development, testing, small deployments

### Option B: Managed Database (Recommended for Production)

Use Azure Database for PostgreSQL, AWS RDS, Google Cloud SQL, or similar:

```bash
# 1. Remove the 'db' service from docker-compose-prod.yml (or don't use it)
# 2. Set DATABASE_URL to your managed database connection string:
DATABASE_URL=postgresql://dbadmin:p@ssw0rd@mydb.postgres.database.azure.com:5432/erate_471

# 3. Update API service to remove 'depends_on: db'
# 4. Start services:
docker compose -f docker-compose-prod.yml up -d api frontend
```

**Pros:** Scalable, automated backups, managed by cloud provider, no maintenance  
**Cons:** Additional cost, requires network/firewall configuration  
**Best for:** Production deployments, high availability requirements

## API Authentication

### Disable Authentication (Development)

Leave `API_KEY=""` in your `.env` file.

```bash
API_KEY=
```

All API requests work without authentication.

### Enable Authentication (Production)

Set a strong API key in `.env`:

```bash
API_KEY=sk-prod-abc123xyz789def456ghi789jkl012mno
```

Clients must include the header in all API requests:

```bash
curl -H "X-API-Key: sk-prod-abc123xyz789def456ghi789jkl012mno" \
  http://localhost:8000/api/applications
```

## Live 471 Status Check (USAC)

The Application search flow supports an optional live status refresh from USAC Open Data for exact Form 471 number lookups.

Example:

```bash
curl "http://localhost:8000/api/applications?search=181035670&live_status_check=true"
```

Operational notes:
- Use `live_status_check=true` for exact Form 471 number searches to avoid unnecessary external API calls.
- If USAC returns a newer status, the local application record is updated and status history is appended.
- If USAC is unavailable or rate-limited, the API falls back to local data and still returns search results.

## HTTPS/TLS Configuration

For production, always use HTTPS. Place this deployment behind a reverse proxy:

### nginx Example

```nginx
upstream api {
  server localhost:8000;
}

upstream frontend {
  server localhost:3000;
}

server {
  listen 443 ssl http2;
  server_name erate.example.com;

  ssl_certificate /etc/ssl/certs/erate.crt;
  ssl_certificate_key /etc/ssl/private/erate.key;

  # Frontend
  location / {
    proxy_pass http://frontend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # API Proxy
  location /api {
    proxy_pass http://api;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
  }
}

# Redirect HTTP to HTTPS
server {
  listen 80;
  server_name erate.example.com;
  return 301 https://$server_name$request_uri;
}
```

### Caddy Example

```caddyfile
erate.example.com {
  reverse_proxy localhost:3000
}

api.erate.example.com {
  reverse_proxy localhost:8000
}
```

## Monitoring & Logs

### View Container Logs

```bash
# Tail API logs
docker compose -f docker-compose-prod.yml logs -f api

# Tail Frontend logs
docker compose -f docker-compose-prod.yml logs -f frontend

# Tail Database logs
docker compose -f docker-compose-prod.yml logs -f db

# View last 100 lines
docker compose -f docker-compose-prod.yml logs --tail 100 api
```

### Container Health

```bash
# Check service status
docker compose -f docker-compose-prod.yml ps

# Inspect specific service
docker inspect erate-api-prod | jq '.[0].State.Health'
```

## Backup & Restore

### Backup Database

```bash
# Create backup from running container
docker exec erate-db-prod pg_dump -U erate_user erate_471 > backup.sql

# Compress backup
gzip backup.sql
```

### Restore Database

```bash
# Stop services
docker compose -f docker-compose-prod.yml down

# Clear data volume
docker volume rm erate-db-data

# Start database
docker compose -f docker-compose-prod.yml up -d db

# Wait for db to be ready
sleep 10

# Restore backup
gunzip -c backup.sql.gz | docker exec -i erate-db-prod psql -U erate_user -d erate_471

# Start other services
docker compose -f docker-compose-prod.yml up -d api frontend
```

## Maintenance

### Update Images

```bash
# Pull latest versions
docker pull yingyuwang/erate-471-tracker-api:latest
docker pull yingyuwang/erate-471-tracker-frontend:latest

# Restart services (they'll use new images)
docker compose -f docker-compose-prod.yml up -d
```

### View Disk Usage

```bash
# Check Docker disk space
docker system df

# Remove unused images/volumes
docker system prune -a --volumes
```

### Resource Monitoring

```bash
# Monitor container resources
docker stats

# Adjust resource limits in docker-compose-prod.yml under deploy.resources
```

## Troubleshooting

### API Import Stuck

```bash
# The API performs a 10-15 minute data import on first startup
# Watch the logs:
docker compose -f docker-compose-prod.yml logs -f api

# If stuck for >30 minutes, check database connectivity:
docker exec erate-api-prod curl -v postgresql://erate_user@db:5432/erate_471
```

### Frontend Can't Connect to API

```bash
# Check API is healthy
curl http://localhost:8000/api/health

# Check frontend nginx logs
docker compose -f docker-compose-prod.yml logs frontend

# Verify CORS_ORIGINS in .env includes frontend URL
```

### Database Connection Failed

```bash
# Test connection string
docker exec erate-db-prod psql "$DATABASE_URL" -c "SELECT version();"

# For external database, verify:
# - Host/port is accessible from container
# - Firewall allows connection
# - Username/password are correct
# - Database exists
```

### Stop & Clean Up

```bash
# Stop services (keeps data)
docker compose -f docker-compose-prod.yml stop

# Restart services
docker compose -f docker-compose-prod.yml start

# Remove services (keeps data)
docker compose -f docker-compose-prod.yml down

# Full cleanup (deletes data)
docker compose -f docker-compose-prod.yml down -v
```

## Security Checklist

- [ ] Use strong API_KEY (32+ characters, random)
- [ ] Enable HTTPS/TLS on reverse proxy
- [ ] Restrict database access to containers
- [ ] Set strong database password
- [ ] Enable backups for database volume
- [ ] Use environment variables for all secrets (never hardcode)
- [ ] Review and limit CORS_ORIGINS
- [ ] Enable container health checks (already configured)
- [ ] Monitor logs for errors/anomalies
- [ ] Keep Docker images updated
- [ ] Use read-only filesystem where possible
- [ ] Implement network policies/security groups

## Support

For issues or questions:
- Check logs: `docker compose -f docker-compose-prod.yml logs -f`
- Review README.md in repository
- Open issue on GitHub: https://github.com/yingyu-wang/erate-471-tracker
