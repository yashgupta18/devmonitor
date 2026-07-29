import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseGitLogOutput(stdout) {
  return String(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, ...messageParts] = line.split("|");
      return {
        sha,
        shortSha: String(sha).slice(0, 8),
        author,
        date,
        message: messageParts.join("|").trim(),
      };
    });
}

export function scoreCommit(message, keywords) {
  const haystack = String(message).toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (keyword.length > 2 && haystack.includes(keyword)) {
      score += 1;
    }
  }
  return score;
}

function inferKeywords(incident, impactedEndpoints) {
  const base = String(incident)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  for (const endpoint of impactedEndpoints) {
    base.push(
      ...String(endpoint)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
  }

  return Array.from(new Set(base));
}

function parseGithubSlug(remoteUrl) {
  const value = String(remoteUrl).trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("git@github.com:")) {
    return value.replace("git@github.com:", "").replace(/\.git$/, "");
  }

  if (value.startsWith("https://github.com/")) {
    return value.replace("https://github.com/", "").replace(/\.git$/, "");
  }

  return null;
}

export function createGitHubIntelligence(options = {}) {
  const repoPath = options.repoPath ?? process.cwd();
  const command = options.command ?? "git";

  async function getRemoteSlug() {
    try {
      const { stdout } = await execFileAsync(
        command,
        ["config", "--get", "remote.origin.url"],
        { cwd: repoPath },
      );
      return parseGithubSlug(stdout);
    } catch {
      return null;
    }
  }

  async function getRecentCommits(limit = 30) {
    const { stdout } = await execFileAsync(
      command,
      [
        "--no-pager",
        "log",
        `-n${Math.max(1, limit)}`,
        "--date=iso",
        "--pretty=format:%H|%an|%ad|%s",
      ],
      { cwd: repoPath },
    );

    return parseGitLogOutput(stdout);
  }

  function inferImpactedEndpoints(traces) {
    return traces
      .filter(
        (trace) =>
          (trace.statusCode ?? 0) >= 500 ||
          (Number.isFinite(trace.durationMs) && trace.durationMs >= 250),
      )
      .map((trace) => `${trace.method} ${trace.path}`)
      .slice(0, 5);
  }

  async function analyzeIncident({ incident, traces = [], limit = 5 }) {
    const text = incident?.trim() || "Unknown incident";
    try {
      const [commits, slug] = await Promise.all([
        getRecentCommits(Math.max(limit * 4, 20)),
        getRemoteSlug(),
      ]);

      const impactedEndpoints = inferImpactedEndpoints(traces);
      const keywords = inferKeywords(text, impactedEndpoints);

      const suspects = commits
        .map((commit) => {
          const score = scoreCommit(commit.message, keywords);
          return {
            ...commit,
            score,
            suggestedPullRequest: slug
              ? `https://github.com/${slug}/commit/${commit.sha}`
              : null,
          };
        })
        .filter((commit) => commit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return {
        ok: true,
        incident: text,
        impactedEndpoints,
        suspects,
        generatedAtMs: Date.now(),
      };
    } catch (error) {
      return {
        ok: false,
        incident: text,
        impactedEndpoints: [],
        suspects: [],
        error: String(error?.message ?? "unable to analyze incident"),
        generatedAtMs: Date.now(),
      };
    }
  }

  return {
    analyzeIncident,
    getRecentCommits,
    getRemoteSlug,
  };
}
