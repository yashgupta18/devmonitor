import test from "node:test";
import assert from "node:assert/strict";
import {
  createGitHubIntelligence,
  parseGitLogOutput,
  scoreCommit,
} from "../src/devtracekit/github-intelligence.js";

test("parseGitLogOutput parses commit lines", () => {
  const output = [
    "a1b2c3d4|Yash|2025-01-01 12:00:00 +0000|fix checkout timeout",
    "b2c3d4e5|Alex|2025-01-02 12:00:00 +0000|refactor cache layer",
  ].join("\n");

  const commits = parseGitLogOutput(output);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].shortSha, "a1b2c3d4");
  assert.equal(commits[0].message, "fix checkout timeout");
});

test("scoreCommit ranks matching keywords", () => {
  const score = scoreCommit("fix checkout error spike", [
    "checkout",
    "error",
    "nomatch",
  ]);

  assert.equal(score, 2);
});

test("analyzeIncident returns graceful error when git unavailable", async () => {
  const intelligence = createGitHubIntelligence({
    command: "git-non-existent-command",
  });

  const report = await intelligence.analyzeIncident({
    incident: "checkout 500 spike",
    traces: [],
    limit: 3,
  });

  assert.equal(report.ok, false);
  assert.equal(report.suspects.length, 0);
  assert.ok(report.error.includes("unable") || report.error.length > 0);
});
