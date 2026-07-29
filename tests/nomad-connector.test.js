import test from "node:test";
import assert from "node:assert/strict";
import { parseNomadNodeStatusJson } from "../src/devscope/nomad-connector.js";

test("parses nomad node status json", () => {
  const stdout = JSON.stringify([
    {
      ID: "node-1",
      Name: "devscope-node-1",
      Datacenter: "dc1",
      Status: "ready",
    },
    {
      ID: "node-2",
      Name: "devscope-node-2",
      Datacenter: "dc1",
      Status: "down",
    },
  ]);

  const nodes = parseNomadNodeStatusJson(stdout);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].status, "ready");
  assert.equal(nodes[1].name, "devscope-node-2");
});
