## DevMonitor Plan: Narrow MVP, Then Scale Systematically

Homepage message:
Debug your distributed system in 30 seconds.

Core product statement:
DevMonitor is an open-source engineering intelligence platform built on OpenTelemetry, starting with local debugging and expanding to production intelligence.

## Product Strategy

Do not build everything at once. Ship one killer feature first:
See every request flowing through your backend in real time, on one screen, with minimal setup.

Initial request flow to visualize:

Incoming Request
-> Gateway
-> Auth
-> Redis
-> Database
-> Kafka
-> Response

Principles:
1. Local-first and useful from day one.
2. No cloud dependency in early phases.
3. No AI in MVP.
4. Add capabilities one layer at a time.
5. Every phase must be shippable and independently valuable.

## Target Users

Primary:
Backend and platform engineers in teams of 10-100 developers.

Secondary:
Advanced solo developers and small teams building distributed backends.

## The Narrowed MVP (Phase 1: 2-3 Weeks)

MVP goal:
Run one command, open dashboard, immediately see request flow and bottlenecks locally.

Command:
devmonitor start

MVP includes:
1. Live HTTP request tracing.
2. SQL query timeline per request.
3. Redis command timeline per request.
4. Kafka publish/consume event timeline per request.
5. Background job timeline (enqueue, start, retry, fail, complete).
6. One unified trace detail screen that correlates all above.

MVP explicitly excludes:
1. AI root cause analysis.
2. Kubernetes and cloud mode.
3. Multi-language SDKs beyond first chosen stack.
4. Advanced architecture graph generation.

Why this MVP is strong:
1. Users instantly understand the value.
2. It cuts debugging time without process change.
3. It creates a strong demo for open-source adoption.

## Revised Phased Roadmap

### Phase 1 (2-3 Weeks): Local Debugging MVP

Outcome:
Usable local tool with one-screen request intelligence.

Deliverables:
1. Browser dashboard auto-opens from devmonitor start.
2. Correlated timeline for HTTP, SQL, Redis, Kafka, jobs.
3. Basic filters: endpoint, status code, latency, errors.
4. Error detail panel (stack trace and metadata).

Acceptance gates:
1. Setup to first trace under 10 minutes on fresh machine.
2. Root cause from slow request to culprit component under 3 minutes.
3. Crash-free for 2-hour local run in sample app.

### Phase 2 (3-4 Weeks): OpenTelemetry Integration

Outcome:
DevMonitor becomes instrumentation-friendly and easier to adopt.

Deliverables:
1. Node package: npm install @devmonitor/sdk.
2. Python package: pip install devmonitor.
3. Ingest traces from OpenTelemetry-compatible spans.
4. Preserve correlation in same dashboard views.

Acceptance gates:
1. Existing OTel app can send traces with minimal changes.
2. Span ingestion overhead is measured and documented.

### Phase 3: Service Dependency Graph

Outcome:
Auto-generated service map from observed traces.

Example:
Frontend
-> Gateway
-> User Service
-> Redis
-> Database

Deliverables:
1. Graph view of service-to-service calls.
2. Edge latency and error indicators.
3. Click-through from graph edge to sample traces.

### Phase 4: Production Connectors

Outcome:
Move from localhost debugging to real environment visibility.

Deliverables:
1. Kubernetes connector.
2. Docker connector.
3. ECS connector.
4. Nomad connector.
5. Clear separation of local mode vs production mode.

### Phase 5: AI Explanations

Outcome:
Natural-language incident triage.

Prompt example:
Why is checkout slow?

AI reads:
1. Traces.
2. Metrics.
3. Logs.
4. Deployments.

Deliverables:
1. Explain likely root cause with confidence score.
2. Suggest next validation steps.
3. Link explanation to evidence spans and queries.

### Phase 6: GitHub Incident Intelligence

Outcome:
Bridge runtime incidents to engineering changes.

Flow:
Incident
-> Deployment
-> Commit
-> Author
-> Pull Request

Deliverables:
1. Incident timeline with deployment and commit correlation.
2. Suggested suspect PR list.
3. Team-ready incident report export.

## Systematic Prioritization Framework

Use this score for every backlog item:
Priority Score = (User Impact x Frequency x Confidence) / Effort

Scoring fields:
1. User Impact (1-5): how much time or risk it saves.
2. Frequency (1-5): how often the pain happens.
3. Confidence (1-5): certainty that users want it.
4. Effort (1-5): implementation complexity.

Priority tiers:
1. P0: Score >= 12, required for phase success.
2. P1: Score 8-11, high-value next.
3. P2: Score <= 7, defer.

## Prioritized Backlog (Merged and Updated)

P0 for Phase 1 launch:
1. Unified trace timeline UI.
2. HTTP tracing collector.
3. SQL tracing collector.
4. Redis tracing collector.
5. Kafka event collector (basic).
6. Background job collector.
7. Local storage and retention controls.
8. One-command startup experience.

P1 immediately after launch:
1. OTel ingestion SDKs (Node first, Python second).
2. Better filtering and search in traces.
3. Performance and memory overhead hardening.
4. VS Code extension (basic read-only trace lens).

P2 after OTel stabilization:
1. Service dependency graph.
2. Production connectors.
3. AI explanations.
4. GitHub incident correlation.

## Suggested Build Sequence Inside Phase 1

Week 1:
1. Event schema and correlation IDs.
2. HTTP ingestion and timeline skeleton.
3. Dashboard shell with trace list and detail panel.

Week 2:
1. SQL and Redis collectors.
2. Background jobs collector.
3. Kafka basic collector.
4. End-to-end correlation testing.

Week 3:
1. Polished one-command start flow.
2. Reliability hardening and retention limits.
3. Sample app and quickstart docs.
4. Public alpha release.

## Open-Source Success Metrics

Product usage metrics:
1. Time to first useful trace.
2. Time to root cause in guided scenario.
3. Daily active local sessions.

Community metrics:
1. 150+ GitHub stars target after early community push.
2. 500 commits milestone as a long-term project health signal.
3. Number of external contributors and merged PRs.

Quality metrics:
1. Overhead budget under agreed threshold.
2. Crash-free session rate.
3. Bug turnaround time.

## Risks and Guardrails

Top risks:
1. Trying to deliver all features in one release.
2. Instrumentation overhead hurting local app performance.
3. Complex integrations reducing adoption.

Guardrails:
1. No new phase starts before previous acceptance gates pass.
2. Any item without clear user pain evidence gets deferred.
3. Keep local mode as the default and best experience.

## Final Scope Decisions

Confirmed:
1. MVP is narrowed to a one-screen real-time request flow debugger.
2. OTel is a major Phase 2 expansion, not a blocker for first release.
3. AI and Kubernetes move to later phases.
4. GitHub incident intelligence remains a strategic later-phase differentiator.
