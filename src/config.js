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
  if (mode !== "dry-run" && !env.DISCORD_WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL is not set");
  }
}
