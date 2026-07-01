"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import Base, engine
from app.import_state import is_importing, get_import_error
from app.routers import applications, sync

# Create tables on startup (MVP — no migrations yet)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="E-Rate 471 Tracker",
    description="Track USAC FCC Form 471 application status",
    version="0.1.0",
)

# Allow the React dev server (and preview) to call the API
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(applications.router)
app.include_router(sync.router)


@app.get("/api/health")
def health():
    """Liveness probe for Docker and load balancers."""
    return {"status": "ok"}


@app.get("/api/health/ready")
def health_ready():
    """Readiness probe — returns 503 while USAC import is in progress."""
    if is_importing():
        error = get_import_error()
        if error:
            return JSONResponse(
                status_code=503,
                content={"status": "importing", "error": error}
            )
        return JSONResponse(
            status_code=503,
            content={"status": "importing", "message": "Initializing USAC data..."}
        )
    return {"status": "ready"}