import crypto from "node:crypto";
import { createTraceStorage, TimeSeriesStore } from "./storage.js";

function nowMs() {
  return Date.now();
}

function generateId() {
  return crypto.randomUUID();
}

export class DevScopeCore {
  constructor(options = {}) {
    this.maxTraces = options.maxTraces ?? 1000;
    this.maxEventsPerTrace = options.maxEventsPerTrace ?? 200;
    this.maxEventNameLength = options.maxEventNameLength ?? 512;
    this.maxMetadataEntries = options.maxMetadataEntries ?? 20;
    this.maxMetadataValueLength = options.maxMetadataValueLength ?? 256;
    this.defaultTenantId = this.normalizeScopeValue(
      options.defaultTenantId,
      "default-tenant",
    );
    this.defaultProjectId = this.normalizeScopeValue(
      options.defaultProjectId,
      "default-project",
    );
    this.defaultEnvironment = this.normalizeScopeValue(
      options.defaultEnvironment,
      "local",
    );
    this.traceStore = createTraceStorage({
      storageBackend: options.storageBackend,
      traceStorePath: options.traceStorePath,
      maxTraces: this.maxTraces,
    });
    this.timeSeriesStore = new TimeSeriesStore({
      retentionMinutes: options.timeSeriesRetentionMinutes ?? 1440,
    });
  }

  createTrace({
    method,
    path,
    service = "local-service",
    tenantId,
    projectId,
    environment,
    traceId = generateId(),
    spanId = generateId(),
    startTimeMs = nowMs(),
  }) {
    const scope = this.resolveScope({ tenantId, projectId, environment });

    const trace = {
      traceId,
      spanId,
      service,
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      environment: scope.environment,
      method,
      path,
      statusCode: null,
      error: null,
      startTimeMs,
      endTimeMs: null,
      durationMs: null,
      events: [],
    };

    this.traceStore.add(trace);
    this.enforceRetention();
    return trace;
  }

  finishTrace(traceId, { statusCode, error = null, endTimeMs }) {
    const trace = this.traceStore.get(traceId);
    if (!trace) {
      return;
    }
    const wasCompleted = trace.endTimeMs !== null;
    trace.statusCode = statusCode;
    trace.error = error;
    trace.endTimeMs = Number.isFinite(endTimeMs) ? endTimeMs : nowMs();
    trace.durationMs = trace.endTimeMs - trace.startTimeMs;
    if (!wasCompleted) {
      this.timeSeriesStore.recordTrace(trace);
    }
  }

  addEvent(traceId, event) {
    const trace = this.traceStore.get(traceId);
    if (!trace) {
      return;
    }

    const sanitized = this.sanitizeEvent(event);
    trace.events.push({
      id: generateId(),
      timestampMs: nowMs(),
      type: sanitized.type,
      name: sanitized.name,
      durationMs: sanitized.durationMs,
      status: sanitized.status,
      metadata: sanitized.metadata,
    });

    if (trace.events.length > this.maxEventsPerTrace) {
      trace.events.shift();
    }
  }

  listTraces(options = {}) {
    let limit;
    let endpoint;
    let status;
    let method;
    let service;
    let cluster;
    let namespace;
    let tenantId;
    let projectId;
    let environment;

    if (typeof options === "number") {
      limit = options;
    } else {
      limit = Number(options.limit ?? 200);
      endpoint = options.endpoint;
      status = options.status;
      method = options.method;
      service = options.service;
      cluster = options.cluster;
      namespace = options.namespace;
      tenantId = options.tenantId;
      projectId = options.projectId;
      environment = options.environment;
    }

    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(limit, this.maxTraces))
      : 200;

    const filtered = this.traceStore.values().filter((trace) => {
      if (
        endpoint &&
        !trace.path.toLowerCase().includes(endpoint.toLowerCase())
      ) {
        return false;
      }
      if (status && String(trace.statusCode ?? "") !== String(status)) {
        return false;
      }
      if (method && trace.method.toLowerCase() !== method.toLowerCase()) {
        return false;
      }
      if (!this.traceMatchesServiceFilter(trace, service)) {
        return false;
      }
      if (
        !this.traceMatchesMetadataFilter(trace, cluster, [
          "cluster",
          "clusterName",
          "clusterArn",
          "datacenter",
        ])
      ) {
        return false;
      }
      if (!this.traceMatchesMetadataFilter(trace, namespace, ["namespace"])) {
        return false;
      }
      if (tenantId && trace.tenantId !== tenantId) {
        return false;
      }
      if (projectId && trace.projectId !== projectId) {
        return false;
      }
      if (environment && trace.environment !== environment) {
        return false;
      }
      return true;
    });

