# DevScope Production Architecture (Phase 5)

This document defines the first production-grade architecture for multi-service debugging across Kubernetes, Docker, ECS, and Nomad.

## Goals

1. Observe many services in one place.
2. Correlate incidents across traces, logs, metrics, and deployments.
3. Keep onboarding simple for platform teams.
4. Support secure multi-team and multi-environment operation.

## Non-Goals (Initial Production Beta)

1. Full enterprise federation (multi-region control plane).
2. Advanced AI auto-remediation.
3. Cost optimization engine.

## High-Level Topology

1. Control Plane
- API + auth + tenancy + query + alerting.
- Stores metadata, indices, and user configuration.

2. Data Plane Collectors
- Cluster/host collectors gather traces, logs, metrics, deployment events.
- Collectors normalize data and forward to ingest gateway.

3. Storage Layer
- Trace store for span/event data.
- Time-series store for metrics.
- Search index for logs and incident metadata.

4. UI + Incident Workbench
- Cross-service timelines and dependency graph.
- Incident view: service impact, deployment chain, suspect commits.

## Component Boundaries

## Ingest Gateway

Responsibilities:
- Accept OTLP/HTTP and DevScope native ingest.
- Authenticate source using API key or workload identity.
- Apply rate limits and payload validation.
- Route events to trace/log/metric pipelines.

Interfaces:
- `POST /api/ingest/otel`
- `POST /api/ingest/events`
- `POST /api/ingest/metrics`

## Control Plane API

Responsibilities:
- Tenant/project/environment management.
- Query APIs for traces, services, incidents, SLO views.
- RBAC policies and audit logs.

Interfaces:
- `GET /api/services`
- `GET /api/traces`
- `GET /api/incidents`
- `GET /api/slo`

## Collectors

Kubernetes collector:
- Pod/service metadata
- Events and rollout changes
- Logs and resource metrics

Docker collector:
- Container lifecycle and runtime metrics
- Host-level container logs

ECS collector:
- Cluster/service/task lifecycle
- Deployment and task health events

Nomad collector:
- Job/allocation lifecycle
- Allocation resource and health metadata

## Data Model (Minimal)

1. Tenant
- `tenantId`, `name`

2. Project
- `projectId`, `tenantId`, `name`

3. Environment
- `environmentId`, `projectId`, `name` (`dev`, `staging`, `prod`)

4. Service
- `serviceId`, `environmentId`, `name`, `runtime`, `orchestrator`

5. Trace
- `traceId`, `serviceId`, `spanCount`, `errorCount`, `startTimeMs`, `durationMs`

6. Incident
- `incidentId`, `environmentId`, `severity`, `startTimeMs`, `status`, `rootSignals`

## Security Model

1. AuthN
- API keys for collectors (initial).
- OIDC SSO for user access.

2. AuthZ
- RBAC roles: `owner`, `maintainer`, `viewer`, `oncall`.

3. Isolation
- Tenant/project scoped queries and data access.

4. Audit
- Record access and mutating actions.

## Scalability and Reliability

1. Horizontal scaling
- Stateless ingest and API nodes behind load balancer.

2. Backpressure
- Queue buffering between ingest and storage writers.

3. Retention tiers
- Hot data: 7-14 days.
- Warm data: 30-90 days.

4. HA defaults
- Multi-replica API/ingest.
- Storage replication via chosen backend.

## Query and Debugging Workflows

1. Cross-service request debug
- Filter by environment + service.
- Trace jump from edge service to downstream spans.

2. Incident triage
- Incident timeline with deployments and error spikes.
- Suspect PR/commit ranking from change metadata.

3. Reliability health
- SLO burn alerts and latency/error trend views.

## Rollout Plan

1. Beta-1: Ingest + tenant/project + traces
- Remote ingest
- Service registry
- Cross-service trace query

2. Beta-2: Connector telemetry mode
- Kubernetes + ECS first
- Deployment and workload metadata correlation

3. Beta-3: Security + alerting + SLO
- RBAC
- Alert routing
- Burn-rate views

4. GA candidate
- HA hardening
- Scale testing
- Runbooks and onboarding docs

## Acceptance Criteria for Phase 5 Task 1

1. Architecture describes control plane, collectors, storage, and UI boundaries.
2. Security and tenancy model is defined.
3. Rollout milestones are explicit and actionable.
4. Document is versioned in repository for future implementation tasks.
