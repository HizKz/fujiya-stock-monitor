import "dotenv/config";
import { pathToFileURL } from "node:url";

import { config, validateConfig } from "./config.js";
import { postNewProducts, postTestNotification } from "./discord.js";
import { fetchProducts } from "./fetchProducts.js";
import { findNewProducts, loadState, saveState, withSeenProducts } from "./state.js";

export async function main(args = process.argv.slice(2)) {
  const mode = getMode(args);
  validateConfig(mode);

  if (mode === "webhook-test") {
    await postTestNotification(process.env.DISCORD_WEBHOOK_URL);
    console.log("[INFO] Discord webhook test succeeded");
    return;
  }

  console.log(`[INFO] Fetching ${config.targetUrl}`);
  const products = await fetchProducts(config);
  console.log(`[INFO] Parsed ${products.length} products`);

  if (mode === "dry-run") {
    for (const product of products.slice(0, 5)) {
      console.log(
        `[DRY-RUN] ${product.id} | ${product.stock} | ${product.condition} | ${product.price} | ${product.name}`
      );
    }
    console.log("[INFO] Dry-run completed without Discord notification or state update");
    return;
  }

  const state = await loadState(config.stateFile);
  const nextState = withSeenProducts(state, products);

  if (state.seenProductIds.length === 0) {
    await saveState(config.stateFile, nextState);
    console.log(`[INFO] Initial baseline saved with ${products.length} products; no notification sent`);
    return;
  }

  const newProducts = findNewProducts(products, state);
  if (newProducts.length === 0) {
    console.log("[INFO] No new products found");
    return;
  }

  console.log(`[INFO] Found ${newProducts.length} new products`);
  await postNewProducts(process.env.DISCORD_WEBHOOK_URL, newProducts);
  await saveState(config.stateFile, nextState);
  console.log(`[INFO] Discord notification sent and ${newProducts.length} products saved`);
}

export function getMode(args) {
  if (args.includes("--dry-run")) return "dry-run";
  if (args.includes("--webhook-test")) return "webhook-test";
  return "monitor";
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  });
}
