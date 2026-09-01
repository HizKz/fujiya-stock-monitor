import { createNotification, handleInteraction } from "./discord.js";
import { triggerMonitorWorkflow } from "./github.js";

const SCHEDULER_STATUS_KEY = "monitor:last-scheduled-run";
const MONITOR_INTERVAL_MS = 10 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const scheduler = await readSchedulerStatus(env);
        return new Response(JSON.stringify({ ok: true, scheduler }), {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      if (request.method === "POST" && url.pathname === "/notifications") {
        return await createNotification(request, env);
      }

      if (request.method === "POST" && url.pathname === "/interactions") {
        return await handleInteraction(request, env, ctx);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(error);
      return new Response("Internal server error", { status: 500 });
    }
  },

  async scheduled(controller, env) {
    await handleScheduled(controller, env);
  },
};

export async function handleScheduled(controller, env, options = {}) {
  const trigger = options.triggerMonitorWorkflowImpl || triggerMonitorWorkflow;
  const now = options.now ? new Date(options.now) : new Date();
  const startedAt = now.toISOString();
  const scheduledTime = Number.isFinite(controller?.scheduledTime)
    ? new Date(controller.scheduledTime).toISOString()
    : null;
  const cron = controller?.cron || null;
  const previousStatus = await readSchedulerStatus(env);
  const lastDispatchTime = Date.parse(previousStatus?.lastDispatchAt || "");

  if (
    Number.isFinite(lastDispatchTime) &&
    now.getTime() - lastDispatchTime < MONITOR_INTERVAL_MS
  ) {
    await writeSchedulerStatus(env, {
      ok: true,
      action: "skipped",
      cron,
      scheduledTime,
      startedAt,
      completedAt: new Date().toISOString(),
      lastDispatchAt: previousStatus.lastDispatchAt,
      nextDispatchAfter: new Date(lastDispatchTime + MONITOR_INTERVAL_MS).toISOString(),
    });
    return;
  }

  try {
    await trigger(env);
    const completedAt = new Date().toISOString();
    await writeSchedulerStatus(env, {
      ok: true,
      action: "dispatched",
      cron,
      scheduledTime,
      startedAt,
      completedAt,
      lastDispatchAt: completedAt,
      nextDispatchAfter: new Date(Date.parse(completedAt) + MONITOR_INTERVAL_MS).toISOString(),
    });
  } catch (error) {
    await writeSchedulerStatus(env, {
      ok: false,
      action: "failed",
      cron,
      scheduledTime,
      startedAt,
      completedAt: new Date().toISOString(),
      lastDispatchAt: previousStatus?.lastDispatchAt || null,
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    });
    throw error;
  }
}

async function readSchedulerStatus(env) {
  if (!env.NOTIFICATIONS) return null;

  try {
    const value = await env.NOTIFICATIONS.get(SCHEDULER_STATUS_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error("Failed to read scheduler status", error);
    return null;
  }
}

async function writeSchedulerStatus(env, status) {
  if (!env.NOTIFICATIONS) return;

  try {
    await env.NOTIFICATIONS.put(SCHEDULER_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    console.error("Failed to write scheduler status", error);
  }
}
