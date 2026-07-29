# devscope (Python)

Python SDK bridge for sending OpenTelemetry-style spans to a local DevScope instance.

## Install (editable)

```bash
pip install -e ./packages/devscope-python
```

## Quick start

```python
from devscope import DevScopeClient

client = DevScopeClient(
    ingest_url="http://localhost:4318/api/ingest/otel",
    service_name="python-checkout-service",
)

with client.span(
    "http.checkout",
    attributes={"http.method": "GET", "http.route": "/py-checkout", "http.status_code": 200},
):
    with client.span(
        "sql.select",
        attributes={"db.system": "postgresql", "db.statement": "SELECT 1"},
    ):
        pass
```
