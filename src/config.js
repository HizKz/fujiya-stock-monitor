import path from "node:path";

export const config = {
  targetUrl: "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/",
  stateFile: path.resolve(process.cwd(), "data/seen-products.json"),
  requestTimeoutMs: 20_000,
  retryDelayMs: 5_000,
  maxRetryAfterMs: 60_000,
  minimumProductCount: 10,
  userAgent:
    "fujiya-stock-monitor/1.0 (+https://github.com/HizKz/fujiya-stock-monitor)",
};

export function validateConfig(mode, env = process.env) {
  if (mode === "dry-run") return;

  const hasBotApiUrl = Boolean(env.NOTIFIER_API_URL);
  const hasBotApiToken = Boolean(env.NOTIFIER_API_TOKEN);
  if (hasBotApiUrl !== hasBotApiToken) {
    throw new Error("NOTIFIER_API_URL and NOTIFIER_API_TOKEN must be set together");
  }

  if (!hasBotApiUrl && !env.DISCORD_WEBHOOK_URL) {
    throw new Error(
      "Set NOTIFIER_API_URL and NOTIFIER_API_TOKEN, or use DISCORD_WEBHOOK_URL during migration"
    );
  }
}
