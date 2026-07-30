#!/usr/bin/env python3
"""Send OpenTelemetry-style spans from Python into DevMonitor."""

import os

from devmonitor import DevMonitorClient


def main() -> None:
    ingest_url = os.getenv(
        "DEVMONITOR_INGEST_URL", "http://localhost:4318/api/ingest/otel"
    )
    service_name = os.getenv("DEVMONITOR_SERVICE_NAME", "python-checkout-service")

    client = DevMonitorClient(
        ingest_url=ingest_url,
        service_name=service_name,
    )

    with client.span(
        "http.checkout",
        attributes={
            "http.method": "GET",
            "http.route": "/py-checkout",
            "http.status_code": 200,
        },
    ) as root:
        with client.span(
            "redis.get",
            trace_id=root.trace_id,
            parent_span_id=root.span_id,
            attributes={
                "db.system": "redis",
                "db.operation": "GET",
                "db.redis.key": "cart:user:42",
            },
        ):
            _ = "cache-hit"

        with client.span(
            "sql.select",
            trace_id=root.trace_id,
            parent_span_id=root.span_id,
            attributes={
                "db.system": "postgresql",
                "db.statement": "SELECT id, total FROM orders WHERE user_id = $1",
            },
        ):
            _ = 1 + 1

        with client.span(
            "kafka.publish",
            trace_id=root.trace_id,
            parent_span_id=root.span_id,
            attributes={
                "messaging.system": "kafka",
                "messaging.operation": "publish",
                "messaging.destination.name": "checkout-events",
            },
        ):
            _ = {"published": True}

    print("Sent Python spans to DevMonitor. Check dashboard filters for /py-checkout")


if __name__ == "__main__":
    main()
