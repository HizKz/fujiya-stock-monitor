import * as cheerio from "cheerio";

const STOCK_LABELS = new Set(["在庫あり", "売り切れ"]);

export async function fetchProducts(runtimeConfig, options = {}) {
  const html = await fetchCategoryHtml(runtimeConfig, options);
  return parseProducts(html, runtimeConfig.targetUrl, runtimeConfig.minimumProductCount);
}

export async function fetchCategoryHtml(runtimeConfig, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), runtimeConfig.requestTimeoutMs);

    try {
      const response = await fetchImpl(runtimeConfig.targetUrl, {
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

      if (error?.name === "AbortError") {
        throw new Error(`Target site request timed out after ${runtimeConfig.requestTimeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Target site request failed after retry");
}

export function parseProducts(html, targetUrl, minimumProductCount = 1) {
  const $ = cheerio.load(html);
  const cards = $("dl.block-thumbnail-t--goods.js-enhanced-ecommerce-item");

  if (cards.length < minimumProductCount) {
    throw new Error(
      `Parser health check failed: expected at least ${minimumProductCount} products, found ${cards.length}`
    );
  }

  const products = [];
  const seenIds = new Set();

  cards.each((index, element) => {
    const card = $(element);
    const link = card.find("a.js-enhanced-ecommerce-goods-name").first();
    const href = link.attr("href") || card.find("a.js-enhanced-ecommerce-image").attr("href");
    const id = extractProductId(href);
    const name = normalizeText(card.find(".block-thumbnail-t--goods-name").first().text());
    const price = normalizeText(card.find(".block-thumbnail-t--price").first().text());
    const condition = normalizeText(card.find(".secondhand_item").first().text());
    const stock = card
      .find("img[alt]")
      .toArray()
      .map((image) => $(image).attr("alt"))
      .find((alt) => STOCK_LABELS.has(alt));

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
    });
  });

  return products;
}

function extractProductId(href) {
  if (!href) return null;
  return href.match(/\/shop\/g\/g(\d+)\/?(?:[?#].*)?$/)?.[1] || null;
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseRetryAfterMs(value) {
  if (!value) return 10_000;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));

  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 10_000;
}

function isRetryableNetworkError(error) {
  return error?.name === "AbortError" || error instanceof TypeError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
