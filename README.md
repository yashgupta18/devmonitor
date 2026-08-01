# devtracekit

devtracekit is a local-first observability toolkit for backend development.

It lets you run a sample service and immediately inspect:
- Request traces
- Downstream SQL/Redis/Kafka/job events
- Service dependency graph
- Local connector status (Docker, Kubernetes, ECS, Nomad)
- AI-style rule-based insights
- GitHub incident intelligence (heuristic commit correlation)

## Requirements

- Node.js 18+
- npm 9+
- Optional tools for connector panels:
  - Docker CLI and daemon
  - kubectl and configured context
  - AWS CLI (for ECS)
  - Nomad CLI

## Contributing Policy

Pull request titles must start with a conventional tag:

- `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `test:`, `chore:`, `build:`, or `ci:`
- Use `feat!:` for breaking changes and include `BREAKING CHANGE:` details in the PR body

See the full contribution policy in [CONTRIBUTING.md](CONTRIBUTING.md).

## Quick Start

For end users (global CLI):

```bash
npm install -g devtracekit
devtracekit start
```

For local development:

1. Install dependencies:

```bash
npm install
```

2. Run tests:

```bash
npm test
```

3. Start devtracekit with the example app:

```bash
npm run devtracekit:start -- --example
```

4. Open:

- Dashboard: http://localhost:4318
- Example API: http://localhost:3000

5. Generate traffic:

```bash
curl http://localhost:3000/checkout
curl "http://localhost:3000/load?requests=10"
curl http://localhost:3000/otel-checkout
```

## Mini End-to-End Example App

Run a compact scenario app that exercises federation, GitOps, canary risk, cost/capacity, and postmortem/replay in one flow:

```bash
npm run example:mini
curl -X POST http://localhost:3050/scenario/full
```

See full setup and verification steps in `MINI_EXAMPLE_APP.md`.

## If Port 4318 Is Busy

Run on alternate ports:

```bash
DEVTRACEKIT_DASHBOARD_PORT=4328 DEVTRACEKIT_APP_PORT=3010 npm run devtracekit:start -- --example
```

Then open:
- Dashboard: http://localhost:4328
- Example API: http://localhost:3010

## Python Example

1. Create a virtualenv:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ./packages/devtracekit-python
```

2. Point Python client to devtracekit ingest endpoint:

```bash
export DEVTRACEKIT_INGEST_URL=http://localhost:4328/api/ingest/otel
python ./examples/python-otel-example.py
```

## Dashboard Features

- Live traces with endpoint/status/method filters
- Cross-service query filters (service, cluster/datacenter, namespace, environment)
- Trace timeline details
- Service dependency graph
- Connector health panels
- Connector telemetry snapshots and collector ingestion
- Cross-service incident correlation from trace/span relationships
- SLO burn-rate panel (`GET /api/slo`)
- Time-series bucket query (`GET /api/timeseries`)
- Federation panel for multi-cluster/multi-region traces (`GET /api/federation`)
- GitOps change-event correlation panel (`POST /api/gitops/events`, `GET /api/gitops/correlations`)
- Deployment risk scoring and canary regression panel (`GET /api/deployments/risk`)
- Cost observability and capacity insights panel (`GET /api/cost-capacity`)
- Incident postmortem export and timeline replay (`GET /api/incidents/postmortem`, `GET /api/incidents/replay`)
- RBAC/authn with API keys plus audit logs (`GET /api/audit`)
- Alert hooks for Slack/PagerDuty/webhooks (`POST /api/alerts/test`)
- HA cluster heartbeat/status (`POST /api/cluster/heartbeat`, `GET /api/cluster/status`)
- AI Explanations panel (`GET /api/insights`)
- GitHub Incident Intelligence panel (`POST /api/intelligence/github`)

## API Endpoints

- `GET /healthz`
- `GET /api/traces`
- `GET /api/traces/:traceId`
- `POST /api/ingest/otel`
- `POST /api/remote/ingest/otel` (API key protected)
- `GET /api/tenants`
- `GET /api/services`
- `GET /api/graph`
- `GET /api/insights`
- `GET /api/federation`
- `POST /api/gitops/events`
- `GET /api/gitops/events`
- `GET /api/gitops/correlations`
- `GET /api/deployments/risk`
- `GET /api/cost-capacity`
- `GET /api/incidents/postmortem`
- `GET /api/incidents/replay`
- `GET /api/timeseries`
- `GET /api/slo`
- `GET /api/audit` (admin)
- `POST /api/alerts/test` (admin)
- `POST /api/cluster/heartbeat`
- `GET /api/cluster/status`
- `POST /api/incidents/correlate`
- `POST /api/intelligence/github`
- `GET /api/connectors/docker`
- `GET /api/connectors/kubernetes`
- `GET /api/connectors/ecs`
- `GET /api/connectors/nomad`
- `GET /api/connectors/:connector/telemetry`
- `POST /api/connectors/collect`

## CLI

Global install command:

```bash
devtracekit start
```

Local development command:

```bash
npm run devtracekit:start
```

Local development with sample app:

```bash
npm run devtracekit:start -- --example
```

Enable secure remote ingest (example):

```bash
DEVTRACEKIT_REMOTE_INGEST_KEYS=team-key-1,team-key-2 \
DEVTRACEKIT_REMOTE_RATE_LIMIT_MAX_REQUESTS=120 \
DEVTRACEKIT_REMOTE_RATE_LIMIT_WINDOW_MS=60000 \
DEVTRACEKIT_REMOTE_MAX_SPANS_PER_REQUEST=500 \
npm run devtracekit:start
```

Send remote spans with API key:

