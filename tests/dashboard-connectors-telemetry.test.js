import test from "node:test";
import assert from "node:assert/strict";
import { DevTraceKitCore } from "../src/devtracekit/core.js";
import { createDashboardServer } from "../src/devtracekit/dashboard.js";

async function createTelemetryServer() {
  const core = new DevTraceKitCore({ maxTraces: 100 });
  const connectors = {
    docker: {
      getTelemetry: async () => ({
        ok: true,
        available: true,
        connector: "docker",
        mode: "telemetry",
        resourceCount: 2,
        signals: [
          {
            type: "container-lifecycle",
            name: "api",
            status: "ok",
            metadata: { image: "node:20", state: "running", runningFor: "2h" },
          },
          {
            type: "container-metric",
            name: "api",
            status: "ok",
            metadata: { cpuPercent: "0.50%", memoryUsage: "120MiB / 2GiB" },
          },
          {
            type: "container-log",
            name: "api",
            status: "warn",
            metadata: { warningLines: 1, errorLines: 1 },
          },
        ],
      }),
    },
    kubernetes: {
      getTelemetry: async () => ({
        ok: true,
        available: true,
        connector: "kubernetes",
        mode: "telemetry",
        resourceCount: 3,
        signals: [
          {
            type: "service",
            name: "default/checkout-svc",
            status: "ok",
            metadata: { type: "ClusterIP", ports: "80/TCP" },
          },
          {
            type: "rollout",
            name: "default/checkout-api",
            status: "warn",
            metadata: { rolloutStatus: "progressing" },
          },
          {
            type: "pod-log",
            name: "default/checkout-api-123",
            status: "warn",
            metadata: { warningLines: 2, errorLines: 1 },
          },
        ],
      }),
    },
    ecs: {
      getTelemetry: async () => ({
        ok: true,
        available: true,
        connector: "ecs",
        mode: "telemetry",
        resourceCount: 4,
        signals: [
          {
            type: "service",
            name: "devtracekit-a/checkout-api",
            status: "ok",
            metadata: { desiredCount: 3, runningCount: 3 },
          },
          {
            type: "task",
            name: "devtracekit-a/task-1",
            status: "ok",
            metadata: { launchType: "FARGATE", cpu: "256" },
          },
          {
            type: "deployment",
            name: "devtracekit-a/checkout-api:ecs-svc/123",
            status: "warn",
            metadata: { rolloutState: "IN_PROGRESS" },
          },
          {
            type: "service-event",
            name: "devtracekit-a/checkout-api",
            status: "info",
            metadata: { message: "service reached steady state" },
          },
        ],
      }),
    },
    nomad: {
      getTelemetry: async () => ({
        ok: true,
        available: true,
        connector: "nomad",
        mode: "telemetry",
        resourceCount: 4,
        signals: [
          {
            type: "job",
            name: "default/checkout",
            status: "ok",
            metadata: { status: "running", type: "service" },
          },
          {
            type: "allocation",
            name: "default/checkout:alloc-1234",
            status: "ok",
            metadata: { clientStatus: "running", desiredStatus: "run" },
          },
          {
            type: "deployment",
            name: "default/checkout:deploy-1",
            status: "warn",
            metadata: { status: "running" },
          },
          {
            type: "deployment-event",
            name: "default/checkout",
            status: "info",
            metadata: { statusDescription: "Deployment is progressing" },
          },
        ],
      }),
    },
  };

  const dashboard = createDashboardServer(core, connectors, {
    dashboardPort: 0,
  });
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

test("connector telemetry endpoint returns normalized signals", async (t) => {
  const server = await createTelemetryServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(
    `${server.baseUrl}/api/connectors/docker/telemetry`,
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.connector, "docker");
  assert.equal(payload.mode, "telemetry");
  assert.equal(payload.signals.length, 3);
  assert.equal(payload.signals[0].name, "api");
  const types = payload.signals.map((signal) => signal.type).sort();
  assert.deepEqual(types, [
    "container-lifecycle",
    "container-log",
    "container-metric",
  ]);
});

test("kubernetes telemetry exposes rollout/service/log signals", async (t) => {
  const server = await createTelemetryServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(
    `${server.baseUrl}/api/connectors/kubernetes/telemetry`,
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.connector, "kubernetes");
  const types = payload.signals.map((signal) => signal.type).sort();
  assert.deepEqual(types, ["pod-log", "rollout", "service"]);
});

test("ecs telemetry exposes service/task/deployment/event signals", async (t) => {
  const server = await createTelemetryServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(
    `${server.baseUrl}/api/connectors/ecs/telemetry`,
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.connector, "ecs");
  const types = payload.signals.map((signal) => signal.type).sort();
  assert.deepEqual(types, ["deployment", "service", "service-event", "task"]);
});

test("nomad telemetry exposes job/allocation/deployment/event signals", async (t) => {
  const server = await createTelemetryServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(
    `${server.baseUrl}/api/connectors/nomad/telemetry`,
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.connector, "nomad");
  const types = payload.signals.map((signal) => signal.type).sort();
  assert.deepEqual(types, [
    "allocation",
    "deployment",
    "deployment-event",
    "job",
  ]);
});

test("connector collect ingests telemetry into scoped traces", async (t) => {
  const server = await createTelemetryServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(`${server.baseUrl}/api/connectors/collect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devtracekit-tenant-id": "team-ops",
      "x-devtracekit-project-id": "platform",
      "x-devtracekit-environment": "prod",
    },
    body: JSON.stringify({
      connector: "docker",
      serviceName: "ops-collector",
    }),
  });

  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.connector, "docker");
  assert.equal(payload.ingestedSignals, 3);
  assert.equal(payload.tenantId, "team-ops");

  const traces = server.core.listTraces({
    tenantId: "team-ops",
    projectId: "platform",
    environment: "prod",
  });
  assert.equal(traces.length, 1);
  assert.equal(traces[0].service, "ops-collector");
  assert.equal(traces[0].method, "CONNECTOR");
  assert.ok(traces[0].events.length >= 3);
  assert.equal(traces[0].events[0].type, "connector");
});

test("connector collect rejects missing connector name", async (t) => {
  const server = await createTelemetryServer();
  t.after(async () => {
    await server.close();
  });

  const response = await fetch(`${server.baseUrl}/api/connectors/collect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ serviceName: "ops-collector" }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "connector_required");
});
