import "dotenv/config";

import { config, validateConfig } from "./config.ts";
import { fetchProductDetail } from "./fetchProducts.ts";
import { sendNotification } from "./main.ts";

export async function notifyProduct(productId = process.env.PRODUCT_ID): Promise<void> {
  if (!productId) throw new Error("PRODUCT_ID is required");

  validateConfig("monitor");
  const product = await fetchProductDetail(productId, config);
  await sendNotification([product]);
  console.log(`[INFO] Discord notification sent for ${product.id} | ${product.name}`);
}

if (import.meta.main) {
  notifyProduct().catch((error) => {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
