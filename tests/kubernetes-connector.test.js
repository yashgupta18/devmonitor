import test from "node:test";
import assert from "node:assert/strict";
import { parseKubectlPodsJson } from "../src/devscope/kubernetes-connector.js";

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
