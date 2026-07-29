import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createDashboardServer(core, connectors = {}, options = {}) {
  const app = express();
  const dashboardPort = options.dashboardPort ?? 4318;
  const githubIntelligence = options.githubIntelligence;
  const staticDir = path.resolve(__dirname, "../../public");

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(express.static(staticDir));

  app.post("/api/ingest/otel", (req, res) => {
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

      const traceId = core.instrument.otelSpan(spanData, { serviceName });
      traceIds.push(traceId);
    }

    res.status(202).json({
      accepted: traceIds.length,
      traceIds,
    });
  });

  app.get("/api/traces", (req, res) => {
    const limit = Number(req.query.limit ?? 200);
    const endpoint =
      typeof req.query.endpoint === "string" && req.query.endpoint.length > 0
        ? req.query.endpoint
        : undefined;
    const status =
      typeof req.query.status === "string" && req.query.status.length > 0
        ? req.query.status
        : undefined;
    const method =
      typeof req.query.method === "string" && req.query.method.length > 0
        ? req.query.method
        : undefined;

    res.json({
      traces: core.listTraces({ limit, endpoint, status, method }),
      stats: core.stats(),
    });
  });

  app.get("/api/traces/:traceId", (req, res) => {
    const trace = core.getTrace(req.params.traceId);
    if (!trace) {
      res.status(404).json({ error: "trace_not_found" });
      return;
    }
    res.json(trace);
  });

  app.get("/api/graph", (req, res) => {
    const limit = Number(req.query.limit ?? 500);
    res.json(core.buildServiceGraph({ limit }));
  });

  app.get("/api/insights", (req, res) => {
    const limit = Number(req.query.limit ?? 300);
    res.json(core.buildAiInsights({ limit }));
  });

  app.post("/api/intelligence/github", async (req, res) => {
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
  });

  app.get("/api/connectors/docker", async (_req, res) => {
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
  });

  app.get("/api/connectors/kubernetes", async (_req, res) => {
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
  });

  app.get("/api/connectors/ecs", async (_req, res) => {
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
  });

  app.get("/api/connectors/nomad", async (_req, res) => {
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
  });

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
