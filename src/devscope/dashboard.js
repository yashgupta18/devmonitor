import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSecurityManager } from "./security.js";
import { createAlertDispatcher } from "./alerting.js";
import { createClusterManager } from "./cluster.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseRemoteIngestConfig(config = {}) {
  const enabled = config.enabled ?? true;
  const apiKeys = Array.isArray(config.apiKeys)
    ? config.apiKeys.map((key) => String(key).trim()).filter(Boolean)
    : [];

  return {
    enabled,
    apiKeys: new Set(apiKeys),
    rateLimitWindowMs: Math.max(1, Number(config.rateLimitWindowMs ?? 60_000)),
    rateLimitMaxRequests: Math.max(
      1,
      Number(config.rateLimitMaxRequests ?? 120),
    ),
    maxSpansPerRequest: Math.max(1, Number(config.maxSpansPerRequest ?? 500)),
  };
}

function extractApiKey(req) {
  const explicitKey = req.header("x-devscope-api-key");
  if (explicitKey && explicitKey.trim().length > 0) {
    return explicitKey.trim();
  }

  const authHeader = req.header("authorization");
  if (!authHeader) {
    return "";
  }

  const [scheme, value] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer") {
    return "";
  }

  return value?.trim() ?? "";
}

function resolveSpansFromBody(body) {
  if (Array.isArray(body?.spans)) {
    return body.spans;
  }

  if (body?.span && typeof body.span === "object") {
    return [body.span];
  }

  return [];
}

function parseScopeValue(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.slice(0, 80);
}

