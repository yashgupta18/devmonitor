#!/usr/bin/env node
import express from "express";
import { createDevTraceKit } from "./devtracekit/index.js";
import { startExampleApp } from "../examples/local-debug-app.js";

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const rawRemoteKeys = String(process.env.DEVTRACEKIT_REMOTE_INGEST_KEYS ?? "");
  const remoteKeys = rawRemoteKeys
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const rawAuthKeys = String(process.env.DEVTRACEKIT_API_KEYS ?? "");
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
    dashboardPort: Number(process.env.DEVTRACEKIT_DASHBOARD_PORT ?? 4318),
    appPort: Number(process.env.DEVTRACEKIT_APP_PORT ?? 3000),
    scope: {
      tenantId: process.env.DEVTRACEKIT_TENANT_ID,
      projectId: process.env.DEVTRACEKIT_PROJECT_ID,
      environment: process.env.DEVTRACEKIT_ENVIRONMENT,
    },
    remoteIngest:
      remoteKeys.length > 0
        ? {
            enabled: true,
            apiKeys: remoteKeys,
            rateLimitWindowMs: Number(
              process.env.DEVTRACEKIT_REMOTE_RATE_LIMIT_WINDOW_MS ?? 60_000,
            ),
            rateLimitMaxRequests: Number(
              process.env.DEVTRACEKIT_REMOTE_RATE_LIMIT_MAX_REQUESTS ?? 120,
            ),
            maxSpansPerRequest: Number(
              process.env.DEVTRACEKIT_REMOTE_MAX_SPANS_PER_REQUEST ?? 500,
            ),
          }
        : { enabled: false, apiKeys: [] },
    storageBackend: process.env.DEVTRACEKIT_STORAGE_BACKEND ?? "memory",
    traceStorePath: process.env.DEVTRACEKIT_TRACE_STORE_PATH,
    timeSeriesRetentionMinutes: Number(
      process.env.DEVTRACEKIT_TIMESERIES_RETENTION_MINUTES ?? 1440,
    ),
    security: {
      enabled: String(process.env.DEVTRACEKIT_AUTH_ENABLED ?? "false") === "true",
      apiKeys: authKeys,
      auditMaxEntries: Number(process.env.DEVTRACEKIT_AUDIT_MAX_ENTRIES ?? 5000),
    },
    alerting: {
      enabled:
        String(process.env.DEVTRACEKIT_ALERTING_ENABLED ?? "false") === "true",
      slackWebhookUrl: process.env.DEVTRACEKIT_SLACK_WEBHOOK_URL,
      pagerDutyWebhookUrl: process.env.DEVTRACEKIT_PAGERDUTY_WEBHOOK_URL,
      webhookUrl: process.env.DEVTRACEKIT_WEBHOOK_URL,
    },
    cluster: {
      enabled:
        String(process.env.DEVTRACEKIT_CLUSTER_ENABLED ?? "false") === "true",
      deploymentMode: process.env.DEVTRACEKIT_DEPLOYMENT_MODE ?? "single-node",
      ttlMs: Number(process.env.DEVTRACEKIT_CLUSTER_TTL_MS ?? 30_000),
    },
  };
}

async function startStandalone(options) {
  const devtracekit = createDevTraceKit({
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
  app.use(devtracekit.middleware("standalone-app", options.scope));

  app.get("/", (_req, res) => {
    res.json({
      message: "DevTraceKit standalone app running",
      hint: "Use devtracekit start --example for full flow simulation",
    });
  });

  app.listen(options.appPort, () => {
    console.log(
      `[devtracekit] app running on http://localhost:${options.appPort}`,
    );
  });
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.command !== "start") {
    console.log("Usage: devtracekit start [--example]");
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
  console.error("[devtracekit] failed to start", error);
  process.exit(1);
}
