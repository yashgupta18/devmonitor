import test from "node:test";
import assert from "node:assert/strict";
import { parseDockerPsJsonLines } from "../src/devscope/docker-connector.js";

test("parses docker ps json lines", () => {
  const stdout = [
    '{"ID":"abc123","Image":"redis:7","Names":"devscope-redis","State":"running","Status":"Up 3 minutes","Ports":"6379/tcp","RunningFor":"3 minutes"}',
    '{"ID":"def456","Image":"postgres:16","Names":"devscope-db","State":"running","Status":"Up 2 minutes","Ports":"5432/tcp","RunningFor":"2 minutes"}',
  ].join("\n");

  const containers = parseDockerPsJsonLines(stdout);
  assert.equal(containers.length, 2);
  assert.equal(containers[0].name, "devscope-redis");
  assert.equal(containers[1].image, "postgres:16");
});

test("ignores invalid docker ps json lines", () => {
  const stdout = [
    '{"ID":"abc123","Image":"redis:7","Names":"devscope-redis","State":"running","Status":"Up 3 minutes"}',
    "not-json",
  ].join("\n");

  const containers = parseDockerPsJsonLines(stdout);
  assert.equal(containers.length, 1);
  assert.equal(containers[0].id, "abc123");
});
