import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function safeParseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function parseDockerPsJsonLines(stdout) {
  const lines = String(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map(safeParseJson)
    .filter(Boolean)
    .map((container) => ({
      id: container.ID,
      name: container.Names,
      image: container.Image,
      command: container.Command,
      state: container.State,
      status: container.Status,
      ports: container.Ports,
      runningFor: container.RunningFor,
      createdAt: container.CreatedAt,
      mounts: container.Mounts,
      networks: container.Networks,
    }));
}

export function parseDockerStatsJsonLines(stdout) {
  const lines = String(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map(safeParseJson)
    .filter(Boolean)
    .map((stats) => ({
      id: stats.ID,
      name: stats.Name,
      cpuPercent: stats.CPUPerc,
      memoryUsage: stats.MemUsage,
      memoryPercent: stats.MemPerc,
      netIO: stats.NetIO,
      blockIO: stats.BlockIO,
      pids: stats.PIDs,
    }));
}

export function summarizeDockerLogText(stdout) {
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

export function createDockerConnector(options = {}) {
  const command = options.command ?? "docker";
  const logSampleContainersLimit = Math.max(
    0,
    Number(options.logSampleContainersLimit ?? 3),
  );
  const logTailLines = Math.max(1, Number(options.logTailLines ?? 40));
  const logSince = String(options.logSince ?? "10m");

  async function getStatus() {
    try {
      const { stdout } = await execFileAsync(command, [
        "ps",
        "--format",
        "{{json .}}",
      ]);

      const containers = parseDockerPsJsonLines(stdout);
      return {
        ok: true,
        available: true,
        connector: "docker",
        containerCount: containers.length,
        containers,
        generatedAtMs: Date.now(),
      };
    } catch (error) {
      const message = String(error?.message ?? "docker connector unavailable");
      return {
        ok: false,
        available: false,
        connector: "docker",
        containerCount: 0,
        containers: [],
        error: message,
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
    let stats = [];
    try {
      const statsResult = await execFileAsync(command, [
        "stats",
        "--no-stream",
        "--format",
        "{{json .}}",
      ]);
      stats = parseDockerStatsJsonLines(statsResult.stdout);
    } catch (error) {
      warnings.push(`stats_unavailable:${String(error?.message ?? "unknown")}`);
    }

    const statsByName = new Map(stats.map((item) => [item.name, item]));
    const statsById = new Map(stats.map((item) => [item.id, item]));

    const logSignals = [];
    const runningContainers = status.containers.filter(
      (container) => container.state === "running",
    );

    for (const container of runningContainers.slice(
      0,
      logSampleContainersLimit,
    )) {
      const target = container.id || container.name;
      if (!target) {
        continue;
      }

      try {
        const logsResult = await execFileAsync(command, [
          "logs",
          target,
          `--tail=${logTailLines}`,
          `--since=${logSince}`,
        ]);
        const summary = summarizeDockerLogText(logsResult.stdout);
        logSignals.push({
          type: "container-log",
          name: container.name ?? container.id ?? "unknown-container",
          status: summary.errorLines > 0 ? "warn" : "ok",
          metadata: {
            id: container.id ?? "",
            image: container.image ?? "",
            sampleTailLines: logTailLines,
            sampleSince: logSince,
            totalLines: summary.totalLines,
            warningLines: summary.warningLines,
            errorLines: summary.errorLines,
          },
        });
      } catch (error) {
        warnings.push(
          `logs_unavailable:${target}:${String(error?.message ?? "unknown")}`,
        );
      }
    }

    const lifecycleSignals = status.containers
      .slice(0, 100)
      .map((container) => {
        const matchedStats =
          statsByName.get(container.name) ??
          statsById.get(container.id) ??
          null;

        return {
          type: "container-lifecycle",
          name: container.name ?? container.id ?? "unknown-container",
          status: container.state === "running" ? "ok" : "warn",
          metadata: {
            id: container.id ?? "",
            image: container.image ?? "",
            command: container.command ?? "",
            state: container.state ?? "",
            statusText: container.status ?? "",
            ports: container.ports ?? "",
            runningFor: container.runningFor ?? "",
            createdAt: container.createdAt ?? "",
            mounts: container.mounts ?? "",
            networks: container.networks ?? "",
            cpuPercent: matchedStats?.cpuPercent ?? "",
            memoryUsage: matchedStats?.memoryUsage ?? "",
            memoryPercent: matchedStats?.memoryPercent ?? "",
          },
        };
      });

    const resourceSignals = stats.slice(0, 100).map((item) => ({
      type: "container-metric",
      name: item.name ?? item.id ?? "unknown-container",
      status: "ok",
      metadata: {
        id: item.id ?? "",
        cpuPercent: item.cpuPercent ?? "",
        memoryUsage: item.memoryUsage ?? "",
        memoryPercent: item.memoryPercent ?? "",
        netIO: item.netIO ?? "",
        blockIO: item.blockIO ?? "",
        pids: item.pids ?? "",
      },
    }));

    const signals = [...lifecycleSignals, ...resourceSignals, ...logSignals];

    return {
      ...status,
      mode: "telemetry",
      statsCount: stats.length,
      logSampledContainers: logSignals.length,
      warnings,
      resourceCount: status.containerCount,
      signals,
    };
  }

  return {
    getStatus,
    getTelemetry,
  };
}
