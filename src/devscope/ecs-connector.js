import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseEcsListClustersJson(stdout) {
  const payload = JSON.parse(stdout);
  return Array.isArray(payload.clusterArns) ? payload.clusterArns : [];
}

export function parseEcsDescribeClustersJson(stdout) {
  const payload = JSON.parse(stdout);
  const clusters = Array.isArray(payload.clusters) ? payload.clusters : [];

  return clusters.map((cluster) => ({
    arn: cluster.clusterArn,
    name: cluster.clusterName,
    status: cluster.status,
    runningTasksCount: cluster.runningTasksCount ?? 0,
    pendingTasksCount: cluster.pendingTasksCount ?? 0,
    containerInstancesCount: cluster.registeredContainerInstancesCount ?? 0,
  }));
}

export function createEcsConnector(options = {}) {
  const command = options.command ?? "aws";

  async function getStatus() {
    try {
      const listResult = await execFileAsync(command, [
        "ecs",
        "list-clusters",
        "--output",
        "json",
      ]);
      const clusterArns = parseEcsListClustersJson(listResult.stdout);

      if (clusterArns.length === 0) {
        return {
          ok: true,
          available: true,
          connector: "ecs",
          clusterCount: 0,
          clusters: [],
          generatedAtMs: Date.now(),
        };
      }

      const describeResult = await execFileAsync(command, [
        "ecs",
        "describe-clusters",
        "--clusters",
        ...clusterArns.slice(0, 10),
        "--output",
        "json",
      ]);
      const clusters = parseEcsDescribeClustersJson(describeResult.stdout);

      return {
        ok: true,
        available: true,
        connector: "ecs",
        clusterCount: clusters.length,
        clusters,
        generatedAtMs: Date.now(),
      };
    } catch (error) {
      return {
        ok: false,
        available: false,
        connector: "ecs",
        clusterCount: 0,
        clusters: [],
        error: String(error?.message ?? "ecs connector unavailable"),
        generatedAtMs: Date.now(),
      };
    }
  }

  return {
    getStatus,
  };
}