function getOptionalQueryString(req, key) {
  const value = req.query?.[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveScopeFromRequest(req, body = {}) {
  return {
    tenantId:
      parseScopeValue(req.header("x-devscope-tenant-id")) ??
      parseScopeValue(body.tenantId),
    projectId:
      parseScopeValue(req.header("x-devscope-project-id")) ??
      parseScopeValue(body.projectId),
    environment:
      parseScopeValue(req.header("x-devscope-environment")) ??
      parseScopeValue(body.environment),
  };
}

function resolveConnector(connectors, connectorName) {
  const normalized = String(connectorName ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || !(normalized in connectors)) {
    return null;
  }

  return {
    name: normalized,
    connector: connectors[normalized],
  };
}

export function createDashboardServer(core, connectors = {}, options = {}) {
  const app = express();
  const dashboardPort = options.dashboardPort ?? 4318;
  const githubIntelligence = options.githubIntelligence;
  const security = createSecurityManager(options.security ?? {});
  const alerting = createAlertDispatcher(options.alerting ?? {});
  const cluster = createClusterManager(options.cluster ?? {});
  const remoteIngestConfig = parseRemoteIngestConfig(
    options.remoteIngest ?? {},
  );
  const remoteIngestRateMap = new Map();
  const staticDir = path.resolve(__dirname, "../../public");

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(express.static(staticDir));

  app.post(
    "/api/ingest/otel",
    security.requirePermission("write"),
    (req, res) => {
      const scope = resolveScopeFromRequest(req, req.body ?? {});
      const serviceName =
        typeof req.body?.serviceName === "string" &&
        req.body.serviceName.length > 0
          ? req.body.serviceName
          : "external-service";

      let spans = [];
      if (Array.isArray(req.body?.spans)) {
        spans = req.body.spans;
      } else if (req.body?.span) {
        spans = [req.body.span];
      }

      if (spans.length === 0) {
        res.status(400).json({ error: "spans_required" });
        return;
      }

      const traceIds = [];
      for (const spanData of spans) {
        if (!spanData || typeof spanData !== "object") {
          continue;
        }

        const traceId = core.instrument.otelSpan(spanData, {
          serviceName,
          ...scope,
        });
        traceIds.push(traceId);
      }

      res.status(202).json({
        accepted: traceIds.length,
        traceIds,
      });
    },
  );

  app.post(
    "/api/remote/ingest/otel",
    security.requirePermission("write"),
    (req, res) => {
      if (
        !remoteIngestConfig.enabled ||
        remoteIngestConfig.apiKeys.size === 0
      ) {
        res.status(503).json({
          error: "remote_ingest_not_configured",
        });
        return;
      }

      const apiKey = extractApiKey(req);
      if (!apiKey || !remoteIngestConfig.apiKeys.has(apiKey)) {
        res.status(401).json({ error: "invalid_api_key" });
        return;
      }

      const now = Date.now();
      const remoteIp =
        req.header("x-forwarded-for")?.split(",")?.[0]?.trim() ||
        req.ip ||
        "unknown";
      const bucketKey = `${apiKey}:${remoteIp}`;
      const currentBucket = remoteIngestRateMap.get(bucketKey);

      if (
        !currentBucket ||
        now - currentBucket.windowStartMs >=
          remoteIngestConfig.rateLimitWindowMs
      ) {
        remoteIngestRateMap.set(bucketKey, {
          windowStartMs: now,
          count: 1,
        });
      } else {
        currentBucket.count += 1;
        if (currentBucket.count > remoteIngestConfig.rateLimitMaxRequests) {
          res.status(429).json({
            error: "rate_limit_exceeded",
            retryAfterMs:
              remoteIngestConfig.rateLimitWindowMs -
              (now - currentBucket.windowStartMs),
          });
          return;
        }
      }

      const spans = resolveSpansFromBody(req.body);
      if (spans.length === 0) {
        res.status(400).json({ error: "spans_required" });
        return;
      }

      if (spans.length > remoteIngestConfig.maxSpansPerRequest) {
        res.status(400).json({
          error: "spans_limit_exceeded",
          maxSpansPerRequest: remoteIngestConfig.maxSpansPerRequest,
        });
        return;
      }

      const serviceName =
        typeof req.body?.serviceName === "string" &&
        req.body.serviceName.trim().length > 0
          ? req.body.serviceName.trim()
          : "remote-service";
      const scope = resolveScopeFromRequest(req, req.body ?? {});

      const traceIds = [];
      for (const spanData of spans) {
        if (!spanData || typeof spanData !== "object") {
          continue;
        }

        const traceId = core.instrument.otelSpan(spanData, {
          serviceName,
          ...scope,
        });
        traceIds.push(traceId);
      }

      if (traceIds.length === 0) {
        res.status(400).json({ error: "valid_spans_required" });
        return;
      }

      res.status(202).json({
        accepted: traceIds.length,
        traceIds,
        serviceName,
        ...core.resolveScope(scope),
      });
    },
  );

  app.get("/api/traces", security.requirePermission("read"), (req, res) => {
    const limit = Number(req.query.limit ?? 200);
    const endpoint = getOptionalQueryString(req, "endpoint");
    const status = getOptionalQueryString(req, "status");
    const method = getOptionalQueryString(req, "method");
    const service = getOptionalQueryString(req, "service");
    const cluster = getOptionalQueryString(req, "cluster");
    const namespace = getOptionalQueryString(req, "namespace");
    const tenantId = getOptionalQueryString(req, "tenantId");
    const projectId = getOptionalQueryString(req, "projectId");
    const environment = getOptionalQueryString(req, "environment");

    res.json({
      traces: core.listTraces({
        limit,
        endpoint,
        status,
        method,
        service,
        cluster,
        namespace,
        tenantId,
        projectId,
        environment,
      }),
      stats: core.stats({
        service,
        cluster,
        namespace,
        tenantId,
        projectId,
        environment,
      }),
    });
  });

  app.get("/api/tenants", security.requirePermission("read"), (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" && req.query.tenantId.length > 0
        ? req.query.tenantId
        : undefined;
    const projectId =
      typeof req.query.projectId === "string" && req.query.projectId.length > 0
        ? req.query.projectId
        : undefined;
    const environment =
      typeof req.query.environment === "string" &&
      req.query.environment.length > 0
        ? req.query.environment
        : undefined;

    res.json({
      tenants: core.listTenants({ tenantId, projectId, environment }),
    });
  });

  app.get("/api/services", security.requirePermission("read"), (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" && req.query.tenantId.length > 0
        ? req.query.tenantId
        : undefined;
    const projectId =
      typeof req.query.projectId === "string" && req.query.projectId.length > 0
        ? req.query.projectId
        : undefined;
    const environment =
      typeof req.query.environment === "string" &&
      req.query.environment.length > 0
        ? req.query.environment
        : undefined;

    res.json(
      core.listServices({
        tenantId,
        projectId,
        environment,
      }),
    );
  });

  app.get(
    "/api/traces/:traceId",
    security.requirePermission("read"),
    (req, res) => {
      const trace = core.getTrace(req.params.traceId);
      if (!trace) {
        res.status(404).json({ error: "trace_not_found" });
        return;
      }
      res.json(trace);
    },
  );

  app.get("/api/graph", security.requirePermission("read"), (req, res) => {
    const limit = Number(req.query.limit ?? 500);
    res.json(core.buildServiceGraph({ limit }));
  });

  app.get("/api/insights", security.requirePermission("read"), (req, res) => {
    const limit = Number(req.query.limit ?? 300);
    res.json(core.buildAiInsights({ limit }));
  });

  app.get("/api/federation", security.requirePermission("read"), (req, res) => {
    const limit = Number(req.query.limit ?? 600);
    const tenantId = getOptionalQueryString(req, "tenantId");
    const projectId = getOptionalQueryString(req, "projectId");
    const environment = getOptionalQueryString(req, "environment");
    const service = getOptionalQueryString(req, "service");
    const cluster = getOptionalQueryString(req, "cluster");
    const namespace = getOptionalQueryString(req, "namespace");

    res.json(
      core.buildFederationView({
        limit,
        tenantId,
        projectId,
        environment,
        service,
        cluster,
        namespace,
      }),
    );
  });

  app.post(
    "/api/gitops/events",
    security.requirePermission("write"),
    (req, res) => {
      const scope = resolveScopeFromRequest(req, req.body ?? {});
      const event = core.recordGitOpsEvent({
        id: req.body?.id,
        source: req.body?.source,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        environment: scope.environment,
        service: req.body?.service,
        commitSha: req.body?.commitSha,
        author: req.body?.author,
        action: req.body?.action,
        status: req.body?.status,
        timestampMs: req.body?.timestampMs,
        metadata: req.body?.metadata,
      });

      res.status(202).json({
        ok: true,
        event,
      });
    },
  );

  app.get(
    "/api/gitops/events",
    security.requirePermission("read"),
    (req, res) => {
      const limit = Number(req.query.limit ?? 100);
      const tenantId = getOptionalQueryString(req, "tenantId");
      const projectId = getOptionalQueryString(req, "projectId");
      const environment = getOptionalQueryString(req, "environment");
      const service = getOptionalQueryString(req, "service");

      res.json({
        events: core.listGitOpsEvents({
          limit,
          tenantId,
          projectId,
          environment,
          service,
        }),
      });
    },
  );

  app.get(
    "/api/gitops/correlations",
    security.requirePermission("read"),
    (req, res) => {
      const limit = Number(req.query.limit ?? 50);
      const windowMinutes = Number(req.query.windowMinutes ?? 30);
      const tenantId = getOptionalQueryString(req, "tenantId");
      const projectId = getOptionalQueryString(req, "projectId");
      const environment = getOptionalQueryString(req, "environment");
      const service = getOptionalQueryString(req, "service");

      res.json(
        core.correlateGitOpsChanges({
          limit,
          windowMinutes,
          tenantId,
          projectId,
          environment,
          service,
        }),
      );
    },
  );

  app.get(
    "/api/deployments/risk",
    security.requirePermission("read"),
    (req, res) => {
      const limit = Number(req.query.limit ?? 30);
      const baselineMinutes = Number(req.query.baselineMinutes ?? 30);
      const canaryMinutes = Number(req.query.canaryMinutes ?? 20);
      const minCanarySamples = Number(req.query.minCanarySamples ?? 5);

      const tenantId = getOptionalQueryString(req, "tenantId");
      const projectId = getOptionalQueryString(req, "projectId");
      const environment = getOptionalQueryString(req, "environment");
      const service = getOptionalQueryString(req, "service");

      res.json(
        core.buildDeploymentRiskReport({
          limit,
          baselineMinutes,
          canaryMinutes,
          minCanarySamples,
          tenantId,
          projectId,
          environment,
          service,
        }),
      );
    },
  );

  app.get(
    "/api/cost-capacity",
    security.requirePermission("read"),
    (req, res) => {
      const windowMinutes = Number(req.query.windowMinutes ?? 60);
      const targetRps = Number(req.query.targetRps ?? 100);
      const tenantId = getOptionalQueryString(req, "tenantId");
      const projectId = getOptionalQueryString(req, "projectId");
      const environment = getOptionalQueryString(req, "environment");

      res.json(
        core.buildCostCapacityInsights({
          windowMinutes,
          targetRps,
          tenantId,
          projectId,
          environment,
        }),
      );
    },
  );

  app.get(
    "/api/incidents/postmortem",
    security.requirePermission("read"),
    (req, res) => {
      const incident = getOptionalQueryString(req, "incident") ?? "incident";
      const limit = Number(req.query.limit ?? 500);
      const tenantId = getOptionalQueryString(req, "tenantId");
      const projectId = getOptionalQueryString(req, "projectId");
      const environment = getOptionalQueryString(req, "environment");

      res.json(
        core.buildIncidentPostmortem({
          incident,
          limit,
          tenantId,
          projectId,
          environment,
        }),
      );
    },
  );

  app.get(
    "/api/incidents/replay",
    security.requirePermission("read"),
    (req, res) => {
      const incident = getOptionalQueryString(req, "incident") ?? "incident";
      const limit = Number(req.query.limit ?? 500);
      const tenantId = getOptionalQueryString(req, "tenantId");
      const projectId = getOptionalQueryString(req, "projectId");
      const environment = getOptionalQueryString(req, "environment");

      res.json(
        core.buildIncidentReplay({
          incident,
          limit,
          tenantId,
          projectId,
          environment,
        }),
      );
    },
  );

  app.get("/api/timeseries", security.requirePermission("read"), (req, res) => {
    const windowMinutes = Number(req.query.windowMinutes ?? 60);
    const tenantId = getOptionalQueryString(req, "tenantId");
    const projectId = getOptionalQueryString(req, "projectId");
    const environment = getOptionalQueryString(req, "environment");
    const service = getOptionalQueryString(req, "service");

    res.json({
      buckets: core.listTimeSeries({
        windowMinutes,
        tenantId,
        projectId,
        environment,
        service,
      }),
    });
  });

  app.get("/api/slo", security.requirePermission("read"), (req, res) => {
    const windowMinutes = Number(req.query.windowMinutes ?? 60);
    const shortWindowMinutes = Number(req.query.shortWindowMinutes ?? 5);
    const objectiveAvailability = Number(
      req.query.objectiveAvailability ?? 99.9,
    );
    const objectiveP95Ms = Number(req.query.objectiveP95Ms ?? 400);

    const tenantId = getOptionalQueryString(req, "tenantId");
    const projectId = getOptionalQueryString(req, "projectId");
    const environment = getOptionalQueryString(req, "environment");
    const service = getOptionalQueryString(req, "service");

    res.json(
      core.buildSloReport({
        windowMinutes,
        shortWindowMinutes,
        objectiveAvailability,
        objectiveP95Ms,
        tenantId,
        projectId,
        environment,
        service,
      }),
    );
  });

  app.get("/api/audit", security.requirePermission("admin"), (req, res) => {
    const limit = Number(req.query.limit ?? 200);
    res.json({
      entries: security.listAudit({ limit }),
    });
  });

  app.post(
    "/api/alerts/test",
    security.requirePermission("admin"),
    async (req, res) => {
      const report = await alerting.sendAlert({
        channel:
          typeof req.body?.channel === "string" ? req.body.channel : "all",
        severity:
          typeof req.body?.severity === "string"
            ? req.body.severity
            : "warning",
        title:
          typeof req.body?.title === "string"
            ? req.body.title
            : "DevScope test alert",
        message:
          typeof req.body?.message === "string"
            ? req.body.message
            : "Alert pipeline validation",
        context: req.body?.context,
      });

      if (!report.ok) {
        res.status(503).json(report);
        return;
      }

      res.json(report);
    },
  );

  app.post(
    "/api/cluster/heartbeat",
    security.requirePermission("write"),
    (req, res) => {
      const result = cluster.heartbeat({
        instanceId: req.body?.instanceId,
        role: req.body?.role,
        version: req.body?.version,
        capacity: req.body?.capacity,
        environment: req.body?.environment,
      });

      if (!result.ok) {
        res.status(400).json(result);
        return;
      }

      res.status(202).json(result);
    },
  );

  app.get(
    "/api/cluster/status",
    security.requirePermission("read"),
    (_req, res) => {
      res.json(cluster.status());
    },
  );

  app.post(
    "/api/incidents/correlate",
    security.requirePermission("write"),
    async (req, res) => {
      const scope = resolveScopeFromRequest(req, req.body ?? {});
      const incident =
        typeof req.body?.incident === "string" &&
        req.body.incident.trim().length > 0
          ? req.body.incident.trim()
          : "incident";
      const limit = Number(req.body?.limit ?? 400);

      const report = core.buildIncidentCorrelations({
        incident,
        limit,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        environment: scope.environment,
      });

      let notifications;
      if (req.body?.notify === true) {
        const notifyResult = await alerting.notifyIncident(report, {
          channel:
            typeof req.body?.alertChannel === "string"
              ? req.body.alertChannel
              : "all",
          severity:
            typeof req.body?.severity === "string"
              ? req.body.severity
              : "critical",
        });
        notifications = notifyResult.notifications;
      }

      res.json({
        ...report,
        notifications,
      });
    },
  );

  app.post(
    "/api/intelligence/github",
    security.requirePermission("write"),
    async (req, res) => {
      if (!githubIntelligence?.analyzeIncident) {
        res.status(501).json({
          ok: false,
          error: "github_intelligence_not_configured",
        });
        return;
      }

      const incident =
        typeof req.body?.incident === "string" &&
        req.body.incident.trim().length > 0
          ? req.body.incident
          : "API errors detected";

      const traces = core.listTraces({
        limit: Number(req.body?.traceLimit ?? 200),
      });
      const limit = Number(req.body?.limit ?? 5);
      const report = await githubIntelligence.analyzeIncident({
        incident,
        traces,
        limit,
      });

      if (!report.ok) {
        res.status(503).json(report);
        return;
      }

      res.json(report);
    },
  );

  app.get(
    "/api/connectors/docker",
    security.requirePermission("read"),
    async (_req, res) => {
      if (!connectors.docker?.getStatus) {
        res.status(501).json({
          ok: false,
          available: false,
          connector: "docker",
          error: "docker_connector_not_configured",
        });
        return;
      }

      const status = await connectors.docker.getStatus();
      if (!status.ok) {
        res.status(503).json(status);
        return;
      }

      res.json(status);
    },
  );

  app.get(
    "/api/connectors/:connector/telemetry",
    security.requirePermission("read"),
    async (req, res) => {
      const resolved = resolveConnector(connectors, req.params.connector);
      if (!resolved) {
        res.status(404).json({
          ok: false,
          error: "connector_not_found",
        });
        return;
      }

      if (!resolved.connector?.getTelemetry) {
        res.status(501).json({
          ok: false,
          connector: resolved.name,
          error: "connector_telemetry_not_supported",
        });
        return;
      }

      const telemetry = await resolved.connector.getTelemetry();
      if (!telemetry.ok) {
        res.status(503).json(telemetry);
        return;
      }

      res.json(telemetry);
    },
  );

  app.post(
    "/api/connectors/collect",
    security.requirePermission("write"),
    async (req, res) => {
      const resolved = resolveConnector(connectors, req.body?.connector);
      if (!resolved) {
        res.status(400).json({
          error: "connector_required",
        });
        return;
      }

      if (!resolved.connector?.getTelemetry) {
        res.status(501).json({
          ok: false,
          connector: resolved.name,
          error: "connector_telemetry_not_supported",
        });
        return;
      }

      const telemetry = await resolved.connector.getTelemetry();
      if (!telemetry.ok) {
        res.status(503).json(telemetry);
        return;
      }

      const scope = core.resolveScope(
        resolveScopeFromRequest(req, req.body ?? {}),
      );
      const serviceName =
        typeof req.body?.serviceName === "string" &&
        req.body.serviceName.trim().length > 0
          ? req.body.serviceName.trim()
          : `connector-${resolved.name}`;

      const trace = core.createTrace({
        method: "CONNECTOR",
        path: `/connectors/${resolved.name}/collect`,
        service: serviceName,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        environment: scope.environment,
      });

      core.addEvent(trace.traceId, {
        type: "connector",
        name: `${resolved.name}:snapshot`,
        status: "ok",
        metadata: {
          connector: resolved.name,
          resourceCount:
            telemetry.resourceCount ?? telemetry.signals?.length ?? 0,
        },
      });

      const signals = Array.isArray(telemetry.signals) ? telemetry.signals : [];
      for (const signal of signals) {
        const signalMetadata =
          signal.metadata && typeof signal.metadata === "object"
            ? signal.metadata
            : undefined;
        core.addEvent(trace.traceId, {
          type: "connector",
          name: `${resolved.name}:${signal.type ?? "signal"}:${signal.name ?? "unknown"}`,
          status: signal.status ?? "ok",
          durationMs: Number.isFinite(signal.durationMs)
            ? signal.durationMs
            : null,
          metadata: {
            connector: resolved.name,
            signalType: signal.type ?? "signal",
            ...signalMetadata,
          },
        });
      }

      core.finishTrace(trace.traceId, { statusCode: 200 });

      res.status(202).json({
        ok: true,
        connector: resolved.name,
        traceId: trace.traceId,
        ingestedSignals: signals.length,
        serviceName,
        ...scope,
      });
    },
  );

  app.get(
    "/api/connectors/kubernetes",
    security.requirePermission("read"),
    async (_req, res) => {
      if (!connectors.kubernetes?.getStatus) {
        res.status(501).json({
          ok: false,
          available: false,
          connector: "kubernetes",
          error: "kubernetes_connector_not_configured",
        });
        return;
      }

      const status = await connectors.kubernetes.getStatus();
      if (!status.ok) {
        res.status(503).json(status);
        return;
      }

      res.json(status);
    },
  );

  app.get(
    "/api/connectors/ecs",
    security.requirePermission("read"),
    async (_req, res) => {
      if (!connectors.ecs?.getStatus) {
        res.status(501).json({
          ok: false,
          available: false,
          connector: "ecs",
          error: "ecs_connector_not_configured",
        });
        return;
      }

      const status = await connectors.ecs.getStatus();
      if (!status.ok) {
        res.status(503).json(status);
        return;
      }

      res.json(status);
    },
  );

  app.get(
    "/api/connectors/nomad",
    security.requirePermission("read"),
    async (_req, res) => {
      if (!connectors.nomad?.getStatus) {
        res.status(501).json({
          ok: false,
          available: false,
          connector: "nomad",
          error: "nomad_connector_not_configured",
        });
        return;
      }

      const status = await connectors.nomad.getStatus();
      if (!status.ok) {
        res.status(503).json(status);
        return;
      }

      res.json(status);
    },
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  const server = app.listen(dashboardPort, () => {
    console.log(
      `[devscope] dashboard running on http://localhost:${dashboardPort}`,
    );
  });

  return { app, server, dashboardPort };
}
