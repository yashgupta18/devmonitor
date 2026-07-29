import test from "node:test";
import assert from "node:assert/strict";
import { DevScopeCore } from "../src/devscope/core.js";

test("creates and completes a trace", () => {
  const core = new DevScopeCore({ maxTraces: 10 });
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
  const core = new DevScopeCore({ maxTraces: 10 });
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
  const core = new DevScopeCore({ maxTraces: 2 });

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
  const core = new DevScopeCore({ maxTraces: 10, maxEventsPerTrace: 2 });
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
  const core = new DevScopeCore({ maxTraces: 10 });

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

test("maps OpenTelemetry SQL span to sql event", () => {
  const core = new DevScopeCore({ maxTraces: 10 });

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
  const core = new DevScopeCore({ maxTraces: 10 });
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
  const core = new DevScopeCore({ maxTraces: 10 });
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
  const core = new DevScopeCore({ maxTraces: 20 });

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
  const core = new DevScopeCore({ maxTraces: 10 });
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
