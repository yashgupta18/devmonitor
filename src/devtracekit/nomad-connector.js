import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseNomadNodeStatusJson(stdout) {
  const payload = JSON.parse(stdout);
  const items = Array.isArray(payload) ? payload : [];

  return items.map((node) => ({
    id: node.ID,
    name: node.Name,
    datacenter: node.Datacenter,
    status: node.Status,
  }));
}

export function parseNomadJobStatusJson(stdout) {
  const payload = JSON.parse(stdout);
  const items = Array.isArray(payload) ? payload : [];

  return items.map((job) => ({
    id: job.ID,
    name: job.Name ?? job.ID,
    namespace: job.Namespace ?? "default",
    type: job.Type ?? "service",
    status: job.Status ?? "unknown",
    priority: Number(job.Priority ?? 0),
    datacenters: Array.isArray(job.Datacenters) ? job.Datacenters : [],
    version: Number(job.Version ?? 0),
    modifyIndex: Number(job.ModifyIndex ?? 0),
  }));
}

export function parseNomadJobAllocationsJson(stdout) {
  const payload = JSON.parse(stdout);
  const items = Array.isArray(payload) ? payload : [];

  return items.map((allocation) => ({
    id: allocation.ID,
    name: allocation.Name,
    namespace: allocation.Namespace ?? "default",
    jobId: allocation.JobID,
    nodeId: allocation.NodeID,
    taskGroup: allocation.TaskGroup ?? "",
    clientStatus: allocation.ClientStatus ?? "unknown",
    desiredStatus: allocation.DesiredStatus ?? "unknown",
    createTime: Number(allocation.CreateTime ?? 0),
    modifyTime: Number(allocation.ModifyTime ?? 0),
  }));
}

export function parseNomadJobDeploymentsJson(stdout) {
  const payload = JSON.parse(stdout);
  const items = Array.isArray(payload) ? payload : [];

  return items.map((deployment) => ({
    id: deployment.ID,
    namespace: deployment.Namespace ?? "default",
    jobId: deployment.JobID,
    status: deployment.Status ?? "unknown",
    statusDescription: deployment.StatusDescription ?? "",
    createTime: Number(deployment.CreateTime ?? 0),
    modifyTime: Number(deployment.ModifyTime ?? 0),
    taskGroups: deployment.TaskGroups ?? {},
  }));
}

