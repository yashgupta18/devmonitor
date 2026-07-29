import crypto from "node:crypto";

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
    this.traces = [];
    this.traceIndex = new Map();
  }

  createTrace({
    method,
    path,
    service = "local-service",
    traceId = generateId(),
    spanId = generateId(),
    startTimeMs = nowMs(),
  }) {
    const trace = {
      traceId,
      spanId,
      service,
      method,
      path,
      statusCode: null,
      error: null,
      startTimeMs,
      endTimeMs: null,
      durationMs: null,
      events: [],
    };

    this.traces.push(trace);
    this.traceIndex.set(traceId, trace);
    this.enforceRetention();
    return trace;
  }

  finishTrace(traceId, { statusCode, error = null, endTimeMs }) {
    const trace = this.traceIndex.get(traceId);
    if (!trace) {
      return;
    }
    trace.statusCode = statusCode;
    trace.error = error;
    trace.endTimeMs = Number.isFinite(endTimeMs) ? endTimeMs : nowMs();
    trace.durationMs = trace.endTimeMs - trace.startTimeMs;
  }

  addEvent(traceId, event) {
    const trace = this.traceIndex.get(traceId);
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

    if (typeof options === "number") {
      limit = options;
    } else {
      limit = Number(options.limit ?? 200);
      endpoint = options.endpoint;
      status = options.status;
      method = options.method;
    }

    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(limit, this.maxTraces))
      : 200;

    const filtered = this.traces.filter((trace) => {
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
      return true;
    });

    return filtered
      .slice(-boundedLimit)
      .map((trace) => ({ ...trace }))
      .reverse();
  }

  getTrace(traceId) {
    const trace = this.traceIndex.get(traceId);
    return trace ? { ...trace } : null;
  }

  stats() {
    const total = this.traces.length;
    const failed = this.traces.filter(
      (trace) => (trace.statusCode ?? 0) >= 500,
    ).length;
    const avgLatency =
      total === 0
        ? 0
        : Math.round(
            this.traces.reduce(
              (sum, trace) => sum + (trace.durationMs ?? 0),
              0,
            ) / total,
          );

    return { total, failed, avgLatency };
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

  middleware(serviceName = "local-service") {
    return (req, res, next) => {
      const trace = this.createTrace({
        method: req.method,
        path: req.path,
        service: serviceName,
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
    const mappedEvent = this.mapOtelSpanToEvent(spanData);
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
    while (this.traces.length > this.maxTraces) {
      const oldest = this.traces.shift();
      if (oldest) {
        this.traceIndex.delete(oldest.traceId);
      }
    }
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
    const existing = this.traceIndex.get(traceId);
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
      traceId,
      spanId: spanData.spanId ?? generateId(),
      startTimeMs: derivedStart,
    });

    return traceId;
  }

  enrichTraceFromOtelSpan(traceId, spanData) {
    const trace = this.traceIndex.get(traceId);
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

  mapOtelSpanToEvent(spanData) {
    const attributes = spanData.attributes ?? {};
    const spanName = spanData.name ?? "otel_span";
    const status = this.otelStatusToText(spanData.statusCode, spanData.status);
    const durationMs = this.computeDurationMs(spanData);

    if (attributes["db.system"] === "redis") {
      return {
        type: "redis",
        name: String(attributes["db.operation"] ?? spanName),
        durationMs,
        status,
        metadata: {
          key: attributes["db.redis.key"] ?? attributes["db.statement"] ?? "",
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
        },
      };
    }

    if (attributes["job.queue"] || attributes["job.name"]) {
      return {
        type: "job",
        name: `${attributes["job.queue"] ?? "queue"}:${attributes["job.name"] ?? spanName}:${attributes["job.action"] ?? "run"}`,
        durationMs,
        status,
      };
    }

    return {
      type: "otel",
      name: spanName,
      durationMs,
      status,
      metadata: {
        spanKind: spanData.kind ?? "internal",
      },
    };
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
    if (value > 1_000_000_000_000_000) {
      return value / 1_000_000;
    }
    if (value > 1_000_000_000_000) {
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
}
