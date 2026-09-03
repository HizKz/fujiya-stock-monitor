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

test("runMonitor fetches page 2 when page 1 has no known products", async () => {
  const page1 = [createProduct({ id: "new-1" }), createProduct({ id: "new-2" })];
  const page2 = [createProduct({ id: "new-3" }), createProduct({ id: "known" })];
  const events: string[] = [];
  const dependencies = createDependencies(page1, {
    schemaVersion: 1,
    seenProductIds: ["known"],
  });
  dependencies.fetchSecondPageProducts = async () => {
    events.push("fetch-page-2");
    return page2;
  };
  dependencies.sendNotification = async (newProducts) => {
    events.push(`notify:${newProducts.map((product) => product.id).join(",")}`);
  };
  dependencies.saveState = async () => {
    events.push("save");
  };

  const result = await runMonitor("monitor", dependencies);

  expect(result).toEqual({ status: "notified", productCount: 3 });
  expect(events).toEqual(["fetch-page-2", "notify:new-1,new-2,new-3", "save"]);
});

test("runMonitor does not fetch page 2 when page 1 still has a known product", async () => {
  const page1 = [createProduct({ id: "new" }), createProduct({ id: "known" })];
  const dependencies = createDependencies(page1, {
    schemaVersion: 1,
    seenProductIds: ["known"],
  });
  dependencies.fetchSecondPageProducts = async () => {
    throw new Error("Page 2 must not be fetched");
  };

  const result = await runMonitor("monitor", dependencies);

  expect(result).toEqual({ status: "notified", productCount: 1 });
});

function createDependencies(products: Product[], state: MonitorState): MonitorDependencies {
  return {
    config: runtimeConfig,
    fetchProducts: async () => products,
    fetchSecondPageProducts: async () => [],
    loadState: async () => state,
    saveState: async () => {},
    findNewProducts,
    withSeenProducts,
    sendNotification: async () => {},
    notifierName: "Bot",
    log: () => {},
  };
}
