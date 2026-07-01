"""Application settings loaded from environment variables and .env."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://erate:erate_secret@localhost:5432/erate_471"
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # Search multiple paths so settings work from backend/ or project root
    model_config = {"env_file": ("../.env", "../../.env", ".env"), "extra": "ignore"}


settings = Settings()