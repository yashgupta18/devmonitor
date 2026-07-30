import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNomadJobAllocationsJson,
  parseNomadJobDeploymentsJson,
  parseNomadJobStatusJson,
  parseNomadNodeStatusJson,
} from "../src/devtracekit/nomad-connector.js";

test("parses nomad node status json", () => {
  const stdout = JSON.stringify([
    {
      ID: "node-1",
      Name: "devtracekit-node-1",
      Datacenter: "dc1",
      Status: "ready",
    },
    {
      ID: "node-2",
      Name: "devtracekit-node-2",
      Datacenter: "dc1",
      Status: "down",
    },
  ]);

  const nodes = parseNomadNodeStatusJson(stdout);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].status, "ready");
  assert.equal(nodes[1].name, "devtracekit-node-2");
});

test("parses nomad job status json", () => {
  const stdout = JSON.stringify([
    {
      ID: "checkout",
      Name: "checkout",
      Namespace: "default",
      Type: "service",
      Status: "running",
      Priority: 50,
      Datacenters: ["dc1"],
      Version: 12,
      ModifyIndex: 200,
    },
  ]);

  const jobs = parseNomadJobStatusJson(stdout);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "checkout");
  assert.equal(jobs[0].status, "running");
});

test("parses nomad job allocations json", () => {
  const stdout = JSON.stringify([
    {
      ID: "alloc-123",
      Name: "checkout.group[0]",
      Namespace: "default",
      JobID: "checkout",
      NodeID: "node-1",
      TaskGroup: "group",
      ClientStatus: "running",
      DesiredStatus: "run",
      CreateTime: 1710000000000,
      ModifyTime: 1710000009999,
    },
  ]);

  const allocations = parseNomadJobAllocationsJson(stdout);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].jobId, "checkout");
  assert.equal(allocations[0].clientStatus, "running");
});

test("parses nomad job deployments json", () => {
  const stdout = JSON.stringify([
    {
      ID: "deployment-1",
      Namespace: "default",
      JobID: "checkout",
      Status: "running",
      StatusDescription: "Deployment is progressing",
      CreateTime: 1710000000000,
      ModifyTime: 1710000009999,
      TaskGroups: {
        group: { DesiredTotal: 3, HealthyAllocs: 2, UnhealthyAllocs: 1 },
      },
    },
  ]);

  const deployments = parseNomadJobDeploymentsJson(stdout);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0].jobId, "checkout");
  assert.equal(deployments[0].statusDescription, "Deployment is progressing");
});
