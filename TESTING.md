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

Optional: run the mini end-to-end scenario app:

```bash
npm run example:mini
curl -X POST http://localhost:3050/scenario/full
```

Detailed walkthrough: `MINI_EXAMPLE_APP.md`.

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
12. Secure remote ingest endpoint accepts valid API keys and rejects invalid ones.
13. Tenant/project/environment scope is attached to traces and available in query filters.
14. Tenant registry endpoint summarizes teams/projects/environments from observed traces.
15. Services endpoint lists discovered services grouped by environment.
16. Connector telemetry endpoint returns normalized signals per connector.
17. Connector collect endpoint converts connector signals into trace timeline events.
18. Kubernetes telemetry includes pod/service/rollout signals plus metrics and log summaries when available.
19. Docker telemetry includes lifecycle/resource/log signals.
20. ECS telemetry includes service/task/deployment/event signals.
21. Nomad telemetry includes job/allocation/deployment/deployment-event signals.
22. Incident correlation endpoint links impacted services and service relationships from traces/spans.
23. Cross-service trace filters work for service, cluster/datacenter, namespace, and environment.
24. File-backed trace store mode persists traces across process restarts.
25. SLO endpoint reports availability, p95 latency, and short/long burn rates.
26. Time-series endpoint returns minute-level request/error/latency buckets.
27. RBAC enforces viewer/editor/admin API permissions with API keys.
28. Audit endpoint returns allowed/denied security events.
29. Alert hooks send incident-context notifications through configured channels.
30. Cluster heartbeat/status endpoints expose active HA instance inventory.
31. Federation endpoint summarizes multi-cluster and multi-region traces.
32. GitOps change events can be ingested and correlated with post-deploy trace impact.
33. Deployment risk endpoint scores rollout risk and canary regressions against baseline windows.
34. Cost-capacity endpoint returns per-service cost estimates and saturation risk.
35. Incident postmortem export endpoint returns markdown timeline summary and replay frames.

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
- [ ] Remote ingest endpoint responds with auth: `POST /api/remote/ingest/otel`.
- [ ] Tenant registry endpoint responds: `GET /api/tenants`.
- [ ] Scoped trace query works: `GET /api/traces?tenantId=...&projectId=...&environment=...`.
- [ ] Service registry endpoint responds: `GET /api/services`.
- [ ] Connector telemetry endpoint responds: `GET /api/connectors/:connector/telemetry`.
- [ ] Connector collect endpoint responds: `POST /api/connectors/collect`.
- [ ] Incident correlation endpoint responds: `POST /api/incidents/correlate`.
- [ ] Cross-service query works: `GET /api/traces?service=...&cluster=...&namespace=...&environment=...`.
- [ ] SLO endpoint responds: `GET /api/slo`.
- [ ] Time-series endpoint responds: `GET /api/timeseries`.
- [ ] RBAC is enforced when auth enabled (`DEVSCOPE_AUTH_ENABLED=true`).
- [ ] Audit endpoint responds for admin key: `GET /api/audit`.
- [ ] Alert test endpoint responds for admin key: `POST /api/alerts/test`.
- [ ] Cluster endpoints respond: `POST /api/cluster/heartbeat`, `GET /api/cluster/status`.
- [ ] Federation endpoint responds: `GET /api/federation`.
- [ ] GitOps ingest/correlation endpoints respond: `POST /api/gitops/events`, `GET /api/gitops/correlations`.
- [ ] Deployment risk endpoint responds: `GET /api/deployments/risk`.
- [ ] Cost/capacity endpoint responds: `GET /api/cost-capacity`.
- [ ] Postmortem/replay endpoints respond: `GET /api/incidents/postmortem`, `GET /api/incidents/replay`.

