"""Application settings loaded from environment variables and .env."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database URL must be set at runtime via environment or .env
    # No default to ensure explicit configuration in production
    database_url: str
    
    # Optional API key for authentication
    # If set, X-API-Key header is required on all API requests
    api_key: str | None = None
    
    # CORS origins for development/testing
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # Search multiple paths so settings work from backend/ or project root
    model_config = {"env_file": ("../.env", "../../.env", ".env"), "extra": "ignore"}


settings = Settings()