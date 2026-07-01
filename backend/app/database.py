"""SQLAlchemy engine, session factory, and FastAPI DB dependency."""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def get_db():
    """Yield a per-request database session; always closed after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()