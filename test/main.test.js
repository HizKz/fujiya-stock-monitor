import assert from "node:assert/strict";
import test from "node:test";

import { getMode } from "../src/main.js";

test("getMode selects monitor, dry-run, and notification test modes", () => {
  assert.equal(getMode([]), "monitor");
  assert.equal(getMode(["--dry-run"]), "dry-run");
  assert.equal(getMode(["--bot-test"]), "notification-test");
  assert.equal(getMode(["--webhook-test"]), "notification-test");
});
