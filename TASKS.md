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
- [ ] Define production architecture: control plane + collectors + dashboard.
- [ ] Add secure remote ingestion endpoint for multi-service traces/events.
- [ ] Add tenant/project model for teams and environments.
- [ ] Add service registry to discover and group services by environment.
- [ ] Expand connectors from status-only to telemetry collection mode.
- [ ] Kubernetes: collect pod/service metrics, logs, rollout metadata.
- [ ] Docker: collect container lifecycle, resource, and log metadata.
- [ ] ECS: collect cluster/service/task telemetry and deployment events.
- [ ] Nomad: collect job/allocation telemetry and deployment events.
- [ ] Correlate incidents across services using trace/span relationships.
- [ ] Add cross-service query UI (filter by service, cluster, namespace, env).
- [ ] Add production-safe retention and storage backend (time-series + trace store).
- [ ] Add RBAC, authn/authz, API keys, and audit logs.
- [ ] Add alerting hooks (Slack, PagerDuty, webhooks) with incident context.
- [ ] Add high-availability deployment mode and horizontal scaling.
- [ ] Add SLO dashboards and burn-rate incident views.
- [ ] Add onboarding docs for production connectors and security hardening.

### Phase 6 - Enterprise Operations and Intelligence (Future)
- [ ] Multi-cluster and multi-region federation view.
- [ ] GitOps integration for change-event correlation.
- [ ] Deployment risk scoring and canary regression detection.
- [ ] Cost observability and capacity insights by service/team.
- [ ] Incident postmortem export and timeline replay.
