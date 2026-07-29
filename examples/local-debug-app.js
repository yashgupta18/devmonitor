import express from "express";
import crypto from "node:crypto";
import { createDevScope } from "../src/devscope/index.js";
import { createDevScopeSdk } from "../packages/devscope-sdk/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fakeSqlQuery(devscope, traceId) {
  const duration = crypto.randomInt(25, 85);
  await sleep(duration);
  devscope.instrument.sql(traceId, {
    query: "SELECT id, status, total FROM orders WHERE user_id = $1",
    durationMs: duration,
  });
}

async function fakeRedisLookup(devscope, traceId) {
  const duration = crypto.randomInt(5, 20);
  await sleep(duration);
  devscope.instrument.redis(traceId, {
    command: "GET",
    key: "cart:user:123",
    durationMs: duration,
  });
}

async function fakeKafkaPublish(devscope, traceId) {
  const duration = crypto.randomInt(10, 30);
  await sleep(duration);
  devscope.instrument.kafka(traceId, {
    topic: "checkout-events",
    action: "publish",
    durationMs: duration,
  });
}

async function fakeBackgroundJob(devscope, traceId) {
  const startDuration = crypto.randomInt(4, 14);
  await sleep(startDuration);
  devscope.instrument.job(traceId, {
    queue: "email",
    jobName: "send-order-confirmation",
    action: "enqueue",
    durationMs: startDuration,
  });

  const completeDuration = crypto.randomInt(15, 45);
  await sleep(completeDuration);
  devscope.instrument.job(traceId, {
    queue: "email",
    jobName: "send-order-confirmation",
    action: "complete",
    durationMs: completeDuration,
  });
}

export async function startExampleApp(options = {}) {
  const dashboardPort = options.dashboardPort ?? 4318;
  const appPort = options.appPort ?? 3000;
  const devscope = createDevScope({ dashboardPort });
  const sdk = createDevScopeSdk({
    core: devscope.core,
    serviceName: "example-checkout-service",
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(devscope.middleware("example-checkout-service"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/checkout", async (req, res) => {
    const traceId = req.devscope.traceId;

    try {
      await fakeRedisLookup(devscope, traceId);
      await fakeSqlQuery(devscope, traceId);
      await fakeKafkaPublish(devscope, traceId);
      await fakeBackgroundJob(devscope, traceId);

      res.json({
        ok: true,
        message: "Checkout flow completed",
        traceId,
      });
    } catch (error) {
      req.devscope.addEvent({
        type: "error",
        name: "checkout_flow_error",
        status: "error",
        metadata: {
          message: error.message,
        },
      });
      res.status(500).json({ ok: false, traceId, error: error.message });
    }
  });

  app.get("/load", async (req, res) => {
    const requests = Number(req.query.requests ?? 5);
    const origin = `http://localhost:${appPort}`;

    await Promise.all(
      Array.from({ length: requests }, async () => {
        await fetch(`${origin}/checkout`);
      }),
    );

    res.json({ ok: true, generated: requests });
  });

  app.get("/otel-checkout", async (_req, res) => {
    let rootTraceId = "";

    try {
      await sdk.runInSpan(
        "http.checkout",
        {
          attributes: {
            "http.method": "GET",
            "http.route": "/otel-checkout",
          },
          statusCode: 200,
        },
        async (rootSpan) => {
          rootTraceId = rootSpan.spanContext().traceId;

          await sdk.runInSpan(
            "redis.get",
            {
              attributes: {
                "db.system": "redis",
                "db.operation": "GET",
                "db.redis.key": "cart:user:123",
              },
            },
            async () => {
              await sleep(8);
            },
          );

          await sdk.runInSpan(
            "sql.select",
            {
              attributes: {
                "db.system": "postgresql",
                "db.statement": "SELECT id, total FROM orders WHERE id = $1",
              },
            },
            async () => {
              await sleep(15);
            },
          );

          await sdk.runInSpan(
            "kafka.publish",
            {
              attributes: {
                "messaging.system": "kafka",
                "messaging.operation": "publish",
                "messaging.destination.name": "checkout-events",
              },
            },
            async () => {
              await sleep(10);
            },
          );
        },
      );

      res.json({ ok: true, traceId: rootTraceId });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.listen(appPort, () => {
    console.log(
      `[devscope] example app running on http://localhost:${appPort}`,
    );
    console.log(
      `[devscope] test endpoint: http://localhost:${appPort}/checkout`,
    );
    console.log(
      `[devscope] otel endpoint: http://localhost:${appPort}/otel-checkout`,
    );
    console.log(`[devscope] dashboard: http://localhost:${dashboardPort}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await startExampleApp();
  } catch (error) {
    console.error("[devscope] example app failed", error);
    process.exit(1);
  }
}
