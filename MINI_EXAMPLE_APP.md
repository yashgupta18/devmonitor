# Mini Example App: End-to-End devmonitor Validation

This mini app generates traces, service dependencies, federation metadata, GitOps events, canary signals, cost/capacity data, and incident postmortem/replay artifacts.

## What It Covers

After running one scenario, you can validate:
- Trace list and timeline
- Cross-service filtering
- Service graph
- AI insights
- Federation view (multi-cluster/multi-region)
- GitOps change correlation
- Deployment risk and canary regression
- Cost and capacity insights
- Incident postmortem export and replay
- Cluster heartbeat status
- Connector collect attempts (Docker/Kubernetes/ECS/Nomad)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start the mini app and dashboard together:

```bash
npm run example:mini
```

Default ports:
- Dashboard: `http://localhost:4318`
- Mini app: `http://localhost:3050`

Open the mini app landing page at:
- `http://localhost:3050/`

Optional custom ports:

```bash
DEVSCOPE_DASHBOARD_PORT=4328 DEVSCOPE_MINI_APP_PORT=3051 npm run example:mini
```

If `http://localhost:3050/` shows `Cannot GET /` with CSP `default-src 'none'`, an older mini app process is still running. Stop it and start again:

```bash
pkill -f "mini-e2e-app.js" || true
npm run example:mini
```

## Run Full Scenario

In another terminal:

```bash
curl -X POST http://localhost:3050/scenario/full
```

This executes baseline traffic, creates a GitOps deploy event, runs canary-style slow/error traffic, records cluster heartbeat, and triggers connector collect attempts.

## Manual Traffic (Optional)

```bash
curl http://localhost:3050/catalog
curl http://localhost:3050/checkout
curl "http://localhost:3050/checkout?slow=1"
curl "http://localhost:3050/checkout?fail=1&slow=1"
curl -X POST http://localhost:3050/simulate/deploy
```

## Validate Key APIs

```bash
curl "http://localhost:4318/api/traces?service=payments-service&environment=prod"
curl "http://localhost:4318/api/federation"
curl "http://localhost:4318/api/gitops/correlations?windowMinutes=30"
curl "http://localhost:4318/api/deployments/risk?baselineMinutes=30&canaryMinutes=20"
curl "http://localhost:4318/api/cost-capacity?windowMinutes=60"
curl "http://localhost:4318/api/incidents/postmortem?incident=checkout"
curl "http://localhost:4318/api/incidents/replay?incident=checkout"
curl "http://localhost:4318/api/slo?windowMinutes=60&shortWindowMinutes=5"
curl "http://localhost:4318/api/cluster/status"
```

## Recommended Dashboard Checks

Open `http://localhost:4318` and verify these sections are populated:
- Trace table and timeline
- Service dependency graph
- AI explanations
- SLO burn-rate
- Federation view
- GitOps change correlation
- Deployment risk and canary
- Cost and capacity insights
- Incident postmortem and replay summary

## Scope Defaults

The mini app uses these defaults unless overridden:
- `tenantId`: `team-mini`
- `projectId`: `storefront`
- `environment`: `prod`

You can override using:

```bash
DEVSCOPE_TENANT_ID=team-x DEVSCOPE_PROJECT_ID=checkout DEVSCOPE_ENVIRONMENT=staging npm run example:mini
```