```bash
curl -X POST http://localhost:4318/api/remote/ingest/otel \
  -H "content-type: application/json" \
  -H "x-devtracekit-api-key: team-key-1" \
  -d '{"serviceName":"orders-service","spans":[{"traceId":"abc","spanId":"def","name":"http.request"}]}'
```

Attach tenant/project/environment context to ingest calls:

```bash
curl -X POST http://localhost:4318/api/ingest/otel \
  -H "content-type: application/json" \
  -H "x-devtracekit-tenant-id: team-red" \
  -H "x-devtracekit-project-id: checkout" \
  -H "x-devtracekit-environment: prod" \
  -d '{"serviceName":"checkout-service","span":{"traceId":"scope-1","spanId":"scope-1a","name":"http.request"}}'
```

Filter traces by scope:

```bash
curl "http://localhost:4318/api/traces?tenantId=team-red&projectId=checkout&environment=prod"
```

Cross-service trace filtering example:

```bash
curl "http://localhost:4318/api/traces?service=payments-service&cluster=prod-east&namespace=payments&environment=prod"
```

List tenant/project registry summary:

```bash
curl "http://localhost:4318/api/tenants"
```

List discovered services grouped by environment:

```bash
curl "http://localhost:4318/api/services"
```

Filter service registry by scope:

```bash
curl "http://localhost:4318/api/services?tenantId=team-red&projectId=checkout&environment=prod"
```

Fetch connector telemetry snapshot (normalized signals):

```bash
curl "http://localhost:4318/api/connectors/docker/telemetry"
```

Kubernetes telemetry now includes:
- Pod health and restart/ready counts
- Service inventory metadata (type, ports, external targets)
- Deployment rollout metadata (desired/updated/available replicas)
- Pod resource metrics when `kubectl top` is available
- Sampled pod log summaries (warning/error line counts)

Docker telemetry now includes:
- Container lifecycle metadata (state, ports, uptime, image, networks, mounts)
- Container resource metrics from `docker stats` (CPU, memory, network/block I/O, pids)
- Sampled container log summaries (warning/error line counts)

ECS telemetry now includes:
- Cluster capacity and task counts
- Service desired/running/pending counts and scheduling metadata
- Task runtime state and launch metadata
- Deployment rollout state per service deployment
- Service event summaries for incident context

Nomad telemetry now includes:
- Job state and scheduling metadata
- Allocation runtime state and desired status
- Deployment status snapshots per job
- Deployment-event style status descriptions for rollout context

Collect connector telemetry into trace events:

```bash
curl -X POST http://localhost:4318/api/connectors/collect \
  -H "content-type: application/json" \
  -H "x-devtracekit-tenant-id: team-ops" \
  -H "x-devtracekit-project-id: platform" \
  -H "x-devtracekit-environment: prod" \
  -d '{"connector":"docker","serviceName":"ops-collector"}'
```

Correlate an incident across services:

```bash
curl -X POST http://localhost:4318/api/incidents/correlate \
  -H "content-type: application/json" \
  -H "x-devtracekit-tenant-id: team-ops" \
  -H "x-devtracekit-project-id: platform" \
  -H "x-devtracekit-environment: prod" \
  -d '{"incident":"checkout failures","limit":400}'
```

Correlate and notify alert hooks:

```bash
curl -X POST http://localhost:4318/api/incidents/correlate \
  -H "content-type: application/json" \
  -d '{"incident":"checkout failures","limit":400,"notify":true,"alertChannel":"webhook"}'
```

Query SLO burn-rate view:

```bash
curl "http://localhost:4318/api/slo?windowMinutes=60&shortWindowMinutes=5&objectiveAvailability=99.9&objectiveP95Ms=400"
```

Query time-series buckets:

```bash
curl "http://localhost:4318/api/timeseries?windowMinutes=60&environment=prod"
```

Set default scope for local app traces:

```bash
DEVTRACEKIT_TENANT_ID=team-red \
DEVTRACEKIT_PROJECT_ID=checkout \
DEVTRACEKIT_ENVIRONMENT=dev \
npm run devtracekit:start -- --example
```

Enable file-backed trace store + auth + alerting + HA mode:

```bash
DEVTRACEKIT_STORAGE_BACKEND=file \
DEVTRACEKIT_TRACE_STORE_PATH=.devtracekit/traces.ndjson \
DEVTRACEKIT_TIMESERIES_RETENTION_MINUTES=10080 \
DEVTRACEKIT_AUTH_ENABLED=true \
DEVTRACEKIT_API_KEYS=viewer:viewer-key,editor:editor-key,admin:admin-key \
DEVTRACEKIT_ALERTING_ENABLED=true \
DEVTRACEKIT_WEBHOOK_URL=https://your-alert-endpoint.example/hooks/devtracekit \
DEVTRACEKIT_CLUSTER_ENABLED=true \
DEVTRACEKIT_DEPLOYMENT_MODE=ha \
npm run devtracekit:start
```

Production onboarding guide:
- `PRODUCTION_CONNECTORS_SECURITY.md`

## Publishing (Maintainers)

Release steps:

1. Verify package payload:

```bash
npm pack --dry-run
```

2. Run tests:

```bash
npm test
```

3. Publish:

```bash
npm publish
```

4. Tag release:

```bash
git tag v0.1.1
git push origin v0.1.1
```

Packaging note:
- Root package publishing is restricted via `files` in `package.json` to runtime assets (`src/`, `public/`, `README.md`, `LICENSE`).

## Project Docs

- Plan: `DEVTRACEKIT_MVP_PLAN.md`
- Task tracker: `TASKS.md`
- Test/validation guide: `TESTING.md`
- Production architecture: `PRODUCTION_ARCHITECTURE.md`
- Mini E2E example app guide: `MINI_EXAMPLE_APP.md`
- npm release and autopublish guide: `NPM_RELEASE_AUTOPUBLISH.md`
