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
  }));
}

export function createKubernetesConnector(options = {}) {
  const command = options.command ?? "kubectl";

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

  return {
    getStatus,
  };
}
