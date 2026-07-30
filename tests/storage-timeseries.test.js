import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DevMonitorCore } from "../src/devmonitor/core.js";

test("file trace store persists traces across core restarts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "devmonitor-store-"));
  const traceStorePath = path.join(tempDir, "traces.ndjson");

  const first = new DevMonitorCore({
    storageBackend: "file",
    traceStorePath,
    maxTraces: 20,
  });

  const trace = first.createTrace({
    method: "GET",
    path: "/persist",
    service: "persist-service",
    tenantId: "team-a",
    projectId: "demo",
    environment: "prod",
  });
  first.finishTrace(trace.traceId, { statusCode: 200 });

  const second = new DevMonitorCore({
    storageBackend: "file",
    traceStorePath,
    maxTraces: 20,
  });

  const persisted = second.getTrace(trace.traceId);
  assert.ok(persisted);
  assert.equal(persisted.path, "/persist");

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("time-series store captures completed traces and SLO report", () => {
  const core = new DevMonitorCore({ maxTraces: 100 });

  for (let index = 0; index < 4; index += 1) {
    const trace = core.createTrace({
      method: "GET",
      path: "/slo",
      service: "checkout-service",
      tenantId: "team-a",
      projectId: "demo",
      environment: "prod",
      startTimeMs: Date.now() - 100,
    });
    core.finishTrace(trace.traceId, {
      statusCode: index === 0 ? 500 : 200,
      endTimeMs: Date.now() - 10,
    });
  }

  const buckets = core.listTimeSeries({ windowMinutes: 60 });
  assert.ok(buckets.length >= 1);

  const slo = core.buildSloReport({
    windowMinutes: 60,
    objectiveAvailability: 99.9,
    objectiveP95Ms: 300,
  });

  assert.ok(slo.services.length >= 1);
  assert.equal(slo.services[0].service, "checkout-service");
  assert.ok(Number.isFinite(slo.services[0].shortBurnRate));
});
