import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fetchCategoryHtml, parseProducts } from "../src/fetchProducts.js";

const targetUrl = "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/";
const fixtureUrl = new URL("./fixtures/category.html", import.meta.url);

test("parseProducts extracts new and sold-out product fields", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const products = parseProducts(html, targetUrl, 2);

  assert.deepEqual(products, [
    {
      id: "240000000001",
      name: "Sample DAC Black",
      price: "￥12,800(税込)",
      condition: "AB+",
      stock: "在庫あり",
      url: "https://www.fujiya-avic.co.jp/shop/g/g240000000001/",
    },
    {
      id: "240000000002",
      name: "Sample Headphone",
      price: "￥9,980(税込)",
      condition: "A",
      stock: "売り切れ",
      url: "https://www.fujiya-avic.co.jp/shop/g/g240000000002/",
    },
  ]);
});

test("parseProducts rejects an empty or challenge page", () => {
  assert.throws(
    () => parseProducts("<html><body>challenge</body></html>", targetUrl, 1),
    /Parser health check failed/
  );
});

test("fetchCategoryHtml retries a 429 once using Retry-After", async () => {
  let requestCount = 0;
  const sleeps = [];
  const runtimeConfig = createRuntimeConfig();

  const html = await fetchCategoryHtml(runtimeConfig, {
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }
      return new Response("<html>ok</html>", { status: 200 });
    },
    sleepImpl: async (ms) => sleeps.push(ms),
  });

  assert.equal(html, "<html>ok</html>");
  assert.equal(requestCount, 2);
  assert.deepEqual(sleeps, [2_000]);
});

test("fetchCategoryHtml does not retry a 403", async () => {
  let requestCount = 0;

  await assert.rejects(
    fetchCategoryHtml(createRuntimeConfig(), {
      fetchImpl: async () => {
        requestCount += 1;
        return new Response("blocked", { status: 403 });
      },
      sleepImpl: async () => {},
    }),
    /returned 403/
  );

  assert.equal(requestCount, 1);
});

function createRuntimeConfig() {
  return {
    targetUrl,
    requestTimeoutMs: 1_000,
    retryDelayMs: 1,
    maxRetryAfterMs: 60_000,
    userAgent: "test-agent",
  };
}
