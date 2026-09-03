import * as cheerio from "cheerio";

import type { FetchLike, Product, RuntimeConfig, StockStatus } from "../shared/domain.ts";

const STOCK_LABELS = new Set<StockStatus>(["在庫あり", "売り切れ"]);
const PRODUCT_ID_PATTERN = /^\d{12}$/;
const CONDITION_PATTERN = /\s(未使用\/未開封品|コレクション|現状品|AB\+|AB-|AB|A|B)ランク\s+中古/;

interface FetchOptions {
  fetchImpl?: FetchLike;
  sleepImpl?: (milliseconds: number) => Promise<void>;
}

export async function fetchProducts(
  runtimeConfig: RuntimeConfig,
  options: FetchOptions = {}
): Promise<Product[]> {
  const html = await fetchCategoryHtml(runtimeConfig, options);
  return parseProducts(html, runtimeConfig.targetUrl, runtimeConfig.minimumProductCount);
}

export async function fetchCategoryHtml(
  runtimeConfig: RuntimeConfig,
  options: FetchOptions = {}
): Promise<string> {
  return fetchHtml(runtimeConfig.targetUrl, runtimeConfig, options);
}

export async function fetchProductDetail(
  productId: string,
  runtimeConfig: RuntimeConfig,
  options: FetchOptions = {}
): Promise<Product> {
  if (!PRODUCT_ID_PATTERN.test(productId)) {
    throw new Error("Product ID must contain exactly 12 digits");
  }

  const productUrl = new URL(`/shop/g/g${productId}/`, runtimeConfig.targetUrl).href;
  const html = await fetchHtml(productUrl, runtimeConfig, options);
  return parseProductDetail(html, productUrl, productId);
}

async function fetchHtml(
  url: string,
  runtimeConfig: RuntimeConfig,
  options: FetchOptions
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), runtimeConfig.requestTimeoutMs);

    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ja,en;q=0.8",
          "User-Agent": runtimeConfig.userAgent,
        },
        redirect: "follow",
        signal: controller.signal,
      });

      if (response.ok) return await response.text();

      if (response.status === 403) {
        throw new Error("Target site returned 403; automatic access may be blocked");
      }

      if (response.status === 429 && attempt < maxAttempts) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
        await sleepImpl(Math.min(retryAfterMs, runtimeConfig.maxRetryAfterMs));
        continue;
      }

      if (response.status >= 500 && attempt < maxAttempts) {
        await sleepImpl(runtimeConfig.retryDelayMs);
        continue;
      }

      throw new Error(`Target site request failed with HTTP ${response.status}`);
    } catch (error) {
      if (attempt < maxAttempts && isRetryableNetworkError(error)) {
        await sleepImpl(runtimeConfig.retryDelayMs);
        continue;
      }

      if (isAbortError(error)) {
        throw new Error(`Target site request timed out after ${runtimeConfig.requestTimeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Target site request failed after retry");
}

export function parseProductDetail(html: string, productUrl: string, productId: string): Product {
  const $ = cheerio.load(html);
  const title = normalizeText($("title").first().text());
  const condition = title.match(CONDITION_PATTERN)?.[1];
  const description = $('meta[name="description"]').attr("content") ?? "";
  const productData = $("script[type='application/ld+json']")
    .toArray()
    .map((element) => parseJson($(element).text()))
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .find(
      (value) =>
        isRecord(value) && value["@type"] === "Product" && String(value.mpn) === productId
    );

  if (!isRecord(productData) || !condition) {
    throw new Error(`Product detail parser failed for ${productId}`);
  }

  const offers = productData.offers;
  const brand = productData.brand;
  const name = typeof productData.name === "string" ? normalizeText(productData.name) : "";
  const price = isRecord(offers) ? Number(offers.price) : Number.NaN;
  const availability = isRecord(offers) ? offers.availability : undefined;
  const brandEnglish = isRecord(brand) && typeof brand.name === "string" ? brand.name : "";
  const brandJapanese = description.match(/^[^［]+［([^］]+)］/)?.[1] ?? "";
  const image = Array.isArray(productData.image) ? productData.image[0] : productData.image;

  if (
    !name ||
    !Number.isFinite(price) ||
    typeof availability !== "string" ||
    !brandEnglish
  ) {
    throw new Error(`Product detail parser failed for ${productId}`);
  }

  return {
    id: productId,
    name,
    price: `￥${price.toLocaleString("ja-JP")}(税込)`,
    condition,
    stock: availability.endsWith("InStock") ? "在庫あり" : "売り切れ",
    url: productUrl,
    brandEnglish,
    brandJapanese,
    imageUrl: typeof image === "string" ? image : null,
  };
}

export function parseProducts(
  html: string,
  targetUrl: string,
  minimumProductCount = 1
): Product[] {
  const $ = cheerio.load(html);
  const cards = $("dl.block-thumbnail-t--goods.js-enhanced-ecommerce-item");

  if (cards.length < minimumProductCount) {
    throw new Error(
      `Parser health check failed: expected at least ${minimumProductCount} products, found ${cards.length}`
    );
  }

  const products: Product[] = [];
  const seenIds = new Set<string>();

  cards.each((index, element) => {
    const card = $(element);
    const link = card.find("a.js-enhanced-ecommerce-goods-name").first();
    const href = link.attr("href") || card.find("a.js-enhanced-ecommerce-image").attr("href");
    const id = extractProductId(href);
    const name = normalizeText(card.find(".block-thumbnail-t--goods-name").first().text());
    const brandEnglish = normalizeText(card.find(".block-thumbnail-t--goods-brand .txt-en").first().text());
    const brandJapanese = normalizeText(card.find(".block-thumbnail-t--goods-brand .txt-ja").first().text());
    const price = normalizeText(card.find(".block-thumbnail-t--price").first().text());
    const condition = normalizeText(card.find(".secondhand_item").first().text());
    const image = card.find(".block-thumbnail-t--goods-image img").first();
    const imageSrc = image.attr("data-src") || image.attr("src");
    const stock = card
      .find("img[alt]")
      .toArray()
      .map((image) => $(image).attr("alt"))
      .find(isStockStatus);

    if (!id || !href || !name || !price || !condition || !stock) {
      throw new Error(`Parser health check failed: product card ${index + 1} is incomplete`);
    }

    if (seenIds.has(id)) {
      throw new Error(`Parser health check failed: duplicate product id ${id}`);
    }

    seenIds.add(id);
    products.push({
      id,
      name,
      price,
      condition: condition.replace(/^中古[：:]\s*/, ""),
      stock,
      url: new URL(href, targetUrl).href,
      brandEnglish,
      brandJapanese,
      imageUrl: imageSrc ? new URL(imageSrc, targetUrl).href : null,
    });
  });

  return products;
}

function extractProductId(href: string | undefined): string | null {
  if (!href) return null;
  return href.match(/\/shop\/g\/g(\d+)\/?(?:[?#].*)?$/)?.[1] || null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseRetryAfterMs(value: string | null): number {
  if (!value) return 10_000;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));

  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 10_000;
}

function isRetryableNetworkError(error: unknown): boolean {
  return isAbortError(error) || error instanceof TypeError;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function isStockStatus(value: string | undefined): value is StockStatus {
  return value !== undefined && STOCK_LABELS.has(value as StockStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
