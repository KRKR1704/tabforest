"""Engine metrics through the OpenTelemetry API (BUILD_TASKS.md §4.8).

P's main.py configures the Azure Monitor distro; without it the global meter provider is a no-op,
so these calls do nothing. Attributes never carry titles or page text.
"""

from __future__ import annotations

from opentelemetry import metrics

_meter = metrics.get_meter("tabforest.engine")
grow_latency_ms = _meter.create_histogram("grow_latency_ms", unit="ms", description="Grow run latency")
claims_downgraded = _meter.create_counter("claims_downgraded", description="Claims downgraded by the validator")
fallback_used = _meter.create_counter("fallback_used", description="Clusters rendered without a model result")
validation_failures = _meter.create_counter("validation_failures", description="Invalid model outputs")


def record_grow(latency_ms: int, downgraded: int, fallbacks: int, failures: int) -> None:
    grow_latency_ms.record(latency_ms)
    claims_downgraded.add(downgraded)
    fallback_used.add(fallbacks)
    validation_failures.add(failures)
