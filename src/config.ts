import path from "node:path";

import type { RunMode, RuntimeConfig } from "../shared/domain.ts";

export interface NotificationEnv {
  NOTIFIER_API_URL?: string;
  NOTIFIER_API_TOKEN?: string;
  DISCORD_WEBHOOK_URL?: string;
}

export const config = {
  targetUrl: "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/",
  stateFile: path.resolve(process.cwd(), "data/seen-products.json"),
  requestTimeoutMs: 20_000,
  retryDelayMs: 5_000,
  maxRetryAfterMs: 60_000,
  minimumProductCount: 10,
  userAgent:
    "fujiya-stock-monitor/1.0 (+https://github.com/HizKz/fujiya-stock-monitor)",
} satisfies RuntimeConfig;

export function validateConfig(mode: RunMode, env: NotificationEnv = process.env): void {
  if (mode === "dry-run") return;

  const hasBotApiUrl = Boolean(env.NOTIFIER_API_URL);
  const hasBotApiToken = Boolean(env.NOTIFIER_API_TOKEN);
  if (hasBotApiUrl !== hasBotApiToken) {
    throw new Error("NOTIFIER_API_URL and NOTIFIER_API_TOKEN must be set together");
  }

  if (mode === "notification-test" && !hasBotApiUrl) {
    throw new Error("Bot test requires NOTIFIER_API_URL and NOTIFIER_API_TOKEN");
  }

  if (!hasBotApiUrl && !env.DISCORD_WEBHOOK_URL) {
    throw new Error(
      "Set NOTIFIER_API_URL and NOTIFIER_API_TOKEN, or use DISCORD_WEBHOOK_URL during migration"
    );
  }
}
