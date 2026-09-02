import { expect, test } from "bun:test";

import { getMode } from "../src/main.ts";

test("getMode selects monitor, dry-run, and notification test modes", () => {
  expect(getMode([])).toBe("monitor");
  expect(getMode(["--dry-run"])).toBe("dry-run");
  expect(getMode(["--bot-test"])).toBe("notification-test");
  expect(getMode(["--webhook-test"])).toBe("notification-test");
});
