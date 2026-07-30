#!/usr/bin/env node
import express from "express";
import { createDevScope } from "./devscope/index.js";
import { startExampleApp } from "../examples/local-debug-app.js";

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const rawRemoteKeys = String(process.env.DEVSCOPE_REMOTE_INGEST_KEYS ?? "");
  const remoteKeys = rawRemoteKeys
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const rawAuthKeys = String(process.env.DEVSCOPE_API_KEYS ?? "");
  const authKeys = rawAuthKeys
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [role, key] = entry.split(":");
      return {
        role: key ? role : "viewer",
        key: key ?? role,
        keyId: `key-${index + 1}`,
      };
    });

  return {
    command: argv[2],
    example: args.has("--example"),
    dashboardPort: Number(process.env.DEVSCOPE_DASHBOARD_PORT ?? 4318),
    appPort: Number(process.env.DEVSCOPE_APP_PORT ?? 3000),
    scope: {
      tenantId: process.env.DEVSCOPE_TENANT_ID,
      projectId: process.env.DEVSCOPE_PROJECT_ID,
      environment: process.env.DEVSCOPE_ENVIRONMENT,
    },
    remoteIngest:
      remoteKeys.length > 0
        ? {
            enabled: true,
            apiKeys: remoteKeys,
            rateLimitWindowMs: Number(
              process.env.DEVSCOPE_REMOTE_RATE_LIMIT_WINDOW_MS ?? 60_000,
            ),
            rateLimitMaxRequests: Number(
              process.env.DEVSCOPE_REMOTE_RATE_LIMIT_MAX_REQUESTS ?? 120,
            ),
            maxSpansPerRequest: Number(
              process.env.DEVSCOPE_REMOTE_MAX_SPANS_PER_REQUEST ?? 500,
            ),
          }
        : { enabled: false, apiKeys: [] },
    storageBackend: process.env.DEVSCOPE_STORAGE_BACKEND ?? "memory",
    traceStorePath: process.env.DEVSCOPE_TRACE_STORE_PATH,
    timeSeriesRetentionMinutes: Number(
      process.env.DEVSCOPE_TIMESERIES_RETENTION_MINUTES ?? 1440,
    ),
    security: {
      enabled: String(process.env.DEVSCOPE_AUTH_ENABLED ?? "false") === "true",
      apiKeys: authKeys,
      auditMaxEntries: Number(process.env.DEVSCOPE_AUDIT_MAX_ENTRIES ?? 5000),
    },
    alerting: {
      enabled:
        String(process.env.DEVSCOPE_ALERTING_ENABLED ?? "false") === "true",
      slackWebhookUrl: process.env.DEVSCOPE_SLACK_WEBHOOK_URL,
      pagerDutyWebhookUrl: process.env.DEVSCOPE_PAGERDUTY_WEBHOOK_URL,
      webhookUrl: process.env.DEVSCOPE_WEBHOOK_URL,
    },
    cluster: {
      enabled:
        String(process.env.DEVSCOPE_CLUSTER_ENABLED ?? "false") === "true",
      deploymentMode: process.env.DEVSCOPE_DEPLOYMENT_MODE ?? "single-node",
      ttlMs: Number(process.env.DEVSCOPE_CLUSTER_TTL_MS ?? 30_000),
    },
  };
}

async function startStandalone(options) {
  const devscope = createDevScope({
    dashboardPort: options.dashboardPort,
    defaultTenantId: options.scope.tenantId,
    defaultProjectId: options.scope.projectId,
    defaultEnvironment: options.scope.environment,
    remoteIngest: options.remoteIngest,
    storageBackend: options.storageBackend,
    traceStorePath: options.traceStorePath,
    timeSeriesRetentionMinutes: options.timeSeriesRetentionMinutes,
    security: options.security,
    alerting: options.alerting,
    cluster: options.cluster,
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(devscope.middleware("standalone-app", options.scope));

  app.get("/", (_req, res) => {
    res.json({
      message: "DevScope standalone app running",
      hint: "Use devscope start --example for full flow simulation",
    });
  });

  app.listen(options.appPort, () => {
    console.log(
      `[devscope] app running on http://localhost:${options.appPort}`,
    );
  });
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.command !== "start") {
    console.log("Usage: devscope start [--example]");
    process.exit(1);
  }

  if (options.example) {
    await startExampleApp({
      dashboardPort: options.dashboardPort,
      appPort: options.appPort,
      scope: options.scope,
      remoteIngest: options.remoteIngest,
      storageBackend: options.storageBackend,
      traceStorePath: options.traceStorePath,
      timeSeriesRetentionMinutes: options.timeSeriesRetentionMinutes,
      security: options.security,
      alerting: options.alerting,
      cluster: options.cluster,
    });
    return;
  }

  await startStandalone(options);
}

try {
  await main();
} catch (error) {
  console.error("[devscope] failed to start", error);
  process.exit(1);
}
