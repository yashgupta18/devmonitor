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
      state: container.State,
      status: container.Status,
      ports: container.Ports,
      runningFor: container.RunningFor,
    }));
}

export function createDockerConnector(options = {}) {
  const command = options.command ?? "docker";

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

  return {
    getStatus,
  };
}
