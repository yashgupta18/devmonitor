import test from "node:test";
import assert from "node:assert/strict";
import { DevScopeCore } from "../src/devscope/core.js";
import { createDashboardServer } from "../src/devscope/dashboard.js";

async function createServer() {
  const core = new DevScopeCore({ maxTraces: 100 });
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

async function ingestSpan(
  baseUrl,
  {
    tenantId,
    projectId,
    environment,
    serviceName,
    traceId,
    route = "/checkout",
  },
) {
  return fetch(`${baseUrl}/api/ingest/otel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devscope-tenant-id": tenantId,
      "x-devscope-project-id": projectId,
      "x-devscope-environment": environment,
    },
    body: JSON.stringify({
      serviceName,
      span: {
        traceId,
        spanId: `${traceId}-span`,
        name: "http.request",
        attributes: {
          "http.method": "GET",
          "http.route": route,
          "http.status_code": 200,
        },
      },
    }),
  });
}

test("services endpoint groups discovered services by environment", async (t) => {
  const server = await createServer();
  t.after(async () => {
    await server.close();
  });

  const a = await ingestSpan(server.baseUrl, {
    tenantId: "team-a",
    projectId: "commerce",
    environment: "prod",
    serviceName: "checkout-api",
    traceId: "svc-1",
  });
  const b = await ingestSpan(server.baseUrl, {
    tenantId: "team-a",
    projectId: "commerce",
    environment: "staging",
    serviceName: "checkout-api",
    traceId: "svc-2",
  });
  const c = await ingestSpan(server.baseUrl, {
    tenantId: "team-a",
    projectId: "commerce",
    environment: "prod",
    serviceName: "catalog-api",
    traceId: "svc-3",
    route: "/catalog",
  });

  assert.equal(a.status, 202);
  assert.equal(b.status, 202);
  assert.equal(c.status, 202);

  const response = await fetch(`${server.baseUrl}/api/services`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.totalServices, 3);
  assert.equal(payload.environments.length, 2);

  const prod = payload.environments.find((item) => item.environment === "prod");
  assert.ok(prod);
  assert.equal(prod.serviceCount, 2);

  const names = prod.services.map((service) => service.serviceId);
  assert.deepEqual(names, ["catalog-api", "checkout-api"]);
});

test("services endpoint supports scope filters", async (t) => {
  const server = await createServer();
  t.after(async () => {
    await server.close();
  });

  const a = await ingestSpan(server.baseUrl, {
    tenantId: "team-a",
    projectId: "commerce",
    environment: "prod",
    serviceName: "checkout-api",
    traceId: "svc-filter-1",
  });
  const b = await ingestSpan(server.baseUrl, {
    tenantId: "team-b",
    projectId: "commerce",
    environment: "prod",
    serviceName: "checkout-api",
    traceId: "svc-filter-2",
  });

  assert.equal(a.status, 202);
  assert.equal(b.status, 202);

  const filtered = await fetch(
    `${server.baseUrl}/api/services?tenantId=team-b&projectId=commerce&environment=prod`,
  );
  assert.equal(filtered.status, 200);

  const payload = await filtered.json();
  assert.equal(payload.totalServices, 1);
  assert.equal(payload.services[0].tenantId, "team-b");
  assert.equal(payload.services[0].environment, "prod");
});
