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

export function parseEcsListServicesJson(stdout) {
  const payload = JSON.parse(stdout);
  return Array.isArray(payload.serviceArns) ? payload.serviceArns : [];
}

export function parseEcsDescribeServicesJson(stdout) {
  const payload = JSON.parse(stdout);
  const services = Array.isArray(payload.services) ? payload.services : [];

  return services.map((service) => ({
    arn: service.serviceArn,
    name: service.serviceName,
    status: service.status,
    desiredCount: Number(service.desiredCount ?? 0),
    runningCount: Number(service.runningCount ?? 0),
    pendingCount: Number(service.pendingCount ?? 0),
    launchType: service.launchType ?? "",
    schedulingStrategy: service.schedulingStrategy ?? "",
    deployments: Array.isArray(service.deployments)
      ? service.deployments.map((deployment) => ({
          id: deployment.id,
          status: deployment.status,
          rolloutState: deployment.rolloutState ?? "",
          desiredCount: Number(deployment.desiredCount ?? 0),
          runningCount: Number(deployment.runningCount ?? 0),
          pendingCount: Number(deployment.pendingCount ?? 0),
          createdAt: deployment.createdAt
            ? new Date(deployment.createdAt).getTime()
            : null,
          updatedAt: deployment.updatedAt
            ? new Date(deployment.updatedAt).getTime()
            : null,
        }))
      : [],
    events: Array.isArray(service.events)
      ? service.events.slice(0, 5).map((event) => ({
          id: event.id,
          message: event.message ?? "",
          createdAt: event.createdAt
            ? new Date(event.createdAt).getTime()
            : null,
        }))
      : [],
  }));
}

export function parseEcsListTasksJson(stdout) {
  const payload = JSON.parse(stdout);
  return Array.isArray(payload.taskArns) ? payload.taskArns : [];
}

