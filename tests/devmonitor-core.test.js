import test from "node:test";
import assert from "node:assert/strict";
import { DevMonitorCore } from "../src/devmonitor/core.js";

test("creates and completes a trace", () => {
  const core = new DevMonitorCore({ maxTraces: 10 });
  const trace = core.createTrace({
    method: "GET",
    path: "/health",
    service: "test",
  });

  assert.ok(trace.traceId);
  assert.equal(trace.durationMs, null);

  core.finishTrace(trace.traceId, { statusCode: 200 });
  const completed = core.getTrace(trace.traceId);

  assert.equal(completed.statusCode, 200);
  assert.ok(completed.durationMs >= 0);
});

test("adds correlated events by trace id", () => {
  const core = new DevMonitorCore({ maxTraces: 10 });
  const trace = core.createTrace({
    method: "GET",
    path: "/checkout",
    service: "test",
  });

  core.instrument.sql(trace.traceId, {
    query: "SELECT 1",
    durationMs: 20,
  });

  core.instrument.redis(trace.traceId, {
    command: "GET",
    key: "cart:1",
    durationMs: 5,
  });

  const result = core.getTrace(trace.traceId);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].type, "sql");
  assert.equal(result.events[1].type, "redis");
});

test("enforces retention limit", () => {
  const core = new DevMonitorCore({ maxTraces: 2 });

  const first = core.createTrace({
    method: "GET",
    path: "/a",
    service: "test",
  });
  const second = core.createTrace({
    method: "GET",
    path: "/b",
    service: "test",
  });
  const third = core.createTrace({
    method: "GET",
    path: "/c",
    service: "test",
  });

  assert.equal(core.listTraces().length, 2);
  assert.equal(core.getTrace(first.traceId), null);
  assert.ok(core.getTrace(second.traceId));
  assert.ok(core.getTrace(third.traceId));
});

test("caps per-trace event count", () => {
  const core = new DevMonitorCore({ maxTraces: 10, maxEventsPerTrace: 2 });
  const trace = core.createTrace({
    method: "GET",
    path: "/events",
    service: "test",
  });

  core.instrument.sql(trace.traceId, { query: "SELECT 1", durationMs: 1 });
  core.instrument.redis(trace.traceId, {
    command: "GET",
    key: "k1",
    durationMs: 1,
  });
  core.instrument.kafka(trace.traceId, {
    topic: "events",
    action: "publish",
    durationMs: 1,
  });

  const result = core.getTrace(trace.traceId);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].type, "redis");
  assert.equal(result.events[1].type, "kafka");
});

test("filters traces by endpoint, status, and method", () => {
  const core = new DevMonitorCore({ maxTraces: 10 });

  const okTrace = core.createTrace({
    method: "GET",
    path: "/checkout",
    service: "test",
  });
  core.finishTrace(okTrace.traceId, { statusCode: 200 });

  const failTrace = core.createTrace({
    method: "POST",
    path: "/checkout",
    service: "test",
  });
  core.finishTrace(failTrace.traceId, { statusCode: 500 });

  const statusFiltered = core.listTraces({ status: "500" });
  assert.equal(statusFiltered.length, 1);
  assert.equal(statusFiltered[0].traceId, failTrace.traceId);

  const endpointAndMethod = core.listTraces({
    endpoint: "check",
    method: "GET",
  });
  assert.equal(endpointAndMethod.length, 1);
  assert.equal(endpointAndMethod[0].traceId, okTrace.traceId);
});

test("supports tenant, project, and environment scope on traces", () => {
  const core = new DevMonitorCore({ maxTraces: 20 });

  const tenantATrace = core.createTrace({
    method: "GET",
    path: "/orders",
    service: "orders-api",
    tenantId: "team-a",
    projectId: "checkout",
    environment: "prod",
  });
  core.finishTrace(tenantATrace.traceId, { statusCode: 200 });

  const tenantBTrace = core.createTrace({
    method: "GET",
    path: "/orders",
    service: "orders-api",
    tenantId: "team-b",
    projectId: "checkout",
    environment: "staging",
  });
  core.finishTrace(tenantBTrace.traceId, { statusCode: 500 });

  const filteredTraces = core.listTraces({
    tenantId: "team-a",
    projectId: "checkout",
    environment: "prod",
  });
  assert.equal(filteredTraces.length, 1);
  assert.equal(filteredTraces[0].traceId, tenantATrace.traceId);

  const scopedStats = core.stats({ tenantId: "team-b" });
  assert.equal(scopedStats.total, 1);
  assert.equal(scopedStats.failed, 1);

  const tenants = core.listTenants();
  assert.equal(tenants.length, 2);
  assert.equal(tenants[0].projects.length, 1);
});

