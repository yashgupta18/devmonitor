import test from "node:test";
import assert from "node:assert/strict";
import { DevTraceKitCore } from "../src/devtracekit/core.js";
import { createDashboardServer } from "../src/devtracekit/dashboard.js";

async function createServer() {
  const core = new DevTraceKitCore({ maxTraces: 100 });
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

test("federation endpoint summarizes clusters and regions from span metadata", async (t) => {
  const server = await createServer();
  t.after(async () => {
    await server.close();
  });

  const ingest = await fetch(`${server.baseUrl}/api/ingest/otel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devtracekit-environment": "prod",
      "x-devtracekit-tenant-id": "team-federation",
      "x-devtracekit-project-id": "platform",
    },
    body: JSON.stringify({
      serviceName: "gateway-service",
      spans: [
        {
          traceId: "fed-trace-1",
          spanId: "fed-root-1",
          name: "http.request",
          attributes: {
            "http.method": "GET",
            "http.route": "/checkout",
            "http.status_code": 200,
            "k8s.cluster.name": "cluster-east",
            "cloud.region": "us-east-1",
            "cloud.provider": "aws",
          },
        },
        {
          traceId: "fed-trace-1",
          spanId: "fed-child-1",
          parentSpanId: "fed-root-1",
          name: "rpc.call",
          attributes: {
            "peer.service": "payments-service",
            "k8s.cluster.name": "cluster-west",
            "cloud.region": "us-west-2",
            "cloud.provider": "aws",
          },
        },
      ],
    }),
  });

  assert.equal(ingest.status, 202);

  const response = await fetch(
    `${server.baseUrl}/api/federation?tenantId=team-federation&projectId=platform&environment=prod`,
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.clusterCount, 2);
  assert.equal(payload.regionCount, 2);
  assert.ok(payload.clusters.some((item) => item.cluster === "cluster-east"));
  assert.ok(payload.clusters.some((item) => item.cluster === "cluster-west"));
  assert.ok(payload.regions.some((item) => item.region === "us-east-1"));
  assert.ok(payload.regions.some((item) => item.region === "us-west-2"));
  assert.ok(payload.links.length >= 1);
});
