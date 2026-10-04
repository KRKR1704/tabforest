"""Azure Monitor OpenTelemetry distro (§4.8). A no-op when APPLICATIONINSIGHTS_CONNECTION_STRING is unset.

Logs exported are those of the "tabforest" logger tree (P's and R's "tabforest.engine"). Nothing in
this app logs titles or page text (SPEC §12).
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from pydantic import SecretStr

log = logging.getLogger("tabforest.telemetry")
_configured = False


def setup_telemetry(connection_string: SecretStr | None) -> bool:
    """Configure the distro once per process. Returns True when telemetry is on."""
    global _configured
    value = connection_string.get_secret_value().strip() if connection_string else ""
    if not value:
        log.info("Application Insights not configured; telemetry is off")
        return False
    if _configured:
        return True
    try:
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor(connection_string=value, logger_name="tabforest")
    except Exception as exc:  # noqa: BLE001 - telemetry must never stop the API
        log.warning("Application Insights setup failed: %s", type(exc).__name__)
        return False
    _configured = True
    log.info("Application Insights configured")
    return True


def instrument(app: FastAPI) -> None:
    """Request telemetry for this app instance (the class-level patch misses apps built from main.py)."""
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    if not getattr(app, "_is_instrumented_by_opentelemetry", False):
        FastAPIInstrumentor.instrument_app(app, excluded_urls="health")
