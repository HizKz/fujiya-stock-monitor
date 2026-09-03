import type { SchedulerAction, SchedulerStatus } from "../shared/domain.ts";
import {
  createNotification,
  handleInteraction,
  type InteractionEnv,
  type NotificationEnv,
  type NotificationKv,
} from "./discord.ts";
import { triggerMonitorWorkflow, type GitHubEnv } from "./github.ts";

const SCHEDULER_STATUS_KEY = "monitor:last-scheduled-run";
const MONITOR_INTERVAL_MS = 10 * 60 * 1000;

interface AppEnv extends NotificationEnv, InteractionEnv, GitHubEnv {}

interface ScheduledEvent {
  cron?: string;
  scheduledTime?: number;
}

interface SchedulerOptions {
  triggerMonitorWorkflowImpl?: (env: GitHubEnv) => Promise<void>;
  now?: string | number | Date;
}

type StoredSchedulerStatus = Partial<SchedulerStatus>;

const worker = {
  async fetch(request: Request, env: AppEnv, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const scheduler = await readSchedulerStatus(env);
        return new Response(JSON.stringify({ ok: true, scheduler }), {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      if (request.method === "POST" && url.pathname === "/notifications") {
        return createNotification(request, env);
      }

      if (request.method === "POST" && url.pathname === "/interactions") {
        return handleInteraction(request, env, ctx);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(error);
      return new Response("Internal server error", { status: 500 });
    }
  },

  async scheduled(controller: ScheduledController, env: AppEnv): Promise<void> {
    await handleScheduled(controller, env);
  },
} satisfies ExportedHandler<Env>;

export default worker;

export async function handleScheduled(
  controller: ScheduledEvent,
  env: GitHubEnv & { NOTIFICATIONS?: NotificationKv },
  options: SchedulerOptions = {}
): Promise<void> {
  const trigger = options.triggerMonitorWorkflowImpl ?? triggerMonitorWorkflow;
  const now = options.now === undefined ? new Date() : new Date(options.now);
  const startedAt = now.toISOString();
  const scheduledTime = Number.isFinite(controller.scheduledTime)
    ? new Date(controller.scheduledTime as number).toISOString()
    : null;
  const intervalReferenceTime = scheduledTime === null ? now.getTime() : Date.parse(scheduledTime);
  const cron = controller.cron ?? null;
  const previousStatus = await readSchedulerStatus(env);
  const lastDispatchTime = Date.parse(previousStatus?.lastDispatchAt ?? "");

  if (
    Number.isFinite(lastDispatchTime) &&
    intervalReferenceTime - lastDispatchTime < MONITOR_INTERVAL_MS
  ) {
    await writeSchedulerStatus(env, {
      ok: true,
      action: "skipped",
      cron,
      scheduledTime,
      startedAt,
      completedAt: new Date().toISOString(),
      lastDispatchAt: previousStatus?.lastDispatchAt ?? null,
      nextDispatchAfter: new Date(lastDispatchTime + MONITOR_INTERVAL_MS).toISOString(),
    });
    return;
  }

  try {
    await trigger(env);
    const completedAt = new Date().toISOString();
    const lastDispatchAt = scheduledTime ?? completedAt;
    await writeSchedulerStatus(env, {
      ok: true,
      action: "dispatched",
      cron,
      scheduledTime,
      startedAt,
      completedAt,
      lastDispatchAt,
      nextDispatchAfter: new Date(Date.parse(lastDispatchAt) + MONITOR_INTERVAL_MS).toISOString(),
    });
  } catch (error) {
    await writeSchedulerStatus(env, {
      ok: false,
      action: "failed",
      cron,
      scheduledTime,
      startedAt,
      completedAt: new Date().toISOString(),
      lastDispatchAt: previousStatus?.lastDispatchAt ?? null,
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    });
    throw error;
  }
}

async function readSchedulerStatus(env: { NOTIFICATIONS?: NotificationKv }): Promise<StoredSchedulerStatus | null> {
  if (!env.NOTIFICATIONS) return null;

  try {
    const value = await env.NOTIFICATIONS.get(SCHEDULER_STATUS_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    return isSchedulerStatusRecord(parsed) ? parsed : null;
  } catch (error) {
    console.error("Failed to read scheduler status", error);
    return null;
  }
}

async function writeSchedulerStatus(
  env: { NOTIFICATIONS?: NotificationKv },
  status: SchedulerStatus
): Promise<void> {
  if (!env.NOTIFICATIONS) return;

  try {
    await env.NOTIFICATIONS.put(SCHEDULER_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    console.error("Failed to write scheduler status", error);
  }
}

function isSchedulerStatusRecord(value: unknown): value is StoredSchedulerStatus {
  if (!isRecord(value)) return false;
  if (value.ok !== undefined && typeof value.ok !== "boolean") return false;
  if (value.action !== undefined && !isSchedulerAction(value.action)) return false;
  for (const key of [
    "cron",
    "scheduledTime",
    "startedAt",
    "completedAt",
    "lastDispatchAt",
    "nextDispatchAfter",
    "error",
  ]) {
    const item = value[key];
    if (item !== undefined && item !== null && typeof item !== "string") return false;
  }
  return true;
}

function isSchedulerAction(value: unknown): value is SchedulerAction {
  return value === "dispatched" || value === "skipped" || value === "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
