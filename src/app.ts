import type { MonitorState, Product, RunMode, RunResult, RuntimeConfig } from "../shared/domain.ts";

export interface MonitorDependencies {
  config: RuntimeConfig;
  fetchProducts: (config: RuntimeConfig) => Promise<Product[]>;
  fetchSecondPageProducts: (config: RuntimeConfig) => Promise<Product[]>;
  loadState: (filePath: string) => Promise<MonitorState>;
  saveState: (filePath: string, state: MonitorState) => Promise<void>;
  findNewProducts: (products: Product[], state: MonitorState) => Product[];
  withSeenProducts: (state: MonitorState, products: Product[]) => MonitorState;
  sendNotification: (products: Product[], test?: boolean) => Promise<void>;
  notifierName: "Bot" | "webhook";
  log?: (message: string) => void;
}

export async function runMonitor(
  mode: RunMode,
  dependencies: MonitorDependencies
): Promise<RunResult> {
  const log = dependencies.log ?? console.log;

  if (mode === "notification-test") {
    log(`[INFO] Fetching ${dependencies.config.targetUrl} for notification preview`);
    const products = await dependencies.fetchProducts(dependencies.config);
    const previewProducts = products.slice(0, 10);
    await dependencies.sendNotification(previewProducts, true);
    log(`[INFO] Discord ${dependencies.notifierName} test succeeded`);
    return { status: "notification-test", productCount: previewProducts.length };
  }

  log(`[INFO] Fetching ${dependencies.config.targetUrl}`);
  let products = await dependencies.fetchProducts(dependencies.config);
  log(`[INFO] Parsed ${products.length} products`);

  if (mode === "dry-run") {
    for (const product of products.slice(0, 5)) {
      log(
        `[DRY-RUN] ${product.id} | ${product.stock} | ${product.condition} | ${product.price} | ${product.name}`
      );
    }
    log("[INFO] Dry-run completed without Discord notification or state update");
    return { status: "dry-run", productCount: products.length };
  }

  const state = await dependencies.loadState(dependencies.config.stateFile);
  const seenIds = new Set(state.seenProductIds);
  const hasKnownProductOnFirstPage = products.some((product) => seenIds.has(product.id));

  if (state.seenProductIds.length > 0 && !hasKnownProductOnFirstPage) {
    log("[INFO] No known products found on page 1; fetching page 2");
    const secondPageProducts = await dependencies.fetchSecondPageProducts(dependencies.config);
    log(`[INFO] Parsed ${secondPageProducts.length} products from page 2`);
    const firstPageIds = new Set(products.map((product) => product.id));
    products = [
      ...products,
      ...secondPageProducts.filter((product) => !firstPageIds.has(product.id)),
    ];
  }

  const nextState = dependencies.withSeenProducts(state, products);
  const unseenProductCount = nextState.seenProductIds.length - state.seenProductIds.length;

  if (state.seenProductIds.length === 0) {
    await dependencies.saveState(dependencies.config.stateFile, nextState);
    log(`[INFO] Initial baseline saved with ${products.length} products; no notification sent`);
    return { status: "baseline", productCount: products.length };
  }

  const newProducts = dependencies.findNewProducts(products, state);
  if (newProducts.length === 0) {
    if (unseenProductCount > 0) {
      await dependencies.saveState(dependencies.config.stateFile, nextState);
      log(`[INFO] Saved ${unseenProductCount} older rollover products without notification`);
      return { status: "rollover", productCount: unseenProductCount };
    }

    log("[INFO] No new products found");
    return { status: "no-change", productCount: products.length };
  }

  log(`[INFO] Found ${newProducts.length} new products`);
  await dependencies.sendNotification(newProducts);
  await dependencies.saveState(dependencies.config.stateFile, nextState);
  log(
    `[INFO] Discord ${dependencies.notifierName} notification sent and ${newProducts.length} products saved`
  );
  return { status: "notified", productCount: newProducts.length };
}
