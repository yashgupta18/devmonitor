import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseKubectlPodsJson(stdout) {
  const payload = JSON.parse(stdout);
  const items = Array.isArray(payload.items) ? payload.items : [];

  return items.map((item) => ({
    namespace: item.metadata?.namespace ?? "default",
    name: item.metadata?.name ?? "unknown",
    phase: item.status?.phase ?? "Unknown",
    node: item.spec?.nodeName ?? "",
    podIp: item.status?.podIP ?? "",
    restarts: Array.isArray(item.status?.containerStatuses)
      ? item.status.containerStatuses.reduce(
          (sum, status) => sum + Number(status?.restartCount ?? 0),
          0,
        )
      : 0,
    readyContainers: Array.isArray(item.status?.containerStatuses)
      ? item.status.containerStatuses.filter((status) => status?.ready).length
      : 0,
    totalContainers: Array.isArray(item.status?.containerStatuses)
      ? item.status.containerStatuses.length
      : 0,
  }));
}

export function parseKubectlServicesJson(stdout) {
  const payload = JSON.parse(stdout);
  const items = Array.isArray(payload.items) ? payload.items : [];

  return items.map((item) => {
    const ingress = Array.isArray(item.status?.loadBalancer?.ingress)
      ? item.status.loadBalancer.ingress
      : [];
    const externalIps = Array.isArray(item.spec?.externalIPs)
      ? item.spec.externalIPs
      : [];

    return {
      namespace: item.metadata?.namespace ?? "default",
      name: item.metadata?.name ?? "unknown",
      type: item.spec?.type ?? "ClusterIP",
      clusterIP: item.spec?.clusterIP ?? "",
      ports: Array.isArray(item.spec?.ports)
        ? item.spec.ports.map(
            (port) => `${port.port ?? ""}/${port.protocol ?? "TCP"}`,
          )
        : [],
      externalTargets: [
        ...externalIps,
        ...ingress
          .map((itemIngress) => itemIngress.ip ?? itemIngress.hostname ?? "")
          .filter(Boolean),
      ],
    };
  });
}

export function parseKubectlDeploymentsJson(stdout) {
  const payload = JSON.parse(stdout);
  const items = Array.isArray(payload.items) ? payload.items : [];

  return items.map((item) => {
    const desiredReplicas = Number(item.spec?.replicas ?? 1);
    const updatedReplicas = Number(item.status?.updatedReplicas ?? 0);
    const availableReplicas = Number(item.status?.availableReplicas ?? 0);
    const unavailableReplicas = Number(item.status?.unavailableReplicas ?? 0);
    const rolloutHealthy =
      availableReplicas >= desiredReplicas &&
      updatedReplicas >= desiredReplicas &&
      unavailableReplicas === 0;

    return {
      namespace: item.metadata?.namespace ?? "default",
      name: item.metadata?.name ?? "unknown",
      desiredReplicas,
      updatedReplicas,
      availableReplicas,
      unavailableReplicas,
      observedGeneration: Number(item.status?.observedGeneration ?? 0),
      rolloutStatus: rolloutHealthy ? "healthy" : "progressing",
    };
  });
}

export function parseKubectlTopPodsTable(stdout) {
  const lines = String(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 4)
    .map((parts) => ({
      namespace: parts[0],
      name: parts[1],
      cpu: parts[2],
      memory: parts[3],
    }));
}