export function parseEcsDescribeTasksJson(stdout) {
  const payload = JSON.parse(stdout);
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];

  return tasks.map((task) => ({
    arn: task.taskArn,
    taskDefinitionArn: task.taskDefinitionArn,
    lastStatus: task.lastStatus ?? "",
    desiredStatus: task.desiredStatus ?? "",
    healthStatus: task.healthStatus ?? "UNKNOWN",
    launchType: task.launchType ?? "",
    cpu: task.cpu ?? "",
    memory: task.memory ?? "",
    startedAt: task.startedAt ? new Date(task.startedAt).getTime() : null,
    stoppedAt: task.stoppedAt ? new Date(task.stoppedAt).getTime() : null,
    stopCode: task.stopCode ?? "",
    containerCount: Array.isArray(task.containers) ? task.containers.length : 0,
  }));
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function createEcsConnector(options = {}) {
  const command = options.command ?? "aws";
  const maxClusters = Math.max(1, Number(options.maxClusters ?? 5));
  const maxServicesPerCluster = Math.max(
    1,
    Number(options.maxServicesPerCluster ?? 20),
  );
  const maxTasksPerCluster = Math.max(
    1,
    Number(options.maxTasksPerCluster ?? 20),
  );

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

  async function getTelemetry() {
    const status = await getStatus();
    if (!status.ok) {
      return {
        ...status,
        mode: "telemetry",
        resourceCount: 0,
        signals: [],
      };
    }

    const warnings = [];
    const services = [];
    const tasks = [];

    for (const cluster of status.clusters.slice(0, maxClusters)) {
      const clusterArn = cluster.arn;
      if (!clusterArn) {
        continue;
      }

      try {
        const listServicesResult = await execFileAsync(command, [
          "ecs",
          "list-services",
          "--cluster",
          clusterArn,
          "--output",
          "json",
        ]);
        const serviceArns = parseEcsListServicesJson(
          listServicesResult.stdout,
        ).slice(0, maxServicesPerCluster);

        for (const group of chunkArray(serviceArns, 10)) {
          if (group.length === 0) {
            continue;
          }

          const describeServicesResult = await execFileAsync(command, [
            "ecs",
            "describe-services",
            "--cluster",
            clusterArn,
            "--services",
            ...group,
            "--output",
            "json",
          ]);
          const parsedServices = parseEcsDescribeServicesJson(
            describeServicesResult.stdout,
          ).map((service) => ({
            ...service,
            clusterArn,
            clusterName: cluster.name,
          }));
          services.push(...parsedServices);
        }
      } catch (error) {
        warnings.push(
          `services_unavailable:${cluster.name}:${String(error?.message ?? "unknown")}`,
        );
      }

      try {
        const listTasksResult = await execFileAsync(command, [
          "ecs",
          "list-tasks",
          "--cluster",
          clusterArn,
          "--desired-status",
          "RUNNING",
          "--output",
          "json",
        ]);
        const taskArns = parseEcsListTasksJson(listTasksResult.stdout).slice(
          0,
          maxTasksPerCluster,
        );

        for (const group of chunkArray(taskArns, 100)) {
          if (group.length === 0) {
            continue;
          }

          const describeTasksResult = await execFileAsync(command, [
            "ecs",
            "describe-tasks",
            "--cluster",
            clusterArn,
            "--tasks",
            ...group,
            "--output",
            "json",
          ]);
          const parsedTasks = parseEcsDescribeTasksJson(
            describeTasksResult.stdout,
          ).map((task) => ({
            ...task,
            clusterArn,
            clusterName: cluster.name,
          }));
          tasks.push(...parsedTasks);
        }
      } catch (error) {
        warnings.push(
          `tasks_unavailable:${cluster.name}:${String(error?.message ?? "unknown")}`,
        );
      }
    }

    const clusterSignals = status.clusters.slice(0, 100).map((cluster) => ({
      type: "cluster",
      name: cluster.name ?? cluster.arn ?? "unknown-cluster",
      status: String(cluster.status).toUpperCase() === "ACTIVE" ? "ok" : "warn",
      metadata: {
        arn: cluster.arn ?? "",
        runningTasksCount: cluster.runningTasksCount ?? 0,
        pendingTasksCount: cluster.pendingTasksCount ?? 0,
        containerInstancesCount: cluster.containerInstancesCount ?? 0,
      },
    }));

    const serviceSignals = services.slice(0, 200).map((service) => ({
      type: "service",
      name: `${service.clusterName ?? "cluster"}/${service.name ?? "unknown-service"}`,
      status: String(service.status).toUpperCase() === "ACTIVE" ? "ok" : "warn",
      metadata: {
        clusterArn: service.clusterArn ?? "",
        clusterName: service.clusterName ?? "",
        serviceArn: service.arn ?? "",
        desiredCount: service.desiredCount,
        runningCount: service.runningCount,
        pendingCount: service.pendingCount,
        launchType: service.launchType,
        schedulingStrategy: service.schedulingStrategy,
      },
    }));

    const deploymentSignals = services
      .flatMap((service) =>
        service.deployments.map((deployment) => ({
          service,
          deployment,
        })),
      )
      .slice(0, 300)
      .map(({ service, deployment }) => ({
        type: "deployment",
        name: `${service.clusterName ?? "cluster"}/${service.name ?? "service"}:${deployment.id ?? "deployment"}`,
        status:
          String(deployment.rolloutState).toUpperCase() === "COMPLETED"
            ? "ok"
            : "warn",
        metadata: {
          clusterArn: service.clusterArn ?? "",
          clusterName: service.clusterName ?? "",
          serviceArn: service.arn ?? "",
          serviceName: service.name ?? "",
          deploymentId: deployment.id ?? "",
          deploymentStatus: deployment.status ?? "",
          rolloutState: deployment.rolloutState ?? "",
          desiredCount: deployment.desiredCount ?? 0,
          runningCount: deployment.runningCount ?? 0,
          pendingCount: deployment.pendingCount ?? 0,
          createdAtMs: deployment.createdAt,
          updatedAtMs: deployment.updatedAt,
        },
      }));

    const taskSignals = tasks.slice(0, 300).map((task) => ({
      type: "task",
      name: `${task.clusterName ?? "cluster"}/${task.arn?.split("/").pop() ?? "task"}`,
      status:
        String(task.lastStatus).toUpperCase() === "RUNNING" &&
        String(task.healthStatus).toUpperCase() !== "UNHEALTHY"
          ? "ok"
          : "warn",
      metadata: {
        clusterArn: task.clusterArn ?? "",
        clusterName: task.clusterName ?? "",
        taskArn: task.arn ?? "",
        taskDefinitionArn: task.taskDefinitionArn ?? "",
        lastStatus: task.lastStatus ?? "",
        desiredStatus: task.desiredStatus ?? "",
        healthStatus: task.healthStatus ?? "",
        launchType: task.launchType ?? "",
        cpu: task.cpu ?? "",
        memory: task.memory ?? "",
        containerCount: task.containerCount ?? 0,
        startedAtMs: task.startedAt,
        stoppedAtMs: task.stoppedAt,
        stopCode: task.stopCode ?? "",
      },
    }));

    const serviceEventSignals = services
      .flatMap((service) =>
        service.events.map((event) => ({
          service,
          event,
        })),
      )
      .slice(0, 300)
      .map(({ service, event }) => ({
        type: "service-event",
        name: `${service.clusterName ?? "cluster"}/${service.name ?? "service"}`,
        status: /error|failed|unable|unhealthy/i.test(event.message)
          ? "warn"
          : "info",
        metadata: {
          clusterArn: service.clusterArn ?? "",
          clusterName: service.clusterName ?? "",
          serviceArn: service.arn ?? "",
          eventId: event.id ?? "",
          message: event.message ?? "",
          createdAtMs: event.createdAt,
        },
      }));

    const signals = [
      ...clusterSignals,
      ...serviceSignals,
      ...deploymentSignals,
      ...taskSignals,
      ...serviceEventSignals,
    ];

    return {
      ...status,
      mode: "telemetry",
      serviceCount: services.length,
      taskCount: tasks.length,
      deploymentCount: services.reduce(
        (sum, service) => sum + service.deployments.length,
        0,
      ),
      serviceEventCount: services.reduce(
        (sum, service) => sum + service.events.length,
        0,
      ),
      warnings,
      resourceCount: status.clusterCount + services.length + tasks.length,
      signals,
    };
  }

  return {
    getStatus,
    getTelemetry,
  };
}
