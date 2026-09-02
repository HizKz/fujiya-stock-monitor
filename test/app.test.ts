import { expect, test } from "bun:test";

import type { MonitorState, Product, RuntimeConfig } from "../shared/domain.ts";
import { runMonitor, type MonitorDependencies } from "../src/app.ts";
import { findNewProducts, withSeenProducts } from "../src/state.ts";
import { createProduct } from "./helpers.ts";

const runtimeConfig: RuntimeConfig = {
  targetUrl: "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/",
  stateFile: "/tmp/test-state.json",
  requestTimeoutMs: 1_000,
  retryDelayMs: 1,
  maxRetryAfterMs: 1_000,
  minimumProductCount: 1,
  userAgent: "test-agent",
};

test("runMonitor saves the initial baseline without notifying", async () => {
  const products = [createProduct({ id: "1" }), createProduct({ id: "2" })];
  const savedStates: MonitorState[] = [];
  let notificationCount = 0;
  const dependencies = createDependencies(products, { schemaVersion: 1, seenProductIds: [] });
  dependencies.saveState = async (_path, state) => {
    savedStates.push(state);
  };
  dependencies.sendNotification = async () => {
    notificationCount += 1;
  };

  const result = await runMonitor("monitor", dependencies);

  expect(result).toEqual({ status: "baseline", productCount: 2 });
  expect(savedStates[0]?.seenProductIds).toEqual(["1", "2"]);
  expect(notificationCount).toBe(0);
});

test("runMonitor sends only the unseen prefix and then saves state", async () => {
  const products = [createProduct({ id: "3" }), createProduct({ id: "2" })];
  const events: string[] = [];
  const dependencies = createDependencies(products, {
    schemaVersion: 1,
    seenProductIds: ["2"],
  });
  dependencies.sendNotification = async (newProducts) => {
    events.push(`notify:${newProducts.map((product) => product.id).join(",")}`);
  };
  dependencies.saveState = async () => {
    events.push("save");
  };

  const result = await runMonitor("monitor", dependencies);

  expect(result).toEqual({ status: "notified", productCount: 1 });
  expect(events).toEqual(["notify:3", "save"]);
});

test("runMonitor does not save state when notification delivery fails", async () => {
  const products = [createProduct({ id: "3" }), createProduct({ id: "2" })];
  let saveCount = 0;
  const dependencies = createDependencies(products, {
    schemaVersion: 1,
    seenProductIds: ["2"],
  });
  dependencies.sendNotification = async () => {
    throw new Error("Discord unavailable");
  };
  dependencies.saveState = async () => {
    saveCount += 1;
  };

  await expect(runMonitor("monitor", dependencies)).rejects.toThrow(/Discord unavailable/);
  expect(saveCount).toBe(0);
});

function createDependencies(products: Product[], state: MonitorState): MonitorDependencies {
  return {
    config: runtimeConfig,
    fetchProducts: async () => products,
    loadState: async () => state,
    saveState: async () => {},
    findNewProducts,
    withSeenProducts,
    sendNotification: async () => {},
    notifierName: "Bot",
    log: () => {},
  };
}