export function summarizeLogText(stdout) {
  const lines = String(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLines = lines.filter((line) =>
    /\b(error|exception|fatal|panic)\b/i.test(line),
  ).length;
  const warningLines = lines.filter((line) =>
    /\b(warn|warning|deprecated)\b/i.test(line),
  ).length;

  return {
    totalLines: lines.length,
    errorLines,
    warningLines,
  };
}

export function createKubernetesConnector(options = {}) {
  const command = options.command ?? "kubectl";
  const logSamplePodsLimit = Math.max(
    0,
    Number(options.logSamplePodsLimit ?? 3),
  );
  const logTailLines = Math.max(1, Number(options.logTailLines ?? 40));
  const logSince = String(options.logSince ?? "10m");

  async function getStatus() {
    try {
      const contextResult = await execFileAsync(command, [
        "config",
        "current-context",
      ]);
      const context = String(contextResult.stdout).trim();

      const podsResult = await execFileAsync(command, [
        "get",
        "pods",
        "-A",
        "-o",
        "json",
      ]);

      const pods = parseKubectlPodsJson(podsResult.stdout);
      return {
        ok: true,
        available: true,
        connector: "kubernetes",
        context,
        podCount: pods.length,
        pods: pods.slice(0, 20),
        generatedAtMs: Date.now(),
      };
    } catch (error) {
      return {
        ok: false,
        available: false,
        connector: "kubernetes",
        context: "",
        podCount: 0,
        pods: [],
        error: String(error?.message ?? "kubernetes connector unavailable"),
        generatedAtMs: Date.now(),
      };
    }
  }

  async function getTelemetry() {
    const baseStatus = await getStatus();
    if (!baseStatus.ok) {
      return {
        ...baseStatus,
        mode: "telemetry",
        resourceCount: 0,
        signals: [],
      };
    }

    let pods = [];
    let services = [];
    let deployments = [];
    let podMetrics = [];
    const warnings = [];

    try {
      const podsResult = await execFileAsync(command, [
        "get",
        "pods",
        "-A",
        "-o",
        "json",
      ]);
      pods = parseKubectlPodsJson(podsResult.stdout);
    } catch (error) {
      warnings.push(`pods_unavailable:${String(error?.message ?? "unknown")}`);
    }

    try {
      const servicesResult = await execFileAsync(command, [
        "get",
        "services",
        "-A",
        "-o",
        "json",
      ]);
      services = parseKubectlServicesJson(servicesResult.stdout);
    } catch (error) {
      warnings.push(
        `services_unavailable:${String(error?.message ?? "unknown")}`,
      );
    }

    try {
      const deploymentsResult = await execFileAsync(command, [
        "get",
        "deployments",
        "-A",
        "-o",
        "json",
      ]);
      deployments = parseKubectlDeploymentsJson(deploymentsResult.stdout);
    } catch (error) {
      warnings.push(
        `deployments_unavailable:${String(error?.message ?? "unknown")}`,
      );
    }

    try {
      const topPodsResult = await execFileAsync(command, [
        "top",
        "pods",
        "-A",
        "--no-headers",
      ]);
      podMetrics = parseKubectlTopPodsTable(topPodsResult.stdout);
    } catch (error) {
      warnings.push(
        `pod_metrics_unavailable:${String(error?.message ?? "unknown")}`,
      );
    }

    const metricByPod = new Map(
      podMetrics.map((metric) => [
        `${metric.namespace}/${metric.name}`,
        {
          cpu: metric.cpu,
          memory: metric.memory,
        },
      ]),
    );

    const logSignals = [];
    const runningPods = pods.filter((pod) => pod.phase === "Running");
    for (const pod of runningPods.slice(0, logSamplePodsLimit)) {
      try {
        const logsResult = await execFileAsync(command, [
          "logs",
          pod.name,
          "-n",
          pod.namespace,
          `--tail=${logTailLines}`,
          `--since=${logSince}`,
        ]);
        const summary = summarizeLogText(logsResult.stdout);
        logSignals.push({
          type: "pod-log",
          name: `${pod.namespace}/${pod.name}`,
          status: summary.errorLines > 0 ? "warn" : "ok",
          metadata: {
            namespace: pod.namespace,
            pod: pod.name,
            totalLines: summary.totalLines,
            warningLines: summary.warningLines,
            errorLines: summary.errorLines,
            sampleTailLines: logTailLines,
            sampleSince: logSince,
          },
        });
      } catch (error) {
        warnings.push(
          `pod_logs_unavailable:${pod.namespace}/${pod.name}:${String(error?.message ?? "unknown")}`,
        );
      }
    }

    const podSignals = pods.slice(0, 100).map((pod) => {
      const podMetric = metricByPod.get(`${pod.namespace}/${pod.name}`) ?? {};
      return {
        type: "pod",
        name: `${pod.namespace}/${pod.name}`,
        status: pod.phase === "Running" ? "ok" : "warn",
        metadata: {
          namespace: pod.namespace ?? "default",
          phase: pod.phase ?? "Unknown",
          node: pod.node ?? "",
          podIp: pod.podIp ?? "",
          restarts: pod.restarts ?? 0,
          readyContainers: pod.readyContainers ?? 0,
          totalContainers: pod.totalContainers ?? 0,
          cpu: podMetric.cpu ?? "",
          memory: podMetric.memory ?? "",
        },
      };
    });

    const serviceSignals = services.slice(0, 100).map((service) => ({
      type: "service",
      name: `${service.namespace}/${service.name}`,
      status: service.externalTargets.length > 0 ? "ok" : "info",
      metadata: {
        namespace: service.namespace,
        type: service.type,
        clusterIP: service.clusterIP,
        ports: service.ports.join(","),
        externalTargets: service.externalTargets.join(","),
      },
    }));

    const rolloutSignals = deployments.slice(0, 100).map((deployment) => ({
      type: "rollout",
      name: `${deployment.namespace}/${deployment.name}`,
      status: deployment.rolloutStatus === "healthy" ? "ok" : "warn",
      metadata: {
        namespace: deployment.namespace,
        desiredReplicas: deployment.desiredReplicas,
        updatedReplicas: deployment.updatedReplicas,
        availableReplicas: deployment.availableReplicas,
        unavailableReplicas: deployment.unavailableReplicas,
        observedGeneration: deployment.observedGeneration,
        rolloutStatus: deployment.rolloutStatus,
      },
    }));

    const signals = [
      ...podSignals,
      ...serviceSignals,
      ...rolloutSignals,
      ...logSignals,
    ];

    return {
      ...baseStatus,
      mode: "telemetry",
      podCount: pods.length,
      serviceCount: services.length,
      deploymentCount: deployments.length,
      podMetricsCount: podMetrics.length,
      logSampledPods: logSignals.length,
      warnings,
      resourceCount: pods.length + services.length + deployments.length,
      signals,
    };
  }

  return {
    getStatus,
    getTelemetry,
  };
}
