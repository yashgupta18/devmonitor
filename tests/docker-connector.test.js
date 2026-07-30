import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDockerPsJsonLines,
  parseDockerStatsJsonLines,
  summarizeDockerLogText,
} from "../src/devmonitor/docker-connector.js";

test("parses docker ps json lines", () => {
  const stdout = [
    '{"ID":"abc123","Image":"redis:7","Names":"devmonitor-redis","State":"running","Status":"Up 3 minutes","Ports":"6379/tcp","RunningFor":"3 minutes"}',
    '{"ID":"def456","Image":"postgres:16","Names":"devmonitor-db","State":"running","Status":"Up 2 minutes","Ports":"5432/tcp","RunningFor":"2 minutes"}',
  ].join("\n");

  const containers = parseDockerPsJsonLines(stdout);
  assert.equal(containers.length, 2);
  assert.equal(containers[0].name, "devmonitor-redis");
  assert.equal(containers[1].image, "postgres:16");
  assert.equal(containers[0].state, "running");
});

test("ignores invalid docker ps json lines", () => {
  const stdout = [
    '{"ID":"abc123","Image":"redis:7","Names":"devmonitor-redis","State":"running","Status":"Up 3 minutes"}',
    "not-json",
  ].join("\n");

  const containers = parseDockerPsJsonLines(stdout);
  assert.equal(containers.length, 1);
  assert.equal(containers[0].id, "abc123");
});

test("parses docker stats json lines", () => {
  const stdout = [
    '{"BlockIO":"0B / 0B","CPUPerc":"0.42%","Container":"abc123","ID":"abc123","MemPerc":"1.20%","MemUsage":"24.1MiB / 1.9GiB","Name":"devmonitor-api","NetIO":"2.1kB / 1.4kB","PIDs":"12"}',
    '{"BlockIO":"0B / 0B","CPUPerc":"2.01%","Container":"def456","ID":"def456","MemPerc":"10.00%","MemUsage":"200MiB / 2GiB","Name":"devmonitor-worker","NetIO":"4.1kB / 2.4kB","PIDs":"18"}',
  ].join("\n");

  const stats = parseDockerStatsJsonLines(stdout);
  assert.equal(stats.length, 2);
  assert.equal(stats[0].name, "devmonitor-api");
  assert.equal(stats[1].memoryPercent, "10.00%");
});

test("summarizes docker logs", () => {
  const logs = [
    "INFO startup complete",
    "WARN reconnecting to queue",
    "ERROR timeout while querying db",
    "debug: heartbeat",
  ].join("\n");

  const summary = summarizeDockerLogText(logs);
  assert.equal(summary.totalLines, 4);
  assert.equal(summary.warningLines, 1);
  assert.equal(summary.errorLines, 1);
});
