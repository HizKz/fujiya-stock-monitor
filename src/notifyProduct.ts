import "dotenv/config";

import type { Product } from "../shared/domain.ts";
import { config, validateConfig } from "./config.ts";
import { fetchProductDetail, fetchProducts } from "./fetchProducts.ts";
import { sendNotification } from "./main.ts";

interface ManualNotificationOptions {
  productId?: string;
  pageNumber?: string;
  throughProductId?: string;
}

export async function notifyProduct(
  options: ManualNotificationOptions = {
    productId: process.env.PRODUCT_ID,
    pageNumber: process.env.PAGE_NUMBER,
    throughProductId: process.env.THROUGH_PRODUCT_ID,
  }
): Promise<void> {
  const products = await loadProductsForNotification(options);

  validateConfig("monitor");
  await sendNotification(products);
  console.log(
    `[INFO] Discord notification sent for ${products.length} product(s): ${products
      .map((product) => product.id)
      .join(", ")}`
  );
}

export function selectProductsThrough(products: Product[], throughProductId: string): Product[] {
  const lastIndex = products.findIndex((product) => product.id === throughProductId);
  if (lastIndex < 0) {
    throw new Error(`Product ${throughProductId} was not found on the selected page`);
  }
  return products.slice(0, lastIndex + 1);
}

async function loadProductsForNotification(options: ManualNotificationOptions): Promise<Product[]> {
  const { productId, pageNumber, throughProductId } = options;

  if (pageNumber || throughProductId) {
    if (!pageNumber || !throughProductId || !/^[1-9]\d*$/.test(pageNumber)) {
      throw new Error("PAGE_NUMBER and THROUGH_PRODUCT_ID must be set together");
    }

    const page = Number(pageNumber);
    const targetUrl =
      page === 1 ? config.targetUrl : config.targetUrl.replace(/\/$/, `_p${page}/`);
    const products = await fetchProducts({ ...config, targetUrl });
    return selectProductsThrough(products, throughProductId);
  }

  if (!productId) throw new Error("PRODUCT_ID is required");
  return [await fetchProductDetail(productId, config)];
}

if (import.meta.main) {
  notifyProduct().catch((error) => {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
