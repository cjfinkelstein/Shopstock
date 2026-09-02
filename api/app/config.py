from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App configuration. All values overridable via environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "APEX Electrical Stock"
    database_url: str = "sqlite:///./shopstock.db"
    jwt_secret: str = "dev-only-secret-change-me-in-production-0000"
    jwt_algorithm: str = "HS256"
    session_hours: int = 12
    display_timezone: str = "America/New_York"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    anthropic_api_key: str = ""

    # Outbound email (estimate-sending) -- blank host means "not configured
    # yet", handled as a clear error rather than a silent no-op.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_use_tls: bool = True
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_address: str = ""
    smtp_from_name: str = "APEX Electrical Group"
    # Public origin used to build customer-facing links (e.g. estimate share
    # links) -- the API has no other way to know its own public URL. Overridden
    # to the real production domain via docker-compose.yml/.env in prod.
    public_base_url: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
