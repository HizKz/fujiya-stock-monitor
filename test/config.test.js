import assert from "node:assert/strict";
import test from "node:test";

import { validateConfig } from "../src/config.js";

test("validateConfig accepts Bot API credentials", () => {
  assert.doesNotThrow(() =>
    validateConfig("monitor", {
      NOTIFIER_API_URL: "https://example.workers.dev/notifications",
      NOTIFIER_API_TOKEN: "secret",
    })
  );
});

test("validateConfig keeps the Discord webhook migration fallback", () => {
  assert.doesNotThrow(() =>
    validateConfig("monitor", { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" })
  );
});

test("validateConfig rejects incomplete Bot API credentials", () => {
  assert.throws(
    () => validateConfig("monitor", { NOTIFIER_API_URL: "https://example.workers.dev" }),
    /must be set together/
  );
});

test("validateConfig does not silently fall back to a webhook during a Bot test", () => {
  assert.throws(
    () =>
      validateConfig("notification-test", {
        DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
      }),
    /Bot test requires NOTIFIER_API_URL and NOTIFIER_API_TOKEN/
  );
});
