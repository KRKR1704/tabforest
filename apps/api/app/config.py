"""Settings for P's app, read from the environment or apps/api/.env (SPEC §14.1).

Required: DATABASE_URL, ALLOWED_EXTENSION_ORIGIN, ENTRA_CLIENT_ID. If one is missing or invalid,
startup stops with a message that names the variable, never its value. Secrets are SecretStr, so
they stay out of reprs and logs.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Literal
from urllib.parse import parse_qs, urlsplit

from pydantic import SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
MULTI_TENANT = {"common", "organizations", "consumers"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    database_url: SecretStr
    allowed_extension_origin: str
    entra_client_id: str
    entra_tenant: str = "common"
    # v2 access tokens always carry the API's client ID in aud (X13), so the client ID is the default.
    entra_api_audience: str | None = None
    auth_mode: Literal["prod", "dev"] = "prod"
    applicationinsights_connection_string: SecretStr | None = None

    # Fallback login (SPEC §11.1): off unless Entra is cut at D-6.
    fallback_login: bool = False
    jwt_secret: SecretStr | None = None
    fallback_accounts: SecretStr | None = None  # JSON object: {"email": "$argon2id$..."}

    # R's keys. R's engine reads them through its own settings; listed so one .env serves both lanes.
    azure_openai_endpoint: str | None = None
    azure_openai_api_key: SecretStr | None = None
    azure_openai_chat_deployment: str | None = None
    azure_openai_embed_deployment: str | None = None

    @field_validator("allowed_extension_origin")
    @classmethod
    def _extension_origin(cls, value: str) -> str:
        """One or more extension origins, comma-separated: the development ID and the Chrome Web Store ID differ."""
        origins: list[str] = []
        for item in value.split(","):
            item = item.strip().rstrip("/")
            if not re.fullmatch(r"chrome-extension://[a-p]{32}", item):
                raise ValueError("each item must be chrome-extension://<32-letter extension id>, separated by commas")
            if item not in origins:
                origins.append(item)
        return ",".join(origins)

    @property
    def allowed_extension_origins(self) -> list[str]:
        return self.allowed_extension_origin.split(",")

    @model_validator(mode="after")
    def _database_uses_tls(self) -> Settings:
        """A remote database must be reached over TLS (SPEC 12): sslmode=require or stronger."""
        url = urlsplit(self.database_url.get_secret_value())
        if url.hostname not in {"localhost", "127.0.0.1", "::1"}:
            mode = parse_qs(url.query).get("sslmode", [""])[0]
            if mode not in {"require", "verify-ca", "verify-full"}:
                raise ValueError("DATABASE_URL for a remote database needs sslmode=require")
        return self

    @model_validator(mode="after")
    def _fallback_needs_secret_and_accounts(self) -> Settings:
        if self.fallback_login:
            if self.jwt_secret is None or len(self.jwt_secret.get_secret_value()) < 32:
                raise ValueError("FALLBACK_LOGIN=true needs JWT_SECRET with at least 32 characters")
            if not self.fallback_account_hashes():
                raise ValueError("FALLBACK_LOGIN=true needs FALLBACK_ACCOUNTS")
        return self

    @property
    def audience(self) -> str:
        return self.entra_api_audience or self.entra_client_id

    def fallback_account_hashes(self) -> dict[str, str]:
        """FALLBACK_ACCOUNTS as {lowercased email: argon2id hash}."""
        if self.fallback_accounts is None:
            return {}
        try:
            data = json.loads(self.fallback_accounts.get_secret_value())
        except json.JSONDecodeError as exc:
            raise ValueError("FALLBACK_ACCOUNTS must be a JSON object") from exc
        if not isinstance(data, dict) or not all(
            isinstance(k, str) and isinstance(v, str) and v.startswith("$argon2id$") for k, v in data.items()
        ):
            raise ValueError("FALLBACK_ACCOUNTS must map emails to argon2id hashes")
        return {k.strip().lower(): v for k, v in data.items()}


class SettingsError(RuntimeError):
    """Startup configuration error. The message names variables, never values."""


def load_settings(**overrides: Any) -> Settings:
    try:
        return Settings(**overrides)
    except ValidationError as exc:
        problems = []
        for err in exc.errors():
            name = ".".join(str(part) for part in err["loc"]).upper() or "SETTINGS"
            problems.append(f"{name} is missing" if err["type"] == "missing" else f"{name}: {err['msg']}")
        message = "; ".join(problems)
        raise SettingsError(f"Invalid API settings (apps/api/.env or App Service settings): {message}") from None