    return filtered
      .slice(-boundedLimit)
      .map((trace) => ({ ...trace }))
      .reverse();
  }

  traceMatchesServiceFilter(trace, service) {
    if (!service) {
      return true;
    }

    const query = String(service).toLowerCase();
    if (
      String(trace.service ?? "")
        .toLowerCase()
        .includes(query)
    ) {
      return true;
    }

    for (const event of trace.events) {
      const sourceService = String(
        event.metadata?.sourceService ?? "",
      ).toLowerCase();
      const peerService = String(
        event.metadata?.peerService ?? "",
      ).toLowerCase();

      if (sourceService.includes(query) || peerService.includes(query)) {
        return true;
      }
    }

    return false;
  }

  traceMatchesMetadataFilter(trace, value, metadataKeys) {
    if (!value) {
      return true;
    }

    const query = String(value).toLowerCase();
    for (const event of trace.events) {
      for (const key of metadataKeys) {
        const candidate = String(event.metadata?.[key] ?? "").toLowerCase();
        if (candidate.includes(query)) {
          return true;
        }
      }
    }

    return false;
  }

  getTrace(traceId) {
    const trace = this.traceStore.get(traceId);
    return trace ? { ...trace } : null;
  }

  listTimeSeries(options = {}) {
    return this.timeSeriesStore.listBuckets(options);
  }

  stats(options = {}) {
    const traces = this.listTraces({
      ...options,
      limit: this.maxTraces,
    });

    const total = traces.length;
    const failed = traces.filter(
      (trace) => (trace.statusCode ?? 0) >= 500,
    ).length;
    const avgLatency =
      total === 0
        ? 0
        : Math.round(
            traces.reduce((sum, trace) => sum + (trace.durationMs ?? 0), 0) /
              total,
          );

    return { total, failed, avgLatency };
  }

  listTenants(options = {}) {
    const traces = this.listTraces({
      limit: this.maxTraces,
      tenantId: options.tenantId,
      projectId: options.projectId,
      environment: options.environment,
    });
    const tenantMap = new Map();

    for (const trace of traces) {
      const tenantEntry = tenantMap.get(trace.tenantId) ?? {
        tenantId: trace.tenantId,
        projects: new Map(),
        traceCount: 0,
      };

      tenantEntry.traceCount += 1;
      const projectEntry = tenantEntry.projects.get(trace.projectId) ?? {
        projectId: trace.projectId,
        environments: new Set(),
        services: new Set(),
        traceCount: 0,
      };

      projectEntry.traceCount += 1;
      projectEntry.environments.add(trace.environment);
      projectEntry.services.add(trace.service);

      tenantEntry.projects.set(trace.projectId, projectEntry);
      tenantMap.set(trace.tenantId, tenantEntry);
    }

    return Array.from(tenantMap.values())
      .map((tenant) => ({
        tenantId: tenant.tenantId,
        traceCount: tenant.traceCount,
        projects: Array.from(tenant.projects.values())
          .map((project) => ({
            projectId: project.projectId,
            traceCount: project.traceCount,
            environments: Array.from(project.environments).sort(),
            services: Array.from(project.services).sort(),
          }))
          .sort((a, b) => a.projectId.localeCompare(b.projectId)),
      }))
      .sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  }

  listServices(options = {}) {
    const traces = this.listTraces({
      limit: this.maxTraces,
      tenantId: options.tenantId,
      projectId: options.projectId,
      environment: options.environment,
    });
    const serviceMap = new Map();

    for (const trace of traces) {
      const serviceId = trace.service ?? "unknown-service";
      const key = `${trace.tenantId}:${trace.projectId}:${trace.environment}:${serviceId}`;
      const current = serviceMap.get(key) ?? {
        serviceId,
        tenantId: trace.tenantId,
        projectId: trace.projectId,
        environment: trace.environment,
        traceCount: 0,
        errorCount: 0,
        totalLatencyMs: 0,
        firstSeenMs: trace.startTimeMs,
        lastSeenMs: trace.startTimeMs,
        dependencies: new Set(),
      };

      current.traceCount += 1;
      if ((trace.statusCode ?? 0) >= 500) {
        current.errorCount += 1;
      }
      current.totalLatencyMs += trace.durationMs ?? 0;
      current.firstSeenMs = Math.min(current.firstSeenMs, trace.startTimeMs);
      current.lastSeenMs = Math.max(current.lastSeenMs, trace.startTimeMs);

      for (const event of trace.events) {
        current.dependencies.add(this.eventToDependencyName(event));
      }

      serviceMap.set(key, current);
    }

    const services = Array.from(serviceMap.values()).map((service) => ({
      serviceId: service.serviceId,
      tenantId: service.tenantId,
      projectId: service.projectId,
      environment: service.environment,
      traceCount: service.traceCount,
      errorCount: service.errorCount,
      errorRate:
        service.traceCount > 0 ? service.errorCount / service.traceCount : 0,
      avgLatencyMs:
        service.traceCount > 0
          ? Math.round(service.totalLatencyMs / service.traceCount)
          : 0,
      firstSeenMs: service.firstSeenMs,
      lastSeenMs: service.lastSeenMs,
      dependencies: Array.from(service.dependencies).sort(),
    }));

    const groupedByEnvironment = new Map();
    for (const service of services) {
      const envEntry = groupedByEnvironment.get(service.environment) ?? {
        environment: service.environment,
        services: [],
      };
      envEntry.services.push(service);
      groupedByEnvironment.set(service.environment, envEntry);
    }

    return {
      totalServices: services.length,
      environments: Array.from(groupedByEnvironment.values())
        .map((entry) => ({
          environment: entry.environment,
          serviceCount: entry.services.length,
          services: entry.services.sort((a, b) =>
            a.serviceId.localeCompare(b.serviceId),
          ),
        }))
        .sort((a, b) => a.environment.localeCompare(b.environment)),
      services: services.sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
    };
  }

  buildServiceGraph(options = {}) {
    const limit = Number(options.limit ?? 500);
    const traces = this.listTraces({
      limit: Number.isFinite(limit) ? Math.max(1, limit) : 500,
    });

    const nodes = new Map();
    const edges = new Map();

    for (const trace of traces) {
      const sourceService = trace.service ?? "unknown-service";
      this.addGraphNode(nodes, sourceService, "service");

      for (const event of trace.events) {
        const dependency = this.eventToDependencyName(event);
        this.addGraphNode(nodes, dependency, "dependency");
        this.addGraphEdge(edges, sourceService, dependency, event.durationMs);
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()).map((edge) => ({
        ...edge,
        avgDurationMs:
          edge.count > 0
            ? Math.round((edge.totalDurationMs / edge.count) * 100) / 100
            : null,
      })),
      totalTraces: traces.length,
      generatedAtMs: nowMs(),
    };
  }

  buildAiInsights(options = {}) {
    const limit = Number(options.limit ?? 300);
    const traces = this.listTraces({
      limit: Number.isFinite(limit) ? Math.max(1, limit) : 300,
    });

    if (traces.length === 0) {
      return {
        insights: [],
        generatedAtMs: nowMs(),
        analyzedTraces: 0,
      };
    }

    const insights = [];
    const durations = traces
      .map((trace) => trace.durationMs)
      .filter((duration) => Number.isFinite(duration))
      .sort((a, b) => a - b);

    const p95 = this.percentile(durations, 0.95);
    const slowThresholdMs = Math.max(200, Math.round(p95));
    const slowTraces = traces.filter(
      (trace) =>
        Number.isFinite(trace.durationMs) &&
        trace.durationMs >= slowThresholdMs,
    );

    if (slowTraces.length > 0) {
      const endpointSummary = this.summarizeByEndpoint(slowTraces);
      const top = endpointSummary[0];
      if (top) {
        insights.push({
          type: "slow_endpoint",
          severity: "high",
          title: `Slow endpoint detected: ${top.endpoint}`,
          explanation: `Average latency ${top.avgLatencyMs}ms across ${top.count} slow trace(s).`,
          evidence: {
            thresholdMs: slowThresholdMs,
            avgLatencyMs: top.avgLatencyMs,
            maxLatencyMs: top.maxLatencyMs,
            sampleTraceId: top.sampleTraceId,
          },
        });
      }
    }

    const errorSummary = this.summarizeErrorsByEndpoint(traces);
    const noisyEndpoint = errorSummary.find(
      (item) => item.count >= 3 && item.errorRate >= 0.2,
    );
    if (noisyEndpoint) {
      insights.push({
        type: "high_error_rate",
        severity: "high",
        title: `High error rate on ${noisyEndpoint.endpoint}`,
        explanation: `${Math.round(noisyEndpoint.errorRate * 100)}% errors over ${noisyEndpoint.count} request(s).`,
        evidence: {
          endpoint: noisyEndpoint.endpoint,
          count: noisyEndpoint.count,
          errorRate: noisyEndpoint.errorRate,
          sampleTraceId: noisyEndpoint.sampleTraceId,
        },
      });
    }

    const nPlusOneTrace = this.detectNPlusOneTrace(traces);
    if (nPlusOneTrace) {
      insights.push({
        type: "n_plus_one",
        severity: "medium",
        title: `Potential N+1 query pattern on ${nPlusOneTrace.path}`,
        explanation: `Repeated SQL query detected ${nPlusOneTrace.repeatedCount} time(s) in one trace.`,
        evidence: {
          traceId: nPlusOneTrace.traceId,
          query: nPlusOneTrace.query,
          repeatedCount: nPlusOneTrace.repeatedCount,
        },
      });
    }

    const connectorGaps = this.detectMissingConnectorCoverage(traces);
    if (connectorGaps.length > 0) {
      insights.push({
        type: "coverage_gap",
        severity: "low",
        title: "Partial observability coverage",
        explanation: `Some traces have no downstream events (${connectorGaps.length} trace(s)).`,
        evidence: {
          tracesWithoutEvents: connectorGaps.slice(0, 3),
        },
      });
    }

    return {
      insights,
      generatedAtMs: nowMs(),
      analyzedTraces: traces.length,
    };
  }

  buildIncidentCorrelations(options = {}) {
    const limit = Number(options.limit ?? 400);
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, limit) : 400;
    const incident = String(options.incident ?? "").trim();
    const incidentQuery = incident.toLowerCase();

    const traces = this.listTraces({
      limit: boundedLimit,
      tenantId: options.tenantId,
      projectId: options.projectId,
      environment: options.environment,
    });

    const durations = traces
      .map((trace) => trace.durationMs)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const p95 = this.percentile(durations, 0.95);
    const slowThresholdMs = Math.max(200, Math.round(p95));

    const candidateTraces = traces.filter((trace) => {
      const hasFailure = (trace.statusCode ?? 0) >= 500 || Boolean(trace.error);
      const hasLatencySpike =
        Number.isFinite(trace.durationMs) &&
        trace.durationMs >= slowThresholdMs;

      if (!incidentQuery) {
        return hasFailure || hasLatencySpike;
      }

      return (
        hasFailure ||
        hasLatencySpike ||
        this.traceMatchesIncidentQuery(trace, incidentQuery)
      );
    });

    const relationshipMap = new Map();
    const serviceSummaryMap = new Map();
    const correlatedTraceIds = [];

    for (const trace of candidateTraces) {
      const services = this.extractServicesFromTrace(trace);
      const orderedServices = Array.from(services).sort();
      if (orderedServices.length >= 2) {
        correlatedTraceIds.push(trace.traceId);
      }

      for (const serviceName of orderedServices) {
        const current = serviceSummaryMap.get(serviceName) ?? {
          service: serviceName,
          traceCount: 0,
          failedTraceCount: 0,
          totalDurationMs: 0,
          sampleTraceId: trace.traceId,
        };

        current.traceCount += 1;
        current.totalDurationMs += trace.durationMs ?? 0;
        if ((trace.statusCode ?? 0) >= 500 || trace.error) {
          current.failedTraceCount += 1;
        }

        serviceSummaryMap.set(serviceName, current);
      }

      for (let left = 0; left < orderedServices.length; left += 1) {
        for (let right = left + 1; right < orderedServices.length; right += 1) {
          const from = orderedServices[left];
          const to = orderedServices[right];
          const key = `${from}->${to}`;
          const current = relationshipMap.get(key) ?? {
            from,
            to,
            traceCount: 0,
            failureCount: 0,
            sampleTraceId: trace.traceId,
          };

          current.traceCount += 1;
          if ((trace.statusCode ?? 0) >= 500 || trace.error) {
            current.failureCount += 1;
          }

          relationshipMap.set(key, current);
        }
      }
    }

    const impactedServices = Array.from(serviceSummaryMap.values())
      .map((item) => ({
        service: item.service,
        traceCount: item.traceCount,
        failedTraceCount: item.failedTraceCount,
        failureRate:
          item.traceCount > 0 ? item.failedTraceCount / item.traceCount : 0,
        avgDurationMs:
          item.traceCount > 0
            ? Math.round(item.totalDurationMs / item.traceCount)
            : 0,
        sampleTraceId: item.sampleTraceId,
      }))
      .sort((a, b) => {
        if (b.failedTraceCount !== a.failedTraceCount) {
          return b.failedTraceCount - a.failedTraceCount;
        }
        return b.traceCount - a.traceCount;
      });

    const relationships = Array.from(relationshipMap.values()).sort(
      (a, b) => b.traceCount - a.traceCount,
    );

    return {
      incident: incident || "incident",
      generatedAtMs: nowMs(),
      analyzedTraces: traces.length,
      candidateTraceCount: candidateTraces.length,
      correlatedTraceCount: correlatedTraceIds.length,
      slowThresholdMs,
      impactedServices,
      relationships,
      sampleCorrelatedTraceIds: correlatedTraceIds.slice(0, 10),
    };
  }

  buildSloReport(options = {}) {
    const windowMinutes = Math.max(1, Number(options.windowMinutes ?? 60));
    const objectiveAvailability = Number(options.objectiveAvailability ?? 99.9);
    const objectiveP95Ms = Math.max(1, Number(options.objectiveP95Ms ?? 400));
    const shortWindowMinutes = Math.max(
      1,
      Number(options.shortWindowMinutes ?? 5),
    );

    const traces = this.listTraces({
      limit: this.maxTraces,
      tenantId: options.tenantId,
      projectId: options.projectId,
      environment: options.environment,
      service: options.service,
    });

    const now = nowMs();
    const windowCutoff = now - windowMinutes * 60_000;
    const shortCutoff = now - shortWindowMinutes * 60_000;
    const longCutoff =
      now - Math.max(windowMinutes, shortWindowMinutes * 12) * 60_000;

    const scoped = traces.filter(
      (trace) => (trace.endTimeMs ?? trace.startTimeMs) >= windowCutoff,
    );
    const serviceMap = new Map();

    for (const trace of scoped) {
      const service = trace.service ?? "unknown-service";
      const current = serviceMap.get(service) ?? {
        service,
        total: 0,
        errors: 0,
        durations: [],
        shortTotal: 0,
        shortErrors: 0,
        longTotal: 0,
        longErrors: 0,
      };

      const statusFailed =
        (trace.statusCode ?? 0) >= 500 || Boolean(trace.error);
      current.total += 1;
      if (statusFailed) {
        current.errors += 1;
      }
      current.durations.push(
        Number.isFinite(trace.durationMs) ? trace.durationMs : 0,
      );

      const traceTs = trace.endTimeMs ?? trace.startTimeMs;
      if (traceTs >= shortCutoff) {
        current.shortTotal += 1;
        if (statusFailed) {
          current.shortErrors += 1;
        }
      }
      if (traceTs >= longCutoff) {
        current.longTotal += 1;
        if (statusFailed) {
          current.longErrors += 1;
        }
      }

      serviceMap.set(service, current);
    }

    const allowedErrorRate = Math.max(
      0.000001,
      1 - objectiveAvailability / 100,
    );
    const services = Array.from(serviceMap.values())
      .map((item) => {
        item.durations.sort((a, b) => a - b);
        const availability =
          item.total > 0
            ? ((item.total - item.errors) / item.total) * 100
            : 100;
        const p95Ms = this.percentile(item.durations, 0.95);
        const shortErrorRate =
          item.shortTotal > 0 ? item.shortErrors / item.shortTotal : 0;
        const longErrorRate =
          item.longTotal > 0 ? item.longErrors / item.longTotal : 0;

        return {
          service: item.service,
          requests: item.total,
          errors: item.errors,
          availability: Math.round(availability * 1000) / 1000,
          p95Ms: Math.round(p95Ms),
          objectiveAvailability,
          objectiveP95Ms,
          availabilityBreached: availability < objectiveAvailability,
          latencyBreached: p95Ms > objectiveP95Ms,
          shortBurnRate:
            allowedErrorRate > 0
              ? Math.round((shortErrorRate / allowedErrorRate) * 100) / 100
              : 0,
          longBurnRate:
            allowedErrorRate > 0
              ? Math.round((longErrorRate / allowedErrorRate) * 100) / 100
              : 0,
        };
      })
      .sort((a, b) => {
        if (b.shortBurnRate !== a.shortBurnRate) {
          return b.shortBurnRate - a.shortBurnRate;
        }
        return b.requests - a.requests;
      });

    return {
      generatedAtMs: now,
      windowMinutes,
      shortWindowMinutes,
      objectiveAvailability,
      objectiveP95Ms,
      services,
    };
  }

  middleware(serviceName = "local-service", scopeOptions = {}) {
    return (req, res, next) => {
      const traceScope = this.resolveScope(scopeOptions);
      const trace = this.createTrace({
        method: req.method,
        path: req.path,
        service: serviceName,
        tenantId: traceScope.tenantId,
        projectId: traceScope.projectId,
        environment: traceScope.environment,
      });

      req.devscope = {
        traceId: trace.traceId,
        addEvent: (event) => this.addEvent(trace.traceId, event),
      };

      res.setHeader("x-devscope-trace-id", trace.traceId);

      res.on("finish", () => {
        this.finishTrace(trace.traceId, { statusCode: res.statusCode });
      });

      res.on("close", () => {
        if (this.getTrace(trace.traceId)?.endTimeMs === null) {
          this.finishTrace(trace.traceId, {
            statusCode: res.statusCode,
            error: "connection_closed",
          });
        }
      });

      next();
    };
  }

  instrument = {
    sql: (traceId, { query, durationMs, status = "ok" }) => {
      this.addEvent(traceId, {
        type: "sql",
        name: query,
        durationMs,
        status,
      });
    },
    redis: (traceId, { command, key, durationMs, status = "ok" }) => {
      this.addEvent(traceId, {
        type: "redis",
        name: command,
        durationMs,
        status,
        metadata: { key },
      });
    },
    kafka: (traceId, { topic, action, durationMs, status = "ok" }) => {
      this.addEvent(traceId, {
        type: "kafka",
        name: `${action}:${topic}`,
        durationMs,
        status,
      });
    },
    job: (traceId, { queue, jobName, action, durationMs, status = "ok" }) => {
      this.addEvent(traceId, {
        type: "job",
        name: `${queue}:${jobName}:${action}`,
        durationMs,
        status,
      });
    },
    otelSpan: (spanData, options = {}) => {
      return this.ingestOtelSpan(spanData, options);
    },
  };

  ingestOtelSpan(spanData, options = {}) {
    const traceId = this.ensureTraceForOtelSpan(spanData, options);
    this.enrichTraceFromOtelSpan(traceId, spanData);
    const mappedEvent = this.mapOtelSpanToEvent(spanData, options);
    this.addEvent(traceId, mappedEvent);

    if (!spanData.parentSpanId) {
      const statusCode = Number(
        spanData.attributes?.["http.status_code"] ?? spanData.statusCode ?? 200,
      );
      const endTimeMs = this.toMs(
        spanData.endTimeUnixNano,
        spanData.endTime,
        spanData.endTimeMs,
      );
      this.finishTrace(traceId, {
        statusCode: Number.isFinite(statusCode) ? statusCode : 200,
        error: mappedEvent.status === "error" ? mappedEvent.name : null,
        endTimeMs,
      });
    }

    return traceId;
  }

  enforceRetention() {
    this.traceStore.enforceRetention();
  }

  sanitizeEvent(event) {
    const name = String(event.name ?? "unknown_event").slice(
      0,
      this.maxEventNameLength,
    );
    const metadata = this.sanitizeMetadata(event.metadata ?? {});

    return {
      type: event.type ?? "custom",
      name,
      durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
      status: event.status ?? "ok",
      metadata,
    };
  }

  sanitizeMetadata(metadata) {
    const result = {};
    const entries = Object.entries(metadata).slice(0, this.maxMetadataEntries);

    for (const [key, value] of entries) {
      const safeKey = String(key).slice(0, 80);
      result[safeKey] = String(value).slice(0, this.maxMetadataValueLength);
    }

    return result;
  }

  eventToDependencyName(event) {
    switch (event.type) {
      case "sql":
        return "Database";
      case "redis":
        return "Redis";
      case "kafka":
        return "Kafka";
      case "job":
        return "Worker Queue";
      case "otel":
        if (event.metadata?.peerService) {
          return String(event.metadata.peerService);
        }
        return "Service Call";
      default:
        return `Dependency:${event.type}`;
    }
  }

  addGraphNode(nodes, id, kind) {
    const existing = nodes.get(id);
    if (existing) {
      existing.count += 1;
      return;
    }

    nodes.set(id, {
      id,
      label: id,
      kind,
      count: 1,
    });
  }

  addGraphEdge(edges, from, to, durationMs) {
    const key = `${from}->${to}`;
    const existing = edges.get(key);
    if (existing) {
      existing.count += 1;
      if (Number.isFinite(durationMs)) {
        existing.totalDurationMs += durationMs;
      }
      return;
    }

    edges.set(key, {
      id: key,
      from,
      to,
      count: 1,
      totalDurationMs: Number.isFinite(durationMs) ? durationMs : 0,
    });
  }

  ensureTraceForOtelSpan(spanData, options = {}) {
    const traceId = spanData.traceId ?? generateId();
    const existing = this.traceStore.get(traceId);
    if (existing) {
      return traceId;
    }

    const method = String(spanData.attributes?.["http.method"] ?? "OTEL");
    const path = String(
      spanData.attributes?.["http.route"] ??
        spanData.attributes?.["url.path"] ??
        spanData.name ??
        "/otel",
    );

    const derivedStart = this.toMs(
      spanData.startTimeUnixNano,
      spanData.startTime,
      spanData.startTimeMs,
    );

    this.createTrace({
      method,
      path,
      service: options.serviceName ?? spanData.serviceName ?? "otel-service",
      tenantId: options.tenantId,
      projectId: options.projectId,
      environment: options.environment,
      traceId,
      spanId: spanData.spanId ?? generateId(),
      startTimeMs: derivedStart,
    });

    return traceId;
  }

  enrichTraceFromOtelSpan(traceId, spanData) {
    const trace = this.traceStore.get(traceId);
    if (!trace) {
      return;
    }

    const httpMethod = spanData.attributes?.["http.method"];
    const httpRoute =
      spanData.attributes?.["http.route"] ?? spanData.attributes?.["url.path"];

    if (httpMethod && trace.method === "OTEL") {
      trace.method = String(httpMethod);
    }

    if (httpRoute) {
      trace.path = String(httpRoute);
    }

    const spanStartMs = this.toMs(
      spanData.startTimeUnixNano,
      spanData.startTime,
      spanData.startTimeMs,
    );

    if (Number.isFinite(spanStartMs) && spanStartMs < trace.startTimeMs) {
      trace.startTimeMs = spanStartMs;
    }
  }

  mapOtelSpanToEvent(spanData, options = {}) {
    const attributes = spanData.attributes ?? {};
    const spanName = spanData.name ?? "otel_span";
    const status = this.otelStatusToText(spanData.statusCode, spanData.status);
    const durationMs = this.computeDurationMs(spanData);
    const serviceMetadata = this.extractSpanServiceMetadata(spanData, options);

    if (attributes["db.system"] === "redis") {
      return {
        type: "redis",
        name: String(attributes["db.operation"] ?? spanName),
        durationMs,
        status,
        metadata: {
          key: attributes["db.redis.key"] ?? attributes["db.statement"] ?? "",
          ...serviceMetadata,
        },
      };
    }

    if (attributes["db.system"] || attributes["db.statement"]) {
      return {
        type: "sql",
        name: String(attributes["db.statement"] ?? spanName),
        durationMs,
        status,
        metadata: {
          dbSystem: attributes["db.system"] ?? "unknown",
          ...serviceMetadata,
        },
      };
    }

    if (
      attributes["messaging.system"] ||
      attributes["messaging.destination.name"]
    ) {
      return {
        type: "kafka",
        name: String(
          attributes["messaging.operation"] ??
            attributes["messaging.destination.name"] ??
            spanName,
        ),
        durationMs,
        status,
        metadata: {
          system: attributes["messaging.system"] ?? "unknown",
          topic: attributes["messaging.destination.name"] ?? "",
          ...serviceMetadata,
        },
      };
    }

    if (attributes["job.queue"] || attributes["job.name"]) {
      return {
        type: "job",
        name: `${attributes["job.queue"] ?? "queue"}:${attributes["job.name"] ?? spanName}:${attributes["job.action"] ?? "run"}`,
        durationMs,
        status,
        metadata: {
          ...serviceMetadata,
        },
      };
    }

    return {
      type: "otel",
      name: spanName,
      durationMs,
      status,
      metadata: {
        spanKind: spanData.kind ?? "internal",
        ...serviceMetadata,
      },
    };
  }

  extractSpanServiceMetadata(spanData, options = {}) {
    const attributes = spanData.attributes ?? {};
    const sourceService =
      options.serviceName ?? spanData.serviceName ?? attributes["service.name"];
    const peerService =
      attributes["peer.service"] ??
      attributes["rpc.service"] ??
      attributes["server.address"] ??
      "";

    const metadata = {};
    if (sourceService) {
      metadata.sourceService = String(sourceService);
    }
    if (peerService) {
      metadata.peerService = String(peerService);
    }

    return metadata;
  }

  computeDurationMs(spanData) {
    if (Number.isFinite(spanData.durationMs)) {
      return spanData.durationMs;
    }

    const startMs = this.toMs(
      spanData.startTimeUnixNano,
      spanData.startTime,
      spanData.startTimeMs,
    );
    const endMs = this.toMs(
      spanData.endTimeUnixNano,
      spanData.endTime,
      spanData.endTimeMs,
    );

    if (
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      endMs >= startMs
    ) {
      return endMs - startMs;
    }

    return null;
  }

  otelStatusToText(statusCode, statusText) {
    if (String(statusText).toLowerCase() === "error") {
      return "error";
    }
    if (Number(statusCode) === 2) {
      return "error";
    }
    return "ok";
  }

  toMs(...candidates) {
    for (const value of candidates) {
      const converted = this.tryConvertToMs(value);
      if (converted !== null) {
        return converted;
      }
    }

    return nowMs();
  }

  tryConvertToMs(value) {
    if (value === undefined || value === null) {
      return null;
    }

    if (Array.isArray(value)) {
      return this.arrayTimeToMs(value);
    }

    if (typeof value === "bigint") {
      return Number(value / 1_000_000n);
    }

    if (Number.isFinite(value)) {
      return this.numericTimeToMs(value);
    }

    return null;
  }

  arrayTimeToMs(value) {
    if (value.length !== 2) {
      return null;
    }

    const [sec, nsec] = value;
    if (!Number.isFinite(sec) || !Number.isFinite(nsec)) {
      return null;
    }

    return sec * 1000 + nsec / 1_000_000;
  }

  numericTimeToMs(value) {
    const now = Date.now();
    if (value > now * 100_000) {
      return value / 1_000_000;
    }
    if (value > now * 100) {
      return value / 1000;
    }
    return value;
  }

  percentile(values, ratio) {
    if (!Array.isArray(values) || values.length === 0) {
      return 0;
    }
    const boundedRatio = Math.min(1, Math.max(0, ratio));
    const index = Math.floor((values.length - 1) * boundedRatio);
    return values[index];
  }

  summarizeByEndpoint(traces) {
    const summary = new Map();

    for (const trace of traces) {
      const key = `${trace.method} ${trace.path}`;
      const current = summary.get(key) ?? {
        endpoint: key,
        count: 0,
        totalLatencyMs: 0,
        maxLatencyMs: 0,
        sampleTraceId: trace.traceId,
      };

      current.count += 1;
      current.totalLatencyMs += trace.durationMs ?? 0;
      current.maxLatencyMs = Math.max(
        current.maxLatencyMs,
        trace.durationMs ?? 0,
      );

      summary.set(key, current);
    }

    return Array.from(summary.values())
      .map((item) => ({
        ...item,
        avgLatencyMs: Math.round(item.totalLatencyMs / item.count),
      }))
      .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs);
  }

  summarizeErrorsByEndpoint(traces) {
    const summary = new Map();

    for (const trace of traces) {
      const key = `${trace.method} ${trace.path}`;
      const current = summary.get(key) ?? {
        endpoint: key,
        count: 0,
        errorCount: 0,
        sampleTraceId: trace.traceId,
      };

      current.count += 1;
      if ((trace.statusCode ?? 0) >= 500) {
        current.errorCount += 1;
      }

      summary.set(key, current);
    }

    return Array.from(summary.values())
      .map((item) => ({
        ...item,
        errorRate: item.count > 0 ? item.errorCount / item.count : 0,
      }))
      .sort((a, b) => b.errorRate - a.errorRate);
  }

  detectNPlusOneTrace(traces) {
    for (const trace of traces) {
      const sqlEvents = trace.events.filter((event) => event.type === "sql");
      if (sqlEvents.length < 5) {
        continue;
      }

      const queryCounts = new Map();
      for (const event of sqlEvents) {
        const count = (queryCounts.get(event.name) ?? 0) + 1;
        queryCounts.set(event.name, count);
      }

      const repeated = Array.from(queryCounts.entries()).find(
        (entry) => entry[1] >= 3,
      );
      if (repeated) {
        return {
          traceId: trace.traceId,
          path: `${trace.method} ${trace.path}`,
          query: repeated[0],
          repeatedCount: repeated[1],
        };
      }
    }

    return null;
  }

  detectMissingConnectorCoverage(traces) {
    return traces
      .filter((trace) => trace.events.length === 0)
      .map((trace) => ({
        traceId: trace.traceId,
        endpoint: `${trace.method} ${trace.path}`,
      }));
  }

  traceMatchesIncidentQuery(trace, query) {
    if (!query) {
      return false;
    }

    const traceFields = [trace.service, trace.path, trace.method, trace.error]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    for (const field of traceFields) {
      if (field.includes(query)) {
        return true;
      }
    }

    for (const event of trace.events) {
      if (
        String(event.name ?? "")
          .toLowerCase()
          .includes(query)
      ) {
        return true;
      }

      for (const value of Object.values(event.metadata ?? {})) {
        if (String(value).toLowerCase().includes(query)) {
          return true;
        }
      }
    }

    return false;
  }

  extractServicesFromTrace(trace) {
    const services = new Set();

    if (trace.service) {
      services.add(String(trace.service));
    }

    for (const event of trace.events) {
      const sourceService = event.metadata?.sourceService;
      const peerService = event.metadata?.peerService;

      if (sourceService) {
        services.add(String(sourceService));
      }

      if (peerService) {
        services.add(String(peerService));
      }
    }

    return services;
  }

  resolveScope(scope = {}) {
    return {
      tenantId: this.normalizeScopeValue(scope.tenantId, this.defaultTenantId),
      projectId: this.normalizeScopeValue(
        scope.projectId,
        this.defaultProjectId,
      ),
      environment: this.normalizeScopeValue(
        scope.environment,
        this.defaultEnvironment,
      ),
    };
  }

  normalizeScopeValue(value, fallback) {
    const normalized = String(value ?? "").trim();
    if (normalized.length === 0) {
      return fallback;
    }
    return normalized.slice(0, 80);
  }
}
