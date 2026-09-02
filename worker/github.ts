import type { FetchLike } from "../shared/domain.ts";

const GITHUB_API_VERSION = "2026-03-10";

export interface GitHubEnv {
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_WORKFLOW?: string;
  GITHUB_REF?: string;
}

interface GitHubOptions {
  fetchImpl?: FetchLike;
}

export async function triggerMonitorWorkflow(
  env: GitHubEnv,
  options: GitHubOptions = {}
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const owner = env.GITHUB_OWNER || "HizKz";
  const repo = env.GITHUB_REPO || "fujiya-stock-monitor";
  const workflow = env.GITHUB_WORKFLOW || "monitor.yml";
  const ref = env.GITHUB_REF || "main";
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;

  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "fujiya-stock-bot-worker",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({ ref, inputs: { mode: "monitor" } }),
  });

  if (!response.ok) {
    const body = await safeResponseText(response);
    throw new Error(
      `GitHub workflow dispatch failed with HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  console.log(`Triggered ${owner}/${repo} ${workflow} on ${ref}`);
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