test("builds service registry grouped by environment", () => {
  const core = new DevMonitorCore({ maxTraces: 20 });

  const prodTrace = core.createTrace({
    method: "GET",
    path: "/checkout",
    service: "checkout-api",
    tenantId: "team-a",
    projectId: "commerce",
    environment: "prod",
    startTimeMs: 1_000,
  });
  core.finishTrace(prodTrace.traceId, {
    statusCode: 500,
    endTimeMs: 1_120,
  });
  core.instrument.sql(prodTrace.traceId, {
    query: "SELECT 1",
    durationMs: 8,
  });

  const stagingTrace = core.createTrace({
    method: "GET",
    path: "/checkout",
    service: "checkout-api",
    tenantId: "team-a",
    projectId: "commerce",
    environment: "staging",
    startTimeMs: 2_000,
  });
  core.finishTrace(stagingTrace.traceId, {
    statusCode: 200,
    endTimeMs: 2_040,
  });

  const registry = core.listServices();
  assert.equal(registry.totalServices, 2);
  assert.equal(registry.environments.length, 2);

  const prodService = registry.services.find(
    (service) => service.environment === "prod",
  );
  assert.ok(prodService);
  assert.equal(prodService.errorCount, 1);
  assert.ok(prodService.dependencies.includes("Database"));

  const scoped = core.listServices({ environment: "staging" });
  assert.equal(scoped.totalServices, 1);
  assert.equal(scoped.services[0].environment, "staging");
});

test("buildIncidentCorrelations links impacted services from shared trace spans", () => {
  const core = new DevMonitorCore({ maxTraces: 20 });
  const sharedTraceId = "00112233445566778899aabbccddeeff";

  core.instrument.otelSpan(
    {
      traceId: sharedTraceId,
      spanId: "root-1",
      parentSpanId: "",
      name: "http.checkout",
      statusCode: 2,
      status: "error",
      attributes: {
        "http.method": "POST",
        "http.route": "/checkout",
        "http.status_code": 500,
      },
      startTimeMs: Date.now() - 40,
      endTimeMs: Date.now() - 10,
    },
    { serviceName: "gateway-service" },
  );

  core.instrument.otelSpan(
    {
      traceId: sharedTraceId,
      spanId: "child-1",
      parentSpanId: "root-1",
      name: "rpc.checkout",
      statusCode: 2,
      status: "error",
      attributes: {
        "peer.service": "checkout-service",
        "rpc.service": "checkout-service",
      },
      startTimeMs: Date.now() - 25,
      endTimeMs: Date.now() - 5,
    },
    { serviceName: "gateway-service" },
  );

  const report = core.buildIncidentCorrelations({
    incident: "checkout failure",
    limit: 50,
  });

  assert.ok(report.candidateTraceCount >= 1);
  assert.ok(report.correlatedTraceCount >= 1);
  assert.ok(
    report.impactedServices.some(
      (service) => service.service === "gateway-service",
    ),
  );
  assert.ok(
    report.impactedServices.some(
      (service) => service.service === "checkout-service",
    ),
  );
  assert.ok(
    report.relationships.some(
      (relationship) =>
        relationship.from === "checkout-service" ||
        relationship.to === "checkout-service",
    ),
  );
});

test("maps OpenTelemetry SQL span to sql event", () => {
  const core = new DevMonitorCore({ maxTraces: 10 });

  const traceId = core.instrument.otelSpan({
    traceId: "abc123trace0000000000000000000000",
    spanId: "span-sql-1",
    parentSpanId: "",
    name: "sql.select",
    statusCode: 1,
    attributes: {
      "http.method": "GET",
      "http.route": "/otel-checkout",
      "http.status_code": 200,
      "db.system": "postgresql",
      "db.statement": "SELECT 1",
    },
    startTimeMs: Date.now() - 10,
    endTimeMs: Date.now(),
  });

  const trace = core.getTrace(traceId);
  assert.ok(trace);
  assert.equal(trace.path, "/otel-checkout");
  assert.equal(trace.events.length, 1);
  assert.equal(trace.events[0].type, "sql");
  assert.equal(trace.events[0].name, "SELECT 1");
});

