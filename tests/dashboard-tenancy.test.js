import test from "node:test";
import assert from "node:assert/strict";
import { DevMonitorCore } from "../src/devmonitor/core.js";
import { createDashboardServer } from "../src/devmonitor/dashboard.js";

async function createScopedServer() {
  const core = new DevMonitorCore({ maxTraces: 100 });
  const dashboard = createDashboardServer(core, {}, { dashboardPort: 0 });

  const address = dashboard.server.address();
  const port = typeof address === "object" && address ? address.port : 4318;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
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

test("ingest otel stores tenant/project/environment scope", async (t) => {
  const server = await createScopedServer();
  t.after(async () => {
    await server.close();
  });

  const ingest = await fetch(`${server.baseUrl}/api/ingest/otel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devmonitor-tenant-id": "team-blue",
      "x-devmonitor-project-id": "checkout",
      "x-devmonitor-environment": "prod",
    },
    body: JSON.stringify({
      serviceName: "checkout-service",
      span: {
        traceId: "tenant-trace-1",
        spanId: "tenant-span-1",
        name: "http.request",
        attributes: {
          "http.method": "GET",
          "http.route": "/checkout",
          "http.status_code": 200,
        },
      },
    }),
  });

  assert.equal(ingest.status, 202);

  const filtered = await fetch(
    `${server.baseUrl}/api/traces?tenantId=team-blue&projectId=checkout&environment=prod`,
  );

  assert.equal(filtered.status, 200);
  const payload = await filtered.json();
  assert.equal(payload.traces.length, 1);
  assert.equal(payload.traces[0].tenantId, "team-blue");
  assert.equal(payload.traces[0].projectId, "checkout");
  assert.equal(payload.traces[0].environment, "prod");
});

test("tenants endpoint summarizes observed projects and environments", async (t) => {
  const server = await createScopedServer();
  t.after(async () => {
    await server.close();
  });

  async function ingestWithScope(tenantId, projectId, environment, traceId) {
    return fetch(`${server.baseUrl}/api/ingest/otel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-devmonitor-tenant-id": tenantId,
        "x-devmonitor-project-id": projectId,
        "x-devmonitor-environment": environment,
      },
      body: JSON.stringify({
        serviceName: "orders-service",
        span: {
          traceId,
          spanId: `${traceId}-span`,
          name: "http.request",
          attributes: {
            "http.method": "GET",
            "http.route": "/orders",
            "http.status_code": 200,
          },
        },
      }),
    });
  }

  const first = await ingestWithScope("team-red", "billing", "staging", "t-1");
  const second = await ingestWithScope("team-red", "billing", "prod", "t-2");
  const third = await ingestWithScope("team-green", "catalog", "prod", "t-3");
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(third.status, 202);

  const response = await fetch(`${server.baseUrl}/api/tenants`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.tenants.length, 2);

  const teamRed = payload.tenants.find(
    (tenant) => tenant.tenantId === "team-red",
  );
  assert.ok(teamRed);
  assert.equal(teamRed.traceCount, 2);
  assert.equal(teamRed.projects[0].projectId, "billing");
  assert.deepEqual(teamRed.projects[0].environments, ["prod", "staging"]);
});
