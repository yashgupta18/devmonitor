# DevScope Production Connectors and Security Hardening

This guide explains how to run DevScope in multi-service production-like mode with secure ingestion, role-based access, and operational hooks.

## 1. Storage and Retention

Use file-backed trace storage and tune time-series retention:

```bash
DEVSCOPE_STORAGE_BACKEND=file \
DEVSCOPE_TRACE_STORE_PATH=.devscope/prod/traces.ndjson \
DEVSCOPE_TIMESERIES_RETENTION_MINUTES=10080 \
npm run devscope:start -- --example
```

Notes:
- `DEVSCOPE_STORAGE_BACKEND=file` enables durable trace persistence.
- `DEVSCOPE_TIMESERIES_RETENTION_MINUTES` controls minute-bucket retention for SLO/burn-rate views.

## 2. Remote Ingest Hardening

Enable API-key protected remote ingest with request limits:

```bash
DEVSCOPE_REMOTE_INGEST_KEYS=collector-a,collector-b \
DEVSCOPE_REMOTE_RATE_LIMIT_MAX_REQUESTS=240 \
DEVSCOPE_REMOTE_RATE_LIMIT_WINDOW_MS=60000 \
DEVSCOPE_REMOTE_MAX_SPANS_PER_REQUEST=1000 \
npm run devscope:start
```

## 3. RBAC, Authn/Authz, and Audit Logs

Enable auth and define role-key mappings with format `role:key`:

```bash
DEVSCOPE_AUTH_ENABLED=true \
DEVSCOPE_API_KEYS=viewer:viewer-key,editor:editor-key,admin:admin-key \
DEVSCOPE_AUDIT_MAX_ENTRIES=20000 \
npm run devscope:start
```

Role permissions:
- `viewer`: read-only API access.
- `editor`: read + write ingestion and incident workflows.
- `admin`: full access, including audit and alert test APIs.

Audit endpoint:
- `GET /api/audit?limit=200` (admin only)

## 4. Alerting Hooks

Enable outbound alert hooks for incident context notifications:

```bash
DEVSCOPE_ALERTING_ENABLED=true \
DEVSCOPE_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
DEVSCOPE_PAGERDUTY_WEBHOOK_URL=https://events.pagerduty.com/v2/enqueue \
DEVSCOPE_WEBHOOK_URL=https://your-internal-alert-gateway/hooks/devscope \
npm run devscope:start
```

Alert APIs:
- `POST /api/alerts/test` (admin only)
- `POST /api/incidents/correlate` with `{"notify":true,"alertChannel":"all|slack|pagerduty|webhook"}`

## 5. HA Mode and Horizontal Scaling

Enable cluster heartbeat tracking and set HA deployment mode:

```bash
DEVSCOPE_CLUSTER_ENABLED=true \
DEVSCOPE_DEPLOYMENT_MODE=ha \
DEVSCOPE_CLUSTER_TTL_MS=30000 \
npm run devscope:start
```

Cluster APIs:
- `POST /api/cluster/heartbeat`
- `GET /api/cluster/status`

Recommended pattern:
- Run multiple API/collector instances behind a load balancer.
- Send periodic heartbeats from each instance.
- Use shared persistent storage path or external storage mount.

## 6. Connector Onboarding Checklist

Docker:
- Install Docker Engine/desktop.
- Ensure daemon is reachable by runtime user.

Kubernetes:
- Install `kubectl`.
- Validate context: `kubectl config current-context`.
- Grant read access to pods/services/deployments and logs.

ECS:
- Install AWS CLI and configure credentials.
- Ensure IAM permissions for cluster/service/task listing and describe APIs.

Nomad:
- Install Nomad CLI.
- Configure server address and ACL tokens where needed.

## 7. SLO and Burn-Rate Operations

Use API for service-level error budget monitoring:

```bash
curl "http://localhost:4318/api/slo?windowMinutes=60&shortWindowMinutes=5&objectiveAvailability=99.9&objectiveP95Ms=400"
```

Burn-rate interpretation:
- `shortBurnRate > 1`: currently consuming error budget faster than allowed.
- `longBurnRate > 1`: sustained error-budget overrun over long window.

## 8. Recommended Production Practices

- Rotate API keys regularly.
- Restrict dashboard/API exposure to private networks or zero-trust gateways.
- Use TLS termination at ingress/load balancer.
- Enable centralized log collection for audit and alert outcomes.
- Keep retention bounded and monitor disk utilization for trace store files.