test("keeps related OpenTelemetry spans in same trace", () => {
  const core = new DevMonitorCore({ maxTraces: 10 });
  const sharedTraceId = "feedfacefeedfacefeedfacefeedface";

  core.instrument.otelSpan({
    traceId: sharedTraceId,
    spanId: "root-span",
    parentSpanId: "",
    name: "http.checkout",
    statusCode: 1,
    attributes: {
      "http.method": "GET",
      "http.route": "/otel-checkout",
      "http.status_code": 200,
    },
    startTimeMs: Date.now() - 15,
    endTimeMs: Date.now(),
  });

  core.instrument.otelSpan({
    traceId: sharedTraceId,
    spanId: "child-span",
    parentSpanId: "root-span",
    name: "redis.get",
    statusCode: 1,
    attributes: {
      "db.system": "redis",
      "db.operation": "GET",
      "db.redis.key": "cart:user:1",
    },
    startTimeMs: Date.now() - 6,
    endTimeMs: Date.now(),
  });

  const trace = core.getTrace(sharedTraceId);
  assert.ok(trace);
  assert.equal(trace.events.length, 2);
  assert.equal(trace.events[0].type, "otel");
  assert.equal(trace.events[1].type, "redis");
});

test("builds service dependency graph from trace events", () => {
  const core = new DevMonitorCore({ maxTraces: 10 });
  const trace = core.createTrace({
    method: "GET",
    path: "/checkout",
    service: "checkout-service",
  });

  core.instrument.sql(trace.traceId, {
    query: "SELECT 1",
    durationMs: 15,
  });
  core.instrument.redis(trace.traceId, {
    command: "GET",
    key: "cart:1",
    durationMs: 5,
  });

  const graph = core.buildServiceGraph({ limit: 50 });
  const sqlEdge = graph.edges.find(
    (edge) => edge.from === "checkout-service" && edge.to === "Database",
  );
  const redisEdge = graph.edges.find(
    (edge) => edge.from === "checkout-service" && edge.to === "Redis",
  );

  assert.ok(sqlEdge);
  assert.equal(sqlEdge.count, 1);
  assert.equal(sqlEdge.avgDurationMs, 15);

  assert.ok(redisEdge);
  assert.equal(redisEdge.count, 1);
  assert.equal(redisEdge.avgDurationMs, 5);
});

test("buildAiInsights detects slow endpoint and high error rate", () => {
  const core = new DevMonitorCore({ maxTraces: 20 });

  for (let index = 0; index < 4; index += 1) {
    const trace = core.createTrace({
      method: "POST",
      path: "/checkout",
      service: "checkout-service",
      startTimeMs: 1000,
    });
    core.finishTrace(trace.traceId, {
      statusCode: 500,
      endTimeMs: 1400,
    });
  }

  const fastTrace = core.createTrace({
    method: "GET",
    path: "/health",
    service: "checkout-service",
    startTimeMs: 1000,
  });
  core.finishTrace(fastTrace.traceId, {
    statusCode: 200,
    endTimeMs: 1020,
  });

  const insights = core.buildAiInsights({ limit: 50 });
  const slowInsight = insights.insights.find(
    (item) => item.type === "slow_endpoint",
  );
  const errorInsight = insights.insights.find(
    (item) => item.type === "high_error_rate",
  );

  assert.ok(slowInsight);
  assert.ok(errorInsight);
  assert.equal(errorInsight.evidence.endpoint, "POST /checkout");
});

test("buildAiInsights detects repeated SQL pattern", () => {
  const core = new DevMonitorCore({ maxTraces: 10 });
  const trace = core.createTrace({
    method: "GET",
    path: "/products",
    service: "catalog-service",
  });

  for (let index = 0; index < 5; index += 1) {
    core.instrument.sql(trace.traceId, {
      query: "SELECT * FROM product WHERE id = ?",
      durationMs: 10,
    });
  }

  core.finishTrace(trace.traceId, {
    statusCode: 200,
    endTimeMs: Date.now() + 100,
  });

  const insights = core.buildAiInsights({ limit: 50 });
  const repeatedQueryInsight = insights.insights.find(
    (item) => item.type === "n_plus_one",
  );

  assert.ok(repeatedQueryInsight);
  assert.equal(repeatedQueryInsight.evidence.repeatedCount, 5);
});
