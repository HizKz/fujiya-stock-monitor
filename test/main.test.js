import assert from "node:assert/strict";
import test from "node:test";

import { getMode } from "../src/main.js";

test("getMode selects monitor, dry-run, and webhook test modes", () => {
  assert.equal(getMode([]), "monitor");
  assert.equal(getMode(["--dry-run"]), "dry-run");
  assert.equal(getMode(["--webhook-test"]), "webhook-test");
});
