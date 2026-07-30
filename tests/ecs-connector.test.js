import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEcsDescribeClustersJson,
  parseEcsDescribeServicesJson,
  parseEcsDescribeTasksJson,
  parseEcsListClustersJson,
  parseEcsListServicesJson,
  parseEcsListTasksJson,
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

test("parses ecs list services json", () => {
  const stdout = JSON.stringify({
    serviceArns: [
      "arn:aws:ecs:us-east-1:111111111111:service/devscope-a/api",
      "arn:aws:ecs:us-east-1:111111111111:service/devscope-a/worker",
    ],
  });

  const serviceArns = parseEcsListServicesJson(stdout);
  assert.equal(serviceArns.length, 2);
});

test("parses ecs describe services json", () => {
  const stdout = JSON.stringify({
    services: [
      {
        serviceArn: "arn:aws:ecs:us-east-1:111111111111:service/devscope-a/api",
        serviceName: "api",
        status: "ACTIVE",
        desiredCount: 3,
        runningCount: 2,
        pendingCount: 1,
        launchType: "FARGATE",
        schedulingStrategy: "REPLICA",
        deployments: [
          {
            id: "ecs-svc/123",
            status: "PRIMARY",
            rolloutState: "IN_PROGRESS",
            desiredCount: 3,
            runningCount: 2,
            pendingCount: 1,
          },
        ],
        events: [
          {
            id: "event-1",
            message: "service api has reached steady state",
          },
        ],
      },
    ],
  });

  const services = parseEcsDescribeServicesJson(stdout);
  assert.equal(services.length, 1);
  assert.equal(services[0].name, "api");
  assert.equal(services[0].deployments.length, 1);
  assert.equal(services[0].events.length, 1);
});

test("parses ecs list tasks json", () => {
  const stdout = JSON.stringify({
    taskArns: [
      "arn:aws:ecs:us-east-1:111111111111:task/devscope-a/task-1",
      "arn:aws:ecs:us-east-1:111111111111:task/devscope-a/task-2",
    ],
  });

  const taskArns = parseEcsListTasksJson(stdout);
  assert.equal(taskArns.length, 2);
});

test("parses ecs describe tasks json", () => {
  const stdout = JSON.stringify({
    tasks: [
      {
        taskArn: "arn:aws:ecs:us-east-1:111111111111:task/devscope-a/task-1",
        taskDefinitionArn:
          "arn:aws:ecs:us-east-1:111111111111:task-definition/api:42",
        lastStatus: "RUNNING",
        desiredStatus: "RUNNING",
        healthStatus: "HEALTHY",
        launchType: "FARGATE",
        cpu: "256",
        memory: "512",
        stopCode: "",
        containers: [{ name: "api" }],
      },
    ],
  });

  const tasks = parseEcsDescribeTasksJson(stdout);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].lastStatus, "RUNNING");
  assert.equal(tasks[0].containerCount, 1);
});
