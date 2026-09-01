import { createNotification, handleInteraction } from "./discord.js";
import { triggerMonitorWorkflow } from "./github.js";

const SCHEDULER_STATUS_KEY = "monitor:last-scheduled-run";

export default {
  async fetch(request, env) {
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
        return await handleInteraction(request, env);
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
  const startedAt = new Date().toISOString();
  const scheduledTime = Number.isFinite(controller?.scheduledTime)
    ? new Date(controller.scheduledTime).toISOString()
    : null;
  const cron = controller?.cron || null;

  try {
    await trigger(env);
    await writeSchedulerStatus(env, {
      ok: true,
      cron,
      scheduledTime,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    await writeSchedulerStatus(env, {
      ok: false,
      cron,
      scheduledTime,
      startedAt,
      completedAt: new Date().toISOString(),
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
