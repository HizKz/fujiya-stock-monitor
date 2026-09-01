import assert from "node:assert/strict";
import test from "node:test";

import worker, { handleScheduled } from "../worker/index.js";

function createKv(initialValue = null) {
  let value = initialValue;
  return {
    async get() {
      return value;
    },
    async put(_key, nextValue) {
      value = nextValue;
    },
  };
}

test("scheduled run records a successful GitHub dispatch", async () => {
  const kv = createKv();
  let dispatched = false;

  await handleScheduled(
    { cron: "*/10 * * * *", scheduledTime: Date.UTC(2026, 8, 2, 0, 10) },
    { NOTIFICATIONS: kv },
    {
      triggerMonitorWorkflowImpl: async () => {
        dispatched = true;
      },
    }
  );

  assert.equal(dispatched, true);
  const status = JSON.parse(await kv.get());
  assert.equal(status.ok, true);
  assert.equal(status.cron, "*/10 * * * *");
  assert.equal(status.scheduledTime, "2026-09-02T00:10:00.000Z");
});

test("health endpoint returns the last scheduler status", async () => {
  const savedStatus = JSON.stringify({ ok: true, completedAt: "2026-09-02T00:10:01.000Z" });
  const response = await worker.fetch(new Request("https://example.com/health"), {
    NOTIFICATIONS: createKv(savedStatus),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    scheduler: { ok: true, completedAt: "2026-09-02T00:10:01.000Z" },
  });
});

test("scheduled run records a failed GitHub dispatch", async () => {
  const kv = createKv();

  await assert.rejects(
    handleScheduled(
      { cron: "*/10 * * * *", scheduledTime: Date.UTC(2026, 8, 2, 0, 20) },
      { NOTIFICATIONS: kv },
      {
        triggerMonitorWorkflowImpl: async () => {
          throw new Error("GitHub rejected the request");
        },
      }
    ),
    /GitHub rejected/
  );

  const status = JSON.parse(await kv.get());
  assert.equal(status.ok, false);
  assert.equal(status.error, "GitHub rejected the request");
});