export function createNomadConnector(options = {}) {
  const command = options.command ?? "nomad";
  const maxJobs = Math.max(1, Number(options.maxJobs ?? 20));
  const maxAllocationsPerJob = Math.max(
    1,
    Number(options.maxAllocationsPerJob ?? 20),
  );
  const maxDeploymentsPerJob = Math.max(
    1,
    Number(options.maxDeploymentsPerJob ?? 10),
  );

  async function getStatus() {
    try {
      const result = await execFileAsync(command, ["node", "status", "-json"]);
      const nodes = parseNomadNodeStatusJson(result.stdout);

      return {
        ok: true,
        available: true,
        connector: "nomad",
        nodeCount: nodes.length,
        nodes,
        generatedAtMs: Date.now(),
      };
    } catch (error) {
      return {
        ok: false,
        available: false,
        connector: "nomad",
        nodeCount: 0,
        nodes: [],
        error: String(error?.message ?? "nomad connector unavailable"),
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
    let jobs = [];
    const allocations = [];
    const deployments = [];

    try {
      const jobsResult = await execFileAsync(command, [
        "job",
        "status",
        "-json",
      ]);
      jobs = parseNomadJobStatusJson(jobsResult.stdout).slice(0, maxJobs);
    } catch (error) {
      warnings.push(`jobs_unavailable:${String(error?.message ?? "unknown")}`);
    }

    for (const job of jobs) {
      try {
        const allocationsResult = await execFileAsync(command, [
          "job",
          "allocations",
          "-json",
          job.id,
        ]);
        const parsedAllocations = parseNomadJobAllocationsJson(
          allocationsResult.stdout,
        )
          .slice(0, maxAllocationsPerJob)
          .map((allocation) => ({ ...allocation, jobName: job.name }));
        allocations.push(...parsedAllocations);
      } catch (error) {
        warnings.push(
          `allocations_unavailable:${job.id}:${String(error?.message ?? "unknown")}`,
        );
      }

      try {
        const deploymentsResult = await execFileAsync(command, [
          "job",
          "deployments",
          "-json",
          job.id,
        ]);
        const parsedDeployments = parseNomadJobDeploymentsJson(
          deploymentsResult.stdout,
        )
          .slice(0, maxDeploymentsPerJob)
          .map((deployment) => ({ ...deployment, jobName: job.name }));
        deployments.push(...parsedDeployments);
      } catch (error) {
        warnings.push(
          `deployments_unavailable:${job.id}:${String(error?.message ?? "unknown")}`,
        );
      }
    }

    const nodeSignals = status.nodes.slice(0, 100).map((node) => ({
      type: "node",
      name: node.name ?? node.id ?? "unknown-node",
      status: node.status === "ready" ? "ok" : "warn",
      metadata: {
        id: node.id ?? "",
        datacenter: node.datacenter ?? "",
        status: node.status ?? "",
      },
    }));

    const jobSignals = jobs.slice(0, 200).map((job) => ({
      type: "job",
      name: `${job.namespace}/${job.name}`,
      status: String(job.status).toLowerCase() === "running" ? "ok" : "warn",
      metadata: {
        id: job.id ?? "",
        namespace: job.namespace ?? "default",
        type: job.type ?? "",
        status: job.status ?? "",
        priority: job.priority ?? 0,
        datacenters: job.datacenters.join(","),
        version: job.version ?? 0,
        modifyIndex: job.modifyIndex ?? 0,
      },
    }));

    const allocationSignals = allocations.slice(0, 300).map((allocation) => ({
      type: "allocation",
      name: `${allocation.namespace}/${allocation.jobName ?? allocation.jobId}:${allocation.id?.slice(0, 8) ?? "alloc"}`,
      status:
        String(allocation.clientStatus).toLowerCase() === "running"
          ? "ok"
          : "warn",
      metadata: {
        id: allocation.id ?? "",
        namespace: allocation.namespace ?? "default",
        jobId: allocation.jobId ?? "",
        nodeId: allocation.nodeId ?? "",
        taskGroup: allocation.taskGroup ?? "",
        clientStatus: allocation.clientStatus ?? "",
        desiredStatus: allocation.desiredStatus ?? "",
        createTime: allocation.createTime ?? 0,
        modifyTime: allocation.modifyTime ?? 0,
      },
    }));

    const deploymentSignals = deployments.slice(0, 200).map((deployment) => ({
      type: "deployment",
      name: `${deployment.namespace}/${deployment.jobName ?? deployment.jobId}:${deployment.id?.slice(0, 8) ?? "deploy"}`,
      status:
        String(deployment.status).toLowerCase() === "successful"
          ? "ok"
          : "warn",
      metadata: {
        id: deployment.id ?? "",
        namespace: deployment.namespace ?? "default",
        jobId: deployment.jobId ?? "",
        status: deployment.status ?? "",
        statusDescription: deployment.statusDescription ?? "",
        createTime: deployment.createTime ?? 0,
        modifyTime: deployment.modifyTime ?? 0,
      },
    }));

    const deploymentEventSignals = deployments
      .filter((deployment) => deployment.statusDescription)
      .slice(0, 300)
      .map((deployment) => ({
        type: "deployment-event",
        name: `${deployment.namespace}/${deployment.jobName ?? deployment.jobId}`,
        status: /fail|error|cancel|blocked/i.test(deployment.statusDescription)
          ? "warn"
          : "info",
        metadata: {
          deploymentId: deployment.id ?? "",
          namespace: deployment.namespace ?? "default",
          jobId: deployment.jobId ?? "",
          status: deployment.status ?? "",
          statusDescription: deployment.statusDescription ?? "",
          createTime: deployment.createTime ?? 0,
          modifyTime: deployment.modifyTime ?? 0,
        },
      }));

    const signals = [
      ...nodeSignals,
      ...jobSignals,
      ...allocationSignals,
      ...deploymentSignals,
      ...deploymentEventSignals,
    ];

    return {
      ...status,
      mode: "telemetry",
      jobCount: jobs.length,
      allocationCount: allocations.length,
      deploymentCount: deployments.length,
      warnings,
      resourceCount:
        status.nodeCount +
        jobs.length +
        allocations.length +
        deployments.length,
      signals,
    };
  }

  return {
    getStatus,
    getTelemetry,
  };
}
