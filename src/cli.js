#!/usr/bin/env node
import express from "express";
import { createDevScope } from "./devscope/index.js";
import { startExampleApp } from "../examples/local-debug-app.js";

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    command: argv[2],
    example: args.has("--example"),
    dashboardPort: Number(process.env.DEVSCOPE_DASHBOARD_PORT ?? 4318),
    appPort: Number(process.env.DEVSCOPE_APP_PORT ?? 3000),
  };
}

async function startStandalone(options) {
  const devscope = createDevScope({ dashboardPort: options.dashboardPort });
  const app = express();
  app.disable("x-powered-by");
  app.use(devscope.middleware("standalone-app"));

  app.get("/", (_req, res) => {
    res.json({
      message: "DevScope standalone app running",
      hint: "Use devscope start --example for full flow simulation",
    });
  });

  app.listen(options.appPort, () => {
    console.log(
      `[devscope] app running on http://localhost:${options.appPort}`,
    );
  });
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.command !== "start") {
    console.log("Usage: devscope start [--example]");
    process.exit(1);
  }

  if (options.example) {
    await startExampleApp({
      dashboardPort: options.dashboardPort,
      appPort: options.appPort,
    });
    return;
  }

  await startStandalone(options);
}

try {
  await main();
} catch (error) {
  console.error("[devscope] failed to start", error);
  process.exit(1);
}
