import "dotenv/config";

import type { Product, RunMode, RunResult } from "../shared/domain.ts";
import { runMonitor } from "./app.ts";
import { config, type NotificationEnv, validateConfig } from "./config.ts";
import { postNewProducts, postTestNotification } from "./discord.ts";
import { fetchProducts } from "./fetchProducts.ts";
import { postBotNotification, postBotTestNotification } from "./notifier.ts";
import { findNewProducts, loadState, saveState, withSeenProducts } from "./state.ts";

export async function main(args: string[] = process.argv.slice(2)): Promise<RunResult> {
  const mode = getMode(args);
  validateConfig(mode);

  return runMonitor(mode, {
    config,
    fetchProducts,
    loadState,
    saveState,
    findNewProducts,
    withSeenProducts,
    sendNotification,
    notifierName: hasBotNotifier() ? "Bot" : "webhook",
  });
}

export function getMode(args: string[]): RunMode {
  if (args.includes("--dry-run")) return "dry-run";
  if (args.includes("--bot-test") || args.includes("--webhook-test")) return "notification-test";
  return "monitor";
}

async function sendNotification(products: Product[], test = false): Promise<void> {
  if (hasBotNotifier()) {
    const send = test ? postBotTestNotification : postBotNotification;
    await send(
      requireEnvironmentValue("NOTIFIER_API_URL"),
      requireEnvironmentValue("NOTIFIER_API_TOKEN"),
      products
    );
    return;
  }

  const send = test ? postTestNotification : postNewProducts;
  await send(requireEnvironmentValue("DISCORD_WEBHOOK_URL"), products);
}

export function hasBotNotifier(env: NotificationEnv = process.env): boolean {
  return Boolean(env.NOTIFIER_API_URL && env.NOTIFIER_API_TOKEN);
}

function requireEnvironmentValue(name: keyof NotificationEnv): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
