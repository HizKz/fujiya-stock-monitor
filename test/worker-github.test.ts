import { expect, test } from "bun:test";

import { triggerMonitorWorkflow } from "../worker/github.ts";
import { jsonBody, must } from "./helpers.ts";

test("triggerMonitorWorkflow dispatches the monitor input", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  await triggerMonitorWorkflow(
    {
      GITHUB_TOKEN: "github-secret",
      GITHUB_OWNER: "HizKz",
      GITHUB_REPO: "fujiya-stock-monitor",
      GITHUB_WORKFLOW: "monitor.yml",
      GITHUB_REF: "main",
    },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ workflow_run_id: 123 }), { status: 200 });
      },
    }
  );

  const request = must(requests[0]);
  const headers = request.init?.headers as Record<string, string>;
  expect(request.url).toBe(
    "https://api.github.com/repos/HizKz/fujiya-stock-monitor/actions/workflows/monitor.yml/dispatches"
  );
  expect(headers.Authorization).toBe("Bearer github-secret");
  expect(jsonBody(request.init)).toEqual({
    ref: "main",
    inputs: { mode: "monitor" },
  });
});
