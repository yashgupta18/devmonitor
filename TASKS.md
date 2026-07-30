## DevScope Implementation Tracker

Status legend:
- [x] Completed
- [ ] Pending

### Phase 1 - Narrow MVP (Current)
- [x] Bootstrap Node project and CLI entrypoint (`devscope start`).
- [x] Implement in-memory trace store and request middleware.
- [x] Build dashboard API and static one-screen timeline UI.
- [x] Add example backend flow with HTTP + SQL + Redis + Kafka + Job simulated events.
- [x] Add documentation for testing and local validation.
- [x] Add automated tests for trace lifecycle and event correlation.
- [x] Add performance safeguards (retention and event-size caps).
- [x] Add simple endpoint/status filters in dashboard UI.

### Phase 2 - OpenTelemetry Integration
- [x] Add Node SDK package surface (`@devscope/sdk`).
- [x] Add Python package surface (`devscope`).
- [x] Map OpenTelemetry spans into DevScope event schema.
- [x] Validate context propagation with real instrumented service.

### Phase 3+
- [x] Service dependency graph.
- [x] Production connectors (Kubernetes, Docker, ECS, Nomad).
- [x] Docker connector (local container discovery and API status endpoint).
- [x] Kubernetes connector.
- [x] ECS connector.
- [x] Nomad connector.
- [x] AI explanations.
- [x] GitHub incident intelligence.

### Phase 4 - Open Source Readiness
- [x] Add root README onboarding and quickstart.
- [x] Add LICENSE file.
- [x] Add CONTRIBUTING guide and issue templates.
- [x] Add CI workflow for test runs.
- [x] Decide npm packaging strategy (single package vs multi-package workspace).
- [x] If publishing npm package, restrict published files with files/.npmignore.

### Phase 5 - Production Multi-Service Observability (Future)
- [x] Define production architecture: control plane + collectors + dashboard (`PRODUCTION_ARCHITECTURE.md`).
- [x] Add secure remote ingestion endpoint for multi-service traces/events.
- [x] Add tenant/project model for teams and environments.
- [x] Add service registry to discover and group services by environment.
- [x] Expand connectors from status-only to telemetry collection mode.
- [x] Kubernetes: collect pod/service metrics, logs, rollout metadata.
- [x] Docker: collect container lifecycle, resource, and log metadata.
- [x] ECS: collect cluster/service/task telemetry and deployment events.
- [x] Nomad: collect job/allocation telemetry and deployment events.
- [x] Correlate incidents across services using trace/span relationships.
- [x] Add cross-service query UI (filter by service, cluster, namespace, env).
- [x] Add production-safe retention and storage backend (time-series + trace store).
- [x] Add RBAC, authn/authz, API keys, and audit logs.
- [x] Add alerting hooks (Slack, PagerDuty, webhooks) with incident context.
- [x] Add high-availability deployment mode and horizontal scaling.
- [x] Add SLO dashboards and burn-rate incident views.
- [x] Add onboarding docs for production connectors and security hardening.

### Phase 6 - Enterprise Operations and Intelligence (Future)
- [x] Multi-cluster and multi-region federation view.
- [x] GitOps integration for change-event correlation.
- [x] Deployment risk scoring and canary regression detection.
- [x] Cost observability and capacity insights by service/team.
- [x] Incident postmortem export and timeline replay.
