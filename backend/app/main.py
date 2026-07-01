"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
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