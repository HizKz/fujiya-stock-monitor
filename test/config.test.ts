import { expect, test } from "bun:test";

import { validateConfig } from "../src/config.ts";

test("validateConfig accepts Bot API credentials", () => {
  expect(() =>
    validateConfig("monitor", {
      NOTIFIER_API_URL: "https://example.workers.dev/notifications",
      NOTIFIER_API_TOKEN: "secret",
    })
  ).not.toThrow();
});

test("validateConfig keeps the Discord webhook migration fallback", () => {
  expect(() =>
    validateConfig("monitor", { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" })
  ).not.toThrow();
});

test("validateConfig rejects incomplete Bot API credentials", () => {
  expect(() =>
    validateConfig("monitor", { NOTIFIER_API_URL: "https://example.workers.dev" })
  ).toThrow(/must be set together/);
});

test("validateConfig does not silently fall back to a webhook during a Bot test", () => {
  expect(() =>
      validateConfig("notification-test", {
        DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
      })
  ).toThrow(/Bot test requires NOTIFIER_API_URL and NOTIFIER_API_TOKEN/);
});
