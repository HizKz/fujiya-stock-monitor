import { expect, test } from "bun:test";

import type { SchedulerStatus } from "../shared/domain.ts";
import type { NotificationKv } from "../worker/discord.ts";
import worker, { handleScheduled } from "../worker/index.ts";
import { responseJson } from "./helpers.ts";

function createKv(initialValue: string | null = null): NotificationKv {
  let value = initialValue;
  return {
    async get() {
      return value;
    },
    async put(_key: string, nextValue: string) {
      value = nextValue;
    },
    async delete() {
      value = null;
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

  expect(dispatched).toBe(true);
  const status = JSON.parse((await kv.get("status")) ?? "null") as SchedulerStatus;
  expect(status.ok).toBe(true);
  expect(status.action).toBe("dispatched");
  expect(status.cron).toBe("*/10 * * * *");
  expect(status.scheduledTime).toBe("2026-09-02T00:10:00.000Z");
  expect(status.lastDispatchAt).toBeTruthy();
});

test("scheduled run skips GitHub dispatch during the ten-minute interval", async () => {
  const lastDispatchAt = "2026-09-02T00:10:00.000Z";
  const kv = createKv(JSON.stringify({ ok: true, lastDispatchAt }));
  let dispatchCount = 0;

  await handleScheduled(
    { cron: "* * * * *", scheduledTime: Date.UTC(2026, 8, 2, 0, 15) },
    { NOTIFICATIONS: kv },
    {
      now: "2026-09-02T00:15:00.000Z",
      triggerMonitorWorkflowImpl: async () => {
        dispatchCount += 1;
      },
    }
  );

  expect(dispatchCount).toBe(0);
  const status = JSON.parse((await kv.get("status")) ?? "null") as SchedulerStatus;
  expect(status.ok).toBe(true);
  expect(status.action).toBe("skipped");
  expect(status.lastDispatchAt).toBe(lastDispatchAt);
  expect(status.nextDispatchAfter).toBe("2026-09-02T00:20:00.000Z");
});

test("health endpoint returns the last scheduler status", async () => {
  const savedStatus = JSON.stringify({ ok: true, completedAt: "2026-09-02T00:10:01.000Z" });
  const response = await worker.fetch(new Request("https://example.com/health"), {
    NOTIFICATIONS: createKv(savedStatus),
  });

  expect(response.status).toBe(200);
  expect(await responseJson<Record<string, unknown>>(response)).toEqual({
    ok: true,
    scheduler: { ok: true, completedAt: "2026-09-02T00:10:01.000Z" },
  });
});

test("scheduled run records a failed GitHub dispatch", async () => {
  const kv = createKv();

  await expect(
    handleScheduled(
      { cron: "*/10 * * * *", scheduledTime: Date.UTC(2026, 8, 2, 0, 20) },
      { NOTIFICATIONS: kv },
      {
        triggerMonitorWorkflowImpl: async () => {
          throw new Error("GitHub rejected the request");
        },
      }
    )
  ).rejects.toThrow(/GitHub rejected/);

  const status = JSON.parse((await kv.get("status")) ?? "null") as SchedulerStatus;
  expect(status.ok).toBe(false);
  expect(status.error).toBe("GitHub rejected the request");
});
