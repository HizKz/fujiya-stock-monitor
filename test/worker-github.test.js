import assert from "node:assert/strict";
import test from "node:test";

import { triggerMonitorWorkflow } from "../worker/github.js";

test("triggerMonitorWorkflow dispatches the monitor input", async () => {
  const requests = [];
  await triggerMonitorWorkflow(
    {
      GITHUB_TOKEN: "github-secret",
      GITHUB_OWNER: "HizKz",
      GITHUB_REPO: "fujiya-stock-monitor",
      GITHUB_WORKFLOW: "monitor.yml",
      GITHUB_REF: "main",
    },
    {
      fetchImpl: async (url, request) => {
        requests.push({ url, request });
        return new Response(JSON.stringify({ workflow_run_id: 123 }), { status: 200 });
      },
    }
  );

  assert.equal(
    requests[0].url,
    "https://api.github.com/repos/HizKz/fujiya-stock-monitor/actions/workflows/monitor.yml/dispatches"
  );
  assert.equal(requests[0].request.headers.Authorization, "Bearer github-secret");
  assert.deepEqual(JSON.parse(requests[0].request.body), {
    ref: "main",
    inputs: { mode: "monitor" },
  });
});
