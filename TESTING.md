## Testing Guide

This file explains what is implemented now, how to run it, and how to verify features.

## Implemented Features (Current)
1. `devscope start` command.
2. Local dashboard at `http://localhost:4318`.
3. Live request list with per-request durations.
4. Per-request timeline for simulated downstream activity:
- SQL queries
- Redis commands
- Kafka publish events
- Background job events
5. Example app route for generating traces quickly.
6. Node OpenTelemetry bridge (`@devscope/sdk`) with span ingestion.
7. OTel demo endpoint with parent-child span correlation (`/otel-checkout`).

## Setup
1. Install dependencies:

```bash
npm install
```

2. Run automated tests:

```bash
npm test
```

3. Start DevScope with the sample app:

```bash
npm run devscope:start -- --example
```

If port `4318` is already in use, run DevScope on alternate ports:

```bash
DEVSCOPE_DASHBOARD_PORT=4328 DEVSCOPE_APP_PORT=3010 npm run devscope:start -- --example
```

4. Open the dashboard:
- `http://localhost:4318`

5. Trigger sample traffic in another terminal:

```bash
curl http://localhost:3000/checkout
curl "http://localhost:3000/load?requests=10"
curl http://localhost:3000/otel-checkout
```

6. Optional: Validate Python SDK ingestion:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ./packages/devscope-python
export DEVSCOPE_INGEST_URL=http://localhost:4328/api/ingest/otel
python ./examples/python-otel-example.py
```

## What You Should See
1. New requests appear in the dashboard table.
2. Clicking a request opens a timeline panel.
3. Timeline includes events labeled `SQL`, `REDIS`, `KAFKA`, and `JOB`.
4. `x-devscope-trace-id` response header is present on API responses.
5. OTel route generates a single trace with multiple related span events.
6. Use dashboard filters to inspect OTel trace data:
- Method filter: `OTEL` (or `GET` after root-span enrichment)
- Endpoint filter: `/otel-checkout`
7. Python SDK route appears via endpoint filter `/py-checkout`.
8. Docker connector panel displays either:
- running containers summary, or
- a clear unavailable message if Docker is not installed/running.
9. Kubernetes/ECS/Nomad connector panels display either discovered resources or clear unavailable messages.
10. AI Explanations panel displays insight cards when slow/error/repeated query patterns exist.
11. GitHub Incident Intelligence panel returns ranked suspect commits from recent git history.

## Quick Verification Checklist
- [ ] Dashboard loads successfully.
- [ ] Requests appear within 2 seconds after sending traffic.
- [ ] Timeline displays multiple downstream events.
- [ ] No process crash during repeated `/load` runs.
- [ ] Docker connector endpoint responds: `GET /api/connectors/docker`.
- [ ] Kubernetes connector endpoint responds: `GET /api/connectors/kubernetes`.
- [ ] ECS connector endpoint responds: `GET /api/connectors/ecs`.
- [ ] Nomad connector endpoint responds: `GET /api/connectors/nomad`.
- [ ] AI insights endpoint responds: `GET /api/insights`.
- [ ] GitHub intelligence endpoint responds: `POST /api/intelligence/github`.

## Current Limitations
1. SQL/Redis/Kafka/Job events are simulated in the example app, not real drivers yet.
2. No persistent storage yet (in-memory retention only).
3. Python SDK currently sends spans over DevScope HTTP ingest API (not OTLP exporter yet).
4. GitHub intelligence uses local git commit metadata + heuristic keyword scoring (no direct GitHub API integration yet).

## Included Automated Tests
File: `tests/devscope-core.test.js`
1. trace creation and completion,
2. retention enforcement,
3. SQL and Redis event correlation.
4. OpenTelemetry span mapping and shared trace correlation.
5. AI insight rules for slow endpoints, error rates, and repeated SQL patterns.

File: `tests/github-intelligence.test.js`
1. git log parser behavior,
2. commit scoring heuristic,
3. graceful failure behavior when git metadata is unavailable.
