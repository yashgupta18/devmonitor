import { DevTraceKitCore } from "./core.js";
import { createDashboardServer } from "./dashboard.js";
import { createDockerConnector } from "./docker-connector.js";
import { createKubernetesConnector } from "./kubernetes-connector.js";
import { createEcsConnector } from "./ecs-connector.js";
import { createNomadConnector } from "./nomad-connector.js";
import { createGitHubIntelligence } from "./github-intelligence.js";

export function createDevTraceKit(options = {}) {
  const core = new DevTraceKitCore(options);
  const githubIntelligence = createGitHubIntelligence(
    options.githubIntelligence ?? {},
  );
  const docker = createDockerConnector(options.docker ?? {});
  const kubernetes = createKubernetesConnector(options.kubernetes ?? {});
  const ecs = createEcsConnector(options.ecs ?? {});
  const nomad = createNomadConnector(options.nomad ?? {});
  const connectors = { docker, kubernetes, ecs, nomad };
  const dashboard = createDashboardServer(core, connectors, {
    ...options,
    githubIntelligence,
  });

  return {
    core,
    dashboard,
    connectors,
    githubIntelligence,
    middleware: core.middleware.bind(core),
    instrument: core.instrument,
  };
}
