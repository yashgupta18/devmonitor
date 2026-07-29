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

export function createNomadConnector(options = {}) {
  const command = options.command ?? "nomad";

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

  return {
    getStatus,
  };
}
