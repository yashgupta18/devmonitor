import test from "node:test";
import assert from "node:assert/strict";
import { DevScopeCore } from "../src/devscope/core.js";
import { createDashboardServer } from "../src/devscope/dashboard.js";

async function createServer() {
  const core = new DevScopeCore({ maxTraces: 200 });
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

test("gitops events can be recorded and correlated to trace impact", async (t) => {
  const server = await createServer();
  t.after(async () => {
    await server.close();
  });

  const eventTs = Date.now() - 500;
  const record = await fetch(`${server.baseUrl}/api/gitops/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devscope-tenant-id": "team-dev",
      "x-devscope-project-id": "checkout",
      "x-devscope-environment": "prod",
    },
    body: JSON.stringify({
      id: "deploy-1",
      source: "argocd",
      service: "checkout-service",
      action: "deploy",
      status: "completed",
      commitSha: "abc123def456",
      author: "platform-bot",
      timestampMs: eventTs,
      metadata: { revision: "r42" },
    }),
  });
  assert.equal(record.status, 202);

  const ingest = await fetch(`${server.baseUrl}/api/ingest/otel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devscope-tenant-id": "team-dev",
      "x-devscope-project-id": "checkout",
      "x-devscope-environment": "prod",
    },
    body: JSON.stringify({
      serviceName: "checkout-service",
      span: {
        traceId: "gitops-trace-1",
        spanId: "gitops-span-1",
        name: "http.request",
        startTimeMs: eventTs + 100,
        endTimeMs: eventTs + 300,
        statusCode: 500,
        attributes: {
          "http.method": "GET",
          "http.route": "/checkout",
          "http.status_code": 500,
        },
      },
    }),
  });
  assert.equal(ingest.status, 202);

  const listResponse = await fetch(
    `${server.baseUrl}/api/gitops/events?tenantId=team-dev&projectId=checkout&environment=prod`,
  );
  assert.equal(listResponse.status, 200);
  const listPayload = await listResponse.json();
  assert.equal(listPayload.events.length, 1);
  assert.equal(listPayload.events[0].id, "deploy-1");

  const correlationResponse = await fetch(
    `${server.baseUrl}/api/gitops/correlations?tenantId=team-dev&projectId=checkout&environment=prod&windowMinutes=30`,
  );
  assert.equal(correlationResponse.status, 200);
  const correlationPayload = await correlationResponse.json();
  assert.equal(correlationPayload.analyzedEvents, 1);
  assert.equal(correlationPayload.correlations[0].event.id, "deploy-1");
  assert.ok(correlationPayload.correlations[0].impact.traceCount >= 1);
  assert.equal(correlationPayload.correlations[0].risk, "high");
});
