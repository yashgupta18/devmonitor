import assert from "node:assert/strict";
import test from "node:test";
import { DevTraceKitCore } from "../src/devtracekit/core.js";
import { createDashboardServer } from "../src/devtracekit/dashboard.js";

async function startServer(core) {
  const dashboard = createDashboardServer(core, {}, { dashboardPort: 0 });
  const address = dashboard.server.address();
  const port = typeof address === "object" && address ? address.port : 4318;

  return {
    port,
    async close() {
      await new Promise((resolve, reject) => {
        dashboard.server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("GET /api/traces filters by service, cluster, namespace, and environment", async () => {
  const core = new DevTraceKitCore();

  const traceA = core.createTrace({
    method: "GET",
    path: "/checkout",
    service: "checkout-service",
    tenantId: "team-a",
    projectId: "shop",
    environment: "prod",
    startTimeMs: Date.now() - 100,
  });
  core.addEvent(traceA.traceId, {
    type: "k8s",
    name: "pod",
    status: "ok",
    metadata: {
      namespace: "payments",
      cluster: "prod-east",
      sourceService: "checkout-service",
      peerService: "payments-service",
    },
  });
  core.finishTrace(traceA.traceId, {
    statusCode: 200,
    endTimeMs: Date.now() - 50,
  });

  const traceB = core.createTrace({
    method: "GET",
    path: "/inventory",
    service: "inventory-service",
    tenantId: "team-a",
    projectId: "shop",
    environment: "staging",
    startTimeMs: Date.now() - 90,
  });
  core.addEvent(traceB.traceId, {
    type: "k8s",
    name: "pod",
    status: "ok",
    metadata: {
      namespace: "inventory",
      cluster: "staging-west",
      sourceService: "inventory-service",
      peerService: "catalog-service",
    },
  });
  core.finishTrace(traceB.traceId, {
    statusCode: 200,
    endTimeMs: Date.now() - 40,
  });

  const server = await startServer(core);

  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;

    const serviceResponse = await fetch(
      `${baseUrl}/api/traces?service=payments-service`,
    );
    assert.equal(serviceResponse.status, 200);
    const servicePayload = await serviceResponse.json();
    assert.equal(servicePayload.traces.length, 1);
    assert.equal(servicePayload.traces[0].path, "/checkout");

    const clusterResponse = await fetch(
      `${baseUrl}/api/traces?cluster=staging-west`,
    );
    assert.equal(clusterResponse.status, 200);
    const clusterPayload = await clusterResponse.json();
    assert.equal(clusterPayload.traces.length, 1);
    assert.equal(clusterPayload.traces[0].path, "/inventory");

    const namespaceResponse = await fetch(
      `${baseUrl}/api/traces?namespace=payments`,
    );
    assert.equal(namespaceResponse.status, 200);
    const namespacePayload = await namespaceResponse.json();
    assert.equal(namespacePayload.traces.length, 1);
    assert.equal(namespacePayload.traces[0].path, "/checkout");

    const envResponse = await fetch(`${baseUrl}/api/traces?environment=prod`);
    assert.equal(envResponse.status, 200);
    const envPayload = await envResponse.json();
    assert.equal(envPayload.traces.length, 1);
    assert.equal(envPayload.traces[0].path, "/checkout");

    const combinedResponse = await fetch(
      `${baseUrl}/api/traces?service=checkout-service&cluster=prod-east&namespace=payments&environment=prod`,
    );
    assert.equal(combinedResponse.status, 200);
    const combinedPayload = await combinedResponse.json();
    assert.equal(combinedPayload.traces.length, 1);
    assert.equal(combinedPayload.traces[0].service, "checkout-service");
    assert.equal(combinedPayload.stats.total, 1);
  } finally {
    await server.close();
  }
});
