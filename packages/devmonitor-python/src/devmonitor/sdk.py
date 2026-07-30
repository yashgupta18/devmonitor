from __future__ import annotations

import contextlib
import json
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Dict, Iterator, Optional


@dataclass
class SpanContext:
    trace_id: str
    span_id: str
    parent_span_id: str
    name: str
    attributes: Dict[str, object] = field(default_factory=dict)


class DevMonitorClient:
    def __init__(
        self,
        ingest_url: str = "http://localhost:4318/api/ingest/otel",
        service_name: str = "python-service",
        timeout_seconds: float = 2.0,
    ) -> None:
        self.ingest_url = ingest_url
        self.service_name = service_name
        self.timeout_seconds = timeout_seconds

    @contextlib.contextmanager
    def span(
        self,
        name: str,
        *,
        trace_id: Optional[str] = None,
        parent_span_id: str = "",
        attributes: Optional[Dict[str, object]] = None,
    ) -> Iterator[SpanContext]:
        current_trace_id = trace_id or self._new_trace_id()
        span_ctx = SpanContext(
            trace_id=current_trace_id,
            span_id=self._new_span_id(),
            parent_span_id=parent_span_id,
            name=name,
            attributes=dict(attributes or {}),
        )

        start_time_ns = time.time_ns()
        status = "ok"

        try:
            yield span_ctx
        except Exception as exc:
            status = "error"
            span_ctx.attributes["exception.message"] = str(exc)
            raise
        finally:
            payload = {
                "traceId": span_ctx.trace_id,
                "spanId": span_ctx.span_id,
                "parentSpanId": span_ctx.parent_span_id,
                "name": span_ctx.name,
                "status": status,
                "statusCode": 2 if status == "error" else 1,
                "attributes": span_ctx.attributes,
                "startTimeUnixNano": start_time_ns,
                "endTimeUnixNano": time.time_ns(),
            }
            self.ingest_span(payload)

    def ingest_span(self, span_data: Dict[str, object]) -> None:
        self.ingest_spans([span_data])

    def ingest_spans(self, spans: list[Dict[str, object]]) -> None:
        body = {
            "serviceName": self.service_name,
            "spans": spans,
        }
        request = urllib.request.Request(
            self.ingest_url,
            method="POST",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )

        try:
            with urllib.request.urlopen(
                request, timeout=self.timeout_seconds
            ) as response:
                if response.status >= 300:
                    raise RuntimeError(
                        f"DevMonitor ingest failed with status {response.status} at {self.ingest_url}"
                    )
        except urllib.error.HTTPError as exc:
            raise RuntimeError(
                f"DevMonitor ingest HTTP error {exc.code} for {self.ingest_url}. "
                "Check that DevMonitor is running on the same port and supports /api/ingest/otel."
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"DevMonitor ingest connection error for {self.ingest_url}: {exc.reason}. "
                "Start DevMonitor or update DEVMONITOR_INGEST_URL."
            ) from exc

    def _new_trace_id(self) -> str:
        return uuid.uuid4().hex + uuid.uuid4().hex

    def _new_span_id(self) -> str:
        return uuid.uuid4().hex[:16]