## Current Limitations
1. SQL/Redis/Kafka/Job events are simulated in the example app, not real drivers yet.
2. No persistent storage yet (in-memory retention only).
3. Python SDK currently sends spans over DevScope HTTP ingest API (not OTLP exporter yet).
4. GitHub intelligence uses local git commit metadata + heuristic keyword scoring (no direct GitHub API integration yet).
5. Remote ingest rate limiting is currently in-memory per API key + source IP.
6. Tenant/project registry is inferred from retained in-memory traces.
7. Service registry is inferred from retained traces and event-derived dependencies.
8. Kubernetes and Docker metrics/log sampling is best-effort and may return warnings when tools or permissions are unavailable.
9. ECS and Nomad telemetry collection is best-effort and may return partial warnings when some cluster/job subqueries fail.
10. Incident correlation currently uses in-memory traces with heuristic candidate selection (errors, latency spikes, or incident text match).

## Included Automated Tests
File: `tests/devscope-core.test.js`
1. trace creation and completion,
2. retention enforcement,
3. SQL and Redis event correlation.
4. OpenTelemetry span mapping and shared trace correlation.
5. AI insight rules for slow endpoints, error rates, and repeated SQL patterns.
6. incident correlation across services using span metadata.

File: `tests/github-intelligence.test.js`
1. git log parser behavior,
2. commit scoring heuristic,
3. graceful failure behavior when git metadata is unavailable.

File: `tests/dashboard-remote-ingest.test.js`
1. API key auth enforcement,
2. valid ingest acceptance,
3. spans-per-request limit validation,
4. per-key rate limiting behavior.

File: `tests/dashboard-tenancy.test.js`
1. scoped ingest persistence from headers,
2. scoped filtering via `GET /api/traces`,
3. tenant/project/environment summary via `GET /api/tenants`.

File: `tests/dashboard-services.test.js`
1. service discovery grouped by environment,
2. tenant/project/environment filtered service views.

File: `tests/kubernetes-connector.test.js`
1. pod parsing,
2. service parsing,
3. deployment rollout parsing,
4. `kubectl top` metric table parsing,
5. log summary parsing.

File: `tests/dashboard-connectors-telemetry.test.js`
1. connector telemetry route returns normalized signals,
2. connector collect route ingests signals into scoped traces,
3. collect route validates connector input,
4. kubernetes telemetry route exposes rollout/service/log signal types,
5. ecs telemetry route exposes service/task/deployment/event signal types,
6. nomad telemetry route exposes job/allocation/deployment/event signal types.

File: `tests/docker-connector.test.js`
1. docker ps parser,
2. docker stats parser,
3. docker log summary parser.

File: `tests/ecs-connector.test.js`
1. cluster list/describe parsing,
2. service list/describe parsing,
3. task list/describe parsing.

File: `tests/nomad-connector.test.js`
1. node status parsing,
2. job status parsing,
3. job allocation parsing,
4. job deployment parsing.

File: `tests/dashboard-incidents.test.js`
1. incident correlation endpoint returns impacted services and relationships with scope filters.

File: `tests/dashboard-cross-service-filters.test.js`
1. `GET /api/traces` filters by service, cluster, namespace, and environment.

File: `tests/dashboard-phase5-production.test.js`
1. RBAC authn/authz enforcement for viewer/editor/admin keys,
2. audit log query support,
3. SLO and time-series APIs,
4. alert hook notification on incident correlation,
5. cluster heartbeat and status APIs.

File: `tests/storage-timeseries.test.js`
1. file-backed trace store persistence across core restarts,
2. time-series capture and SLO report generation.

File: `tests/dashboard-federation.test.js`
1. federation endpoint summarizes cluster/region inventory and cross-cluster links from span metadata.

File: `tests/dashboard-gitops.test.js`
1. gitops change event ingest/list and trace-impact correlation with risk classification.

File: `tests/dashboard-phase6-advanced.test.js`
1. deployment risk endpoint returns canary/baseline risk structure,
2. cost-capacity endpoint returns service estimates,
3. incident postmortem and replay endpoints return exportable timeline data.
