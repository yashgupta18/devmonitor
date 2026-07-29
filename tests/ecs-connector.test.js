import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEcsDescribeClustersJson,
  parseEcsListClustersJson,
} from "../src/devscope/ecs-connector.js";

test("parses ecs list clusters json", () => {
  const stdout = JSON.stringify({
    clusterArns: [
      "arn:aws:ecs:us-east-1:111111111111:cluster/devscope-a",
      "arn:aws:ecs:us-east-1:111111111111:cluster/devscope-b",
    ],
  });

  const arns = parseEcsListClustersJson(stdout);
  assert.equal(arns.length, 2);
});

test("parses ecs describe clusters json", () => {
  const stdout = JSON.stringify({
    clusters: [
      {
        clusterArn: "arn:aws:ecs:us-east-1:111111111111:cluster/devscope-a",
        clusterName: "devscope-a",
        status: "ACTIVE",
        runningTasksCount: 3,
        pendingTasksCount: 1,
        registeredContainerInstancesCount: 2,
      },
    ],
  });

  const clusters = parseEcsDescribeClustersJson(stdout);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].name, "devscope-a");
  assert.equal(clusters[0].runningTasksCount, 3);
});
