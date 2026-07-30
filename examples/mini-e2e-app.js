import express from "express";
import crypto from "node:crypto";
import { createDevMonitor } from "../src/devmonitor/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

export async function startMiniE2eApp(options = {}) {
  const dashboardPort = Number(
    options.dashboardPort ?? process.env.DEVMONITOR_DASHBOARD_PORT ?? 4318,
  );
  const appPort = Number(
    options.appPort ?? process.env.DEVMONITOR_MINI_APP_PORT ?? 3050,
  );

  const scope = {
    tenantId: process.env.DEVMONITOR_TENANT_ID ?? "team-mini",
    projectId: process.env.DEVMONITOR_PROJECT_ID ?? "storefront",
    environment: process.env.DEVMONITOR_ENVIRONMENT ?? "prod",
  };

  const devmonitor = createDevMonitor({
    dashboardPort,
    defaultTenantId: scope.tenantId,
    defaultProjectId: scope.projectId,
    defaultEnvironment: scope.environment,
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(devmonitor.middleware("mini-gateway", scope));

  const appBase = `http://127.0.0.1:${appPort}`;
  const dashboardBase = `http://127.0.0.1:${dashboardPort}`;

  async function callDashboard(path, optionsOverride = {}) {
    const extraHeaders =
      optionsOverride.headers && typeof optionsOverride.headers === "object"
        ? optionsOverride.headers
        : undefined;
    const headers = {
      "content-type": "application/json",
      "x-devmonitor-tenant-id": scope.tenantId,
      "x-devmonitor-project-id": scope.projectId,
      "x-devmonitor-environment": scope.environment,
      ...extraHeaders,
    };

    return fetch(`${dashboardBase}${path}`, {
      method: optionsOverride.method ?? "GET",
      headers,
      body:
        optionsOverride.body !== undefined
          ? JSON.stringify(optionsOverride.body)
          : undefined,
    });
  }

  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>devmonitor Mini E2E App</title>
    <style>
      body {
        font-family: "Segoe UI", sans-serif;
        margin: 24px;
        color: #1f2937;
        background: #f8fafc;
      }
      .card {
        max-width: 900px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 20px;
      }
      h1 {
        margin-top: 0;
      }
      code {
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 6px;
      }
      ul {
        line-height: 1.6;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
      }
      button {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 8px 12px;
        background: #0f766e;
        color: #fff;
        cursor: pointer;
      }
      pre {
        background: #0f172a;
        color: #e2e8f0;
        padding: 12px;
        border-radius: 8px;
        overflow: auto;
      }
      a {
        color: #0f766e;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>devmonitor Mini E2E App</h1>
      <p>
        This app is running on <code>http://localhost:${appPort}</code> and the
        dashboard is at <a href="http://localhost:${dashboardPort}" target="_blank" rel="noreferrer">http://localhost:${dashboardPort}</a>.
      </p>
      <p>Scope: <code>${scope.tenantId}/${scope.projectId}/${scope.environment}</code></p>

      <ul>
        <li><a href="/health" target="_blank" rel="noreferrer">GET /health</a></li>
        <li><a href="/catalog" target="_blank" rel="noreferrer">GET /catalog</a></li>
        <li><a href="/checkout" target="_blank" rel="noreferrer">GET /checkout</a></li>
        <li><a href="/checkout?slow=1" target="_blank" rel="noreferrer">GET /checkout?slow=1</a></li>
        <li><a href="/checkout?fail=1&slow=1" target="_blank" rel="noreferrer">GET /checkout?fail=1&slow=1</a></li>
      </ul>

      <div class="actions">
        <button id="runScenario">Run Full Scenario</button>
        <button id="simulateDeploy">Simulate Deploy Event</button>
      </div>

      <h3>Last Action Result</h3>
      <pre id="result">No action run yet.</pre>
    </div>

    <script>
      async function run(path, method = "POST") {
        const response = await fetch(path, { method });
        const payload = await response.json();
        document.getElementById("result").textContent = JSON.stringify(payload, null, 2);
      }

      document
        .getElementById("runScenario")
        .addEventListener("click", () => run("/scenario/full"));
      document
        .getElementById("simulateDeploy")
        .addEventListener("click", () => run("/simulate/deploy"));
    </script>
  </body>
</html>`);
  });

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, app: "mini-e2e-app" });
  });

  app.get("/catalog", async (req, res) => {
    const traceId = req.devmonitor.traceId;
    const duration = randomInt(6, 20);
    await sleep(duration);

    devmonitor.instrument.sql(traceId, {
      query: "SELECT id, price FROM catalog WHERE active = true LIMIT 10",
      durationMs: duration,
      status: "ok",
    });

    req.devmonitor.addEvent({
      type: "otel",
      name: "rpc.catalog",
      durationMs: randomInt(10, 25),
      status: "ok",
      metadata: {
        sourceService: "mini-gateway",
        peerService: "catalog-service",
        cluster: "prod-east",
        region: "us-east-1",
        namespace: "catalog",
      },
    });

    res.json({ ok: true, traceId, items: 10 });
  });

  app.get("/checkout", async (req, res) => {
    const traceId = req.devmonitor.traceId;
    const shouldFail = String(req.query.fail ?? "0") === "1";
    const shouldSlow = String(req.query.slow ?? "0") === "1";

    await sleep(shouldSlow ? randomInt(180, 320) : randomInt(25, 80));

    devmonitor.instrument.redis(traceId, {
      command: "GET",
      key: "cart:user:42",
      durationMs: randomInt(4, 18),
      status: "ok",
    });

    devmonitor.instrument.sql(traceId, {
      query: "SELECT id, status, total FROM orders WHERE user_id = $1",
      durationMs: shouldSlow ? randomInt(90, 210) : randomInt(25, 70),
      status: shouldFail ? "error" : "ok",
    });

    devmonitor.instrument.kafka(traceId, {
      topic: "checkout-events",
      action: "publish",
      durationMs: randomInt(8, 24),
      status: shouldFail ? "error" : "ok",
    });

    req.devmonitor.addEvent({
      type: "otel",
      name: "rpc.payments",
      durationMs: shouldSlow ? randomInt(140, 260) : randomInt(30, 90),
      status: shouldFail ? "error" : "ok",
      metadata: {
        sourceService: "mini-gateway",
        peerService: "payments-service",
        cluster: "prod-west",
        region: "us-west-2",
        namespace: "payments",
      },
    });

    req.devmonitor.addEvent({
      type: "otel",
      name: "rpc.inventory",
      durationMs: randomInt(15, 60),
      status: "ok",
      metadata: {
        sourceService: "mini-gateway",
        peerService: "inventory-service",
        cluster: "prod-east",
        region: "us-east-1",
        namespace: "inventory",
      },
    });

    if (shouldFail) {
      res.status(500).json({
        ok: false,
        error: "checkout_failed",
        traceId,
      });
      return;
    }

    res.json({ ok: true, traceId });
  });

  app.post("/simulate/deploy", async (req, res) => {
    const service =
      typeof req.body?.service === "string" &&
      req.body.service.trim().length > 0
        ? req.body.service.trim()
        : "mini-gateway";

    const eventResponse = await callDashboard("/api/gitops/events", {
      method: "POST",
      body: {
        id: `deploy-${Date.now()}`,
        source: "argocd",
        service,
        commitSha: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
        author: "mini-e2e-bot",
        action: "deploy",
        status: "completed",
        timestampMs: Date.now(),
        metadata: {
          rollout: "canary",
        },
      },
    });

    const payload = await eventResponse.json();
    res.status(eventResponse.status).json(payload);
  });

  app.post("/scenario/full", async (_req, res) => {
    const summary = {
      baselineRequests: 0,
      canaryRequests: 0,
      failedRequests: 0,
      deployEventCreated: false,
      connectorCollectAttempts: 0,
    };

    for (let index = 0; index < 12; index += 1) {
      await fetch(`${appBase}/checkout`);
      summary.baselineRequests += 1;
    }

    const deploy = await fetch(`${appBase}/simulate/deploy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ service: "mini-gateway" }),
    });
    summary.deployEventCreated = deploy.ok;

    for (let index = 0; index < 10; index += 1) {
      const shouldFail = index % 3 === 0;
      const result = await fetch(
        `${appBase}/checkout?slow=1&fail=${shouldFail ? "1" : "0"}`,
      );
      summary.canaryRequests += 1;
      if (!result.ok) {
        summary.failedRequests += 1;
      }
    }

    for (let index = 0; index < 8; index += 1) {
      await fetch(`${appBase}/catalog`);
    }

    const heartbeat = await callDashboard("/api/cluster/heartbeat", {
      method: "POST",
      body: {
        instanceId: `mini-app-${process.pid}`,
        role: "api",
        version: "mini-e2e",
        capacity: 1,
        environment: scope.environment,
      },
    });

    for (const connector of ["docker", "kubernetes", "ecs", "nomad"]) {
      summary.connectorCollectAttempts += 1;
      await callDashboard("/api/connectors/collect", {
        method: "POST",
        body: {
          connector,
          serviceName: "mini-observer",
        },
      });
    }

    const [risk, cost, postmortem, replay] = await Promise.all([
      callDashboard(
        "/api/deployments/risk?limit=5&baselineMinutes=30&canaryMinutes=20",
      ),
      callDashboard("/api/cost-capacity?windowMinutes=60"),
      callDashboard("/api/incidents/postmortem?incident=checkout"),
      callDashboard("/api/incidents/replay?incident=checkout"),
    ]);

    const [riskPayload, costPayload, postmortemPayload, replayPayload] =
      await Promise.all([
        risk.json(),
        cost.json(),
        postmortem.json(),
        replay.json(),
      ]);

    res.json({
      ok: true,
      scope,
      summary,
      clusterHeartbeatStatus: heartbeat.status,
      deploymentRisk: {
        analyzedDeployments: riskPayload.analyzedDeployments,
      },
      costCapacity: {
        serviceCount: costPayload.serviceCount,
        totalEstimatedCostUsd: costPayload.totalEstimatedCostUsd,
      },
      postmortem: {
        correlatedTraceCount:
          postmortemPayload.summary?.correlatedTraceCount ?? 0,
      },
      replay: {
        frameCount: replayPayload.frameCount ?? 0,
      },
    });
  });

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: "route_not_found",
      method: req.method,
      path: req.path,
      hint: "Use one of the documented mini app endpoints.",
      endpoints: [
        "GET /",
        "GET /health",
        "GET /catalog",
        "GET /checkout",
        "GET /checkout?slow=1",
        "GET /checkout?fail=1&slow=1",
        "POST /simulate/deploy",
        "POST /scenario/full",
      ],
    });
  });

  app.listen(appPort, () => {
    console.log(`[mini-e2e] dashboard: http://localhost:${dashboardPort}`);
    console.log(`[mini-e2e] app: http://localhost:${appPort}`);
    console.log(`[mini-e2e] run full scenario:`);
    console.log(
      `[mini-e2e] curl -X POST http://localhost:${appPort}/scenario/full`,
    );
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await startMiniE2eApp();
  } catch (error) {
    console.error("[mini-e2e] failed to start", error);
    process.exit(1);
  }
}
