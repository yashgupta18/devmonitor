import test from "node:test";
import assert from "node:assert/strict";
import { DevTraceKitCore } from "../src/devtracekit/core.js";
import { createDashboardServer } from "../src/devtracekit/dashboard.js";

function authHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-devtracekit-api-key": apiKey,
  };
}

async function createServer() {
  const sentAlerts = [];
  const core = new DevTraceKitCore({ maxTraces: 200 });
  const dashboard = createDashboardServer(
    core,
    {},
    {
      dashboardPort: 0,
      security: {
        enabled: true,
        apiKeys: [
          { role: "viewer", key: "viewer-key", keyId: "viewer" },
          { role: "editor", key: "editor-key", keyId: "editor" },
          { role: "admin", key: "admin-key", keyId: "admin" },
        ],
      },
      alerting: {
        enabled: true,
        webhookUrl: "http://alerts.local/webhook",
        send: async (url, body) => {
          sentAlerts.push({ url, body });
          return { ok: true, status: 200 };
        },
      },
      cluster: {
        enabled: true,
        deploymentMode: "ha",
        ttlMs: 60_000,
      },
    },
  );

  const address = dashboard.server.address();
  const port = typeof address === "object" && address ? address.port : 4318;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    sentAlerts,
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

test("RBAC enforces read/write/admin and audit logs are queryable", async (t) => {
  const server = await createServer();
  t.after(async () => {
    await server.close();
  });

  const viewerRead = await fetch(`${server.baseUrl}/api/traces`, {
    headers: authHeaders("viewer-key"),
  });
  assert.equal(viewerRead.status, 200);

  const viewerWrite = await fetch(`${server.baseUrl}/api/ingest/otel`, {
    method: "POST",
    headers: authHeaders("viewer-key"),
    body: JSON.stringify({
      serviceName: "checkout-service",
      span: { traceId: "rbac-1", spanId: "rbac-1a", name: "http.request" },
    }),
  });
  assert.equal(viewerWrite.status, 403);

  const editorWrite = await fetch(`${server.baseUrl}/api/ingest/otel`, {
    method: "POST",
    headers: authHeaders("editor-key"),
    body: JSON.stringify({
      serviceName: "checkout-service",
      span: {
        traceId: "rbac-2",
        spanId: "rbac-2a",
        name: "http.request",
        attributes: {
          "http.method": "GET",
          "http.route": "/checkout",
          "http.status_code": 200,
        },
      },
    }),
  });
  assert.equal(editorWrite.status, 202);

  const adminAudit = await fetch(`${server.baseUrl}/api/audit?limit=20`, {
    headers: authHeaders("admin-key"),
  });
  assert.equal(adminAudit.status, 200);
  const auditPayload = await adminAudit.json();
  assert.ok(Array.isArray(auditPayload.entries));
  assert.ok(auditPayload.entries.length >= 3);
  assert.ok(auditPayload.entries.some((entry) => entry.status === "denied"));
});

test("SLO/timeseries, cluster heartbeat, and incident alert hooks work", async (t) => {
  const server = await createServer();
  t.after(async () => {
    await server.close();
  });

  for (let index = 0; index < 6; index += 1) {
    const statusCode = index < 2 ? 500 : 200;
    const ingest = await fetch(`${server.baseUrl}/api/ingest/otel`, {
      method: "POST",
      headers: {
        ...authHeaders("editor-key"),
        "x-devtracekit-environment": "prod",
      },
      body: JSON.stringify({
        serviceName: "checkout-service",
        span: {
          traceId: `slo-${index}`,
          spanId: `slo-${index}-a`,
          name: "http.request",
          startTimeMs: Date.now() - 200,
          endTimeMs: Date.now() - 50,
          statusCode,
          attributes: {
            "http.method": "GET",
            "http.route": "/checkout",
            "http.status_code": statusCode,
            "peer.service": "payments-service",
          },
        },
      }),
    });
    assert.equal(ingest.status, 202);
  }

  const slo = await fetch(
    `${server.baseUrl}/api/slo?windowMinutes=60&shortWindowMinutes=5&objectiveAvailability=99.9&objectiveP95Ms=250`,
    {
      headers: authHeaders("viewer-key"),
    },
  );
  assert.equal(slo.status, 200);
  const sloPayload = await slo.json();
  assert.ok(sloPayload.services.length >= 1);
  assert.equal(sloPayload.services[0].service, "checkout-service");

  const timeseries = await fetch(
    `${server.baseUrl}/api/timeseries?windowMinutes=60`,
    {
      headers: authHeaders("viewer-key"),
    },
  );
  assert.equal(timeseries.status, 200);
  const timeseriesPayload = await timeseries.json();
  assert.ok(timeseriesPayload.buckets.length >= 1);

  const heartbeat = await fetch(`${server.baseUrl}/api/cluster/heartbeat`, {
    method: "POST",
    headers: authHeaders("editor-key"),
    body: JSON.stringify({
      instanceId: "collector-1",
      role: "collector",
      version: "0.1.0",
      capacity: 2,
      environment: "prod",
    }),
  });
  assert.equal(heartbeat.status, 202);

  const clusterStatus = await fetch(`${server.baseUrl}/api/cluster/status`, {
    headers: authHeaders("viewer-key"),
  });
  assert.equal(clusterStatus.status, 200);
  const clusterPayload = await clusterStatus.json();
  assert.equal(clusterPayload.deploymentMode, "ha");
  assert.equal(clusterPayload.activeInstanceCount, 1);

  const incident = await fetch(`${server.baseUrl}/api/incidents/correlate`, {
    method: "POST",
    headers: authHeaders("editor-key"),
    body: JSON.stringify({
      incident: "checkout failures",
      notify: true,
      alertChannel: "webhook",
    }),
  });
  assert.equal(incident.status, 200);
  const incidentPayload = await incident.json();
  assert.ok(Array.isArray(incidentPayload.notifications));
  assert.equal(server.sentAlerts.length, 1);
});
