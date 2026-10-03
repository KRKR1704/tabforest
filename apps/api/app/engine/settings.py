"""Engine settings, read from apps/api/.env.

Only the keys the engine uses are declared; everything else in the file (P's ENTRA_*,
API_BASE_URL, ...) is ignored. Secrets are SecretStr, so they never appear in reprs or logs.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class EngineSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    azure_openai_endpoint: str | None = None
    azure_openai_api_key: SecretStr | None = None
    azure_openai_chat_deployment: str = "chat"
    azure_openai_embed_deployment: str = "embed"
    azure_openai_api_version: str = "2024-10-21"
    database_url: SecretStr | None = None
    auth_mode: Literal["dev", "prod"] = "prod"

    @property
    def aoai_configured(self) -> bool:
        return bool(self.azure_openai_endpoint and self.azure_openai_api_key)

    @property
    def db_configured(self) -> bool:
        return self.database_url is not None and bool(self.database_url.get_secret_value())


@lru_cache
def get_settings() -> EngineSettings:
    return EngineSettings()
