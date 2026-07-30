import test from "node:test";
import assert from "node:assert/strict";
import { DevScopeCore } from "../src/devscope/core.js";
import { createDashboardServer } from "../src/devscope/dashboard.js";

async function createServer() {
  const core = new DevScopeCore({ maxTraces: 300 });
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

test("deployment risk, cost-capacity, and postmortem replay endpoints return expected structures", async (t) => {
  const server = await createServer();
  t.after(async () => {
    await server.close();
  });

  const deployTs = Date.now() - 90_000;
  const gitopsEvent = await fetch(`${server.baseUrl}/api/gitops/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devscope-tenant-id": "team-phase6",
      "x-devscope-project-id": "checkout",
      "x-devscope-environment": "prod",
    },
    body: JSON.stringify({
      id: "phase6-deploy-1",
      source: "argocd",
      service: "checkout-service",
      commitSha: "c0ffee1234567890",
      author: "release-bot",
      action: "deploy",
      status: "completed",
      timestampMs: deployTs,
    }),
  });
  assert.equal(gitopsEvent.status, 202);

  async function ingestSpan(traceId, statusCode, startOffsetMs, endOffsetMs) {
    const response = await fetch(`${server.baseUrl}/api/ingest/otel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-devscope-tenant-id": "team-phase6",
        "x-devscope-project-id": "checkout",
        "x-devscope-environment": "prod",
      },
      body: JSON.stringify({
        serviceName: "checkout-service",
        span: {
          traceId,
          spanId: `${traceId}-span`,
          name: "http.request",
          startTimeMs: deployTs + startOffsetMs,
          endTimeMs: deployTs + endOffsetMs,
          statusCode,
          attributes: {
            "http.method": "GET",
            "http.route": "/checkout",
            "http.status_code": statusCode,
          },
        },
      }),
    });

    assert.equal(response.status, 202);
  }

  await ingestSpan("phase6-base-1", 200, -50_000, -49_500);
  await ingestSpan("phase6-base-2", 200, -40_000, -39_600);
  await ingestSpan("phase6-canary-1", 500, 2_000, 2_800);
  await ingestSpan("phase6-canary-2", 500, 3_000, 4_000);
  await ingestSpan("phase6-canary-3", 200, 5_000, 6_400);

  const riskResponse = await fetch(
    `${server.baseUrl}/api/deployments/risk?tenantId=team-phase6&projectId=checkout&environment=prod&service=checkout-service&baselineMinutes=30&canaryMinutes=20&minCanarySamples=2`,
  );
  assert.equal(riskResponse.status, 200);
  const riskPayload = await riskResponse.json();
  assert.equal(riskPayload.analyzedDeployments, 1);
  assert.ok(riskPayload.deployments[0].riskScore >= 0);
  assert.ok(typeof riskPayload.deployments[0].canaryStatus === "string");

  const costResponse = await fetch(
    `${server.baseUrl}/api/cost-capacity?tenantId=team-phase6&projectId=checkout&environment=prod&windowMinutes=120`,
  );
  assert.equal(costResponse.status, 200);
  const costPayload = await costResponse.json();
  assert.ok(costPayload.serviceCount >= 1);
  assert.ok(costPayload.services[0].estimatedCostUsd >= 0);

  const postmortemResponse = await fetch(
    `${server.baseUrl}/api/incidents/postmortem?tenantId=team-phase6&projectId=checkout&environment=prod&incident=checkout`,
  );
  assert.equal(postmortemResponse.status, 200);
  const postmortemPayload = await postmortemResponse.json();
  assert.equal(postmortemPayload.incident, "checkout");
  assert.ok(Array.isArray(postmortemPayload.timeline));
  assert.ok(typeof postmortemPayload.markdown === "string");

  const replayResponse = await fetch(
    `${server.baseUrl}/api/incidents/replay?tenantId=team-phase6&projectId=checkout&environment=prod&incident=checkout`,
  );
  assert.equal(replayResponse.status, 200);
  const replayPayload = await replayResponse.json();
  assert.ok(replayPayload.frameCount >= 0);
  assert.ok(Array.isArray(replayPayload.frames));
});
