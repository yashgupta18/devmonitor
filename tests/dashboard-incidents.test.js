import test from "node:test";
import assert from "node:assert/strict";
import { DevScopeCore } from "../src/devscope/core.js";
import { createDashboardServer } from "../src/devscope/dashboard.js";

async function createIncidentServer() {
  const core = new DevScopeCore({ maxTraces: 200 });
  const dashboard = createDashboardServer(core, {}, { dashboardPort: 0 });

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

test("incident correlation endpoint returns cross-service relationships", async (t) => {
  const server = await createIncidentServer();
  t.after(async () => {
    await server.close();
  });

  const traceId = "ffeeddccbbaa99887766554433221100";
  server.core.instrument.otelSpan(
    {
      traceId,
      spanId: "root",
      parentSpanId: "",
      name: "http.checkout",
      statusCode: 2,
      status: "error",
      attributes: {
        "http.method": "POST",
        "http.route": "/checkout",
        "http.status_code": 500,
      },
      startTimeMs: Date.now() - 30,
      endTimeMs: Date.now() - 10,
    },
    {
      serviceName: "edge-api",
      tenantId: "team-a",
      projectId: "commerce",
      environment: "prod",
    },
  );

  server.core.instrument.otelSpan(
    {
      traceId,
      spanId: "child",
      parentSpanId: "root",
      name: "rpc.payment",
      statusCode: 2,
      status: "error",
      attributes: {
        "peer.service": "payments-api",
      },
      startTimeMs: Date.now() - 20,
      endTimeMs: Date.now() - 5,
    },
    {
      serviceName: "edge-api",
      tenantId: "team-a",
      projectId: "commerce",
      environment: "prod",
    },
  );

  const response = await fetch(`${server.baseUrl}/api/incidents/correlate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devscope-tenant-id": "team-a",
      "x-devscope-project-id": "commerce",
      "x-devscope-environment": "prod",
    },
    body: JSON.stringify({
      incident: "payment failures",
      limit: 100,
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.ok(payload.candidateTraceCount >= 1);
  assert.ok(payload.correlatedTraceCount >= 1);
  assert.ok(
    payload.impactedServices.some((service) => service.service === "edge-api"),
  );
  assert.ok(
    payload.impactedServices.some(
      (service) => service.service === "payments-api",
    ),
  );
  assert.ok(payload.relationships.length >= 1);
});
