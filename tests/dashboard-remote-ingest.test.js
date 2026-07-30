import test from "node:test";
import assert from "node:assert/strict";
import { DevTraceKitCore } from "../src/devtracekit/core.js";
import { createDashboardServer } from "../src/devtracekit/dashboard.js";

async function createTestServer(overrides = {}) {
  const core = new DevTraceKitCore({ maxTraces: 100 });
  const dashboard = createDashboardServer(
    core,
    {},
    {
      dashboardPort: 0,
      remoteIngest: {
        enabled: true,
        apiKeys: ["test-key"],
        rateLimitWindowMs: 60_000,
        rateLimitMaxRequests: 2,
        maxSpansPerRequest: 3,
        ...(overrides.remoteIngest ?? {}),
      },
    },
  );

  const address = dashboard.server.address();
  const port = typeof address === "object" && address ? address.port : 4318;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    core,
    baseUrl,
    close: () =>
      new Promise((resolve, reject) => {
        dashboard.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

test("remote ingest rejects requests without API key", async (t) => {
  const server = await createTestServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(`${server.baseUrl}/api/remote/ingest/otel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      serviceName: "remote-checkout",
      spans: [{ traceId: "t1", spanId: "s1", name: "http.request" }],
    }),
  });

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error, "invalid_api_key");
});

test("remote ingest accepts valid API key and stores traces", async (t) => {
  const server = await createTestServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(`${server.baseUrl}/api/remote/ingest/otel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devtracekit-api-key": "test-key",
    },
    body: JSON.stringify({
      serviceName: "remote-checkout",
      spans: [
        {
          traceId: "remote-trace-1",
          spanId: "remote-span-1",
          name: "http.request",
          attributes: { "http.method": "GET", "http.route": "/orders" },
        },
      ],
    }),
  });

  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.accepted, 1);
  assert.equal(payload.serviceName, "remote-checkout");

  const traces = server.core.listTraces({ limit: 10, endpoint: "/orders" });
  assert.ok(traces.length >= 1);
});

test("remote ingest enforces spans per request limit", async (t) => {
  const server = await createTestServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(`${server.baseUrl}/api/remote/ingest/otel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devtracekit-api-key": "test-key",
    },
    body: JSON.stringify({
      serviceName: "remote-checkout",
      spans: [
        { traceId: "t1", spanId: "s1", name: "a" },
        { traceId: "t2", spanId: "s2", name: "b" },
        { traceId: "t3", spanId: "s3", name: "c" },
        { traceId: "t4", spanId: "s4", name: "d" },
      ],
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "spans_limit_exceeded");
});

test("remote ingest applies per-key rate limiting", async (t) => {
  const server = await createTestServer({
    remoteIngest: {
      rateLimitMaxRequests: 1,
      rateLimitWindowMs: 60_000,
    },
  });

  t.after(async () => {
    await server.close();
  });

  const headers = {
    "content-type": "application/json",
    "x-devtracekit-api-key": "test-key",
  };

  const first = await fetch(`${server.baseUrl}/api/remote/ingest/otel`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      serviceName: "remote-checkout",
      spans: [{ traceId: "t1", spanId: "s1", name: "first" }],
    }),
  });

  assert.equal(first.status, 202);

  const second = await fetch(`${server.baseUrl}/api/remote/ingest/otel`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      serviceName: "remote-checkout",
      spans: [{ traceId: "t2", spanId: "s2", name: "second" }],
    }),
  });

  assert.equal(second.status, 429);
  const payload = await second.json();
  assert.equal(payload.error, "rate_limit_exceeded");
  assert.ok(payload.retryAfterMs > 0);
});
