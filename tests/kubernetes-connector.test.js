import test from "node:test";
import assert from "node:assert/strict";
import {
  parseKubectlDeploymentsJson,
  parseKubectlPodsJson,
  parseKubectlServicesJson,
  parseKubectlTopPodsTable,
  summarizeLogText,
} from "../src/devtracekit/kubernetes-connector.js";

test("parses kubectl pods json", () => {
  const stdout = JSON.stringify({
    items: [
      {
        metadata: { namespace: "default", name: "api-123" },
        status: { phase: "Running" },
        spec: { nodeName: "node-a" },
      },
      {
        metadata: { namespace: "jobs", name: "worker-456" },
        status: { phase: "Pending" },
        spec: { nodeName: "node-b" },
      },
    ],
  });

  const pods = parseKubectlPodsJson(stdout);
  assert.equal(pods.length, 2);
  assert.equal(pods[0].name, "api-123");
  assert.equal(pods[1].phase, "Pending");
});

test("parses kubectl services json", () => {
  const stdout = JSON.stringify({
    items: [
      {
        metadata: { namespace: "default", name: "checkout-svc" },
        spec: {
          type: "ClusterIP",
          clusterIP: "10.0.0.10",
          ports: [{ port: 80, protocol: "TCP" }],
        },
      },
    ],
  });

  const services = parseKubectlServicesJson(stdout);
  assert.equal(services.length, 1);
  assert.equal(services[0].name, "checkout-svc");
  assert.equal(services[0].ports[0], "80/TCP");
});

test("parses kubectl deployments json", () => {
  const stdout = JSON.stringify({
    items: [
      {
        metadata: { namespace: "default", name: "checkout-api" },
        spec: { replicas: 3 },
        status: {
          updatedReplicas: 3,
          availableReplicas: 3,
          unavailableReplicas: 0,
          observedGeneration: 7,
        },
      },
    ],
  });

  const deployments = parseKubectlDeploymentsJson(stdout);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0].rolloutStatus, "healthy");
  assert.equal(deployments[0].desiredReplicas, 3);
});

test("parses kubectl top pods table", () => {
  const stdout = [
    "default checkout-api-123 10m 64Mi",
    "jobs worker-abc 3m 42Mi",
  ].join("\n");

  const metrics = parseKubectlTopPodsTable(stdout);
  assert.equal(metrics.length, 2);
  assert.equal(metrics[0].cpu, "10m");
  assert.equal(metrics[1].memory, "42Mi");
});

test("summarizes log text", () => {
  const logs = [
    "INFO boot complete",
    "WARN retrying request",
    "ERROR db timeout",
    "DEBUG worker loop",
  ].join("\n");

  const summary = summarizeLogText(logs);
  assert.equal(summary.totalLines, 4);
  assert.equal(summary.warningLines, 1);
  assert.equal(summary.errorLines, 1);
});
