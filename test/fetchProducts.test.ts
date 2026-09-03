import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import type { RuntimeConfig } from "../shared/domain.ts";

import {
  fetchCategoryHtml,
  fetchProductDetail,
  parseProductDetail,
  parseProducts,
} from "../src/fetchProducts.ts";

const targetUrl = "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/";
const fixtureUrl = new URL("./fixtures/category.html", import.meta.url);

test("parseProducts extracts new and sold-out product fields", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const products = parseProducts(html, targetUrl, 2);

  expect(products).toEqual([
    {
      id: "240000000001",
      name: "Sample DAC Black",
      price: "￥12,800(税込)",
      condition: "AB+",
      stock: "在庫あり",
      url: "https://www.fujiya-avic.co.jp/shop/g/g240000000001/",
      brandEnglish: "SAMPLE AUDIO",
      brandJapanese: "サンプルオーディオ",
      imageUrl: "https://www.fujiya-avic.co.jp/sample.jpg",
    },
    {
      id: "240000000002",
      name: "Sample Headphone",
      price: "￥9,980(税込)",
      condition: "A",
      stock: "売り切れ",
      url: "https://www.fujiya-avic.co.jp/shop/g/g240000000002/",
      brandEnglish: "HEADPHONE LAB",
      brandJapanese: "ヘッドホンラボ",
      imageUrl: "https://www.fujiya-avic.co.jp/sample2.jpg",
    },
  ]);
});

test("parseProducts rejects an empty or challenge page", () => {
  expect(() => parseProducts("<html><body>challenge</body></html>", targetUrl, 1)).toThrow(
    /Parser health check failed/
  );
});

test("parseProductDetail extracts a product for a manual notification", () => {
  const productUrl = "https://www.fujiya-avic.co.jp/shop/g/g240004022460/";
  const html = `
    <title>Cayin N30LE DAP [SPK-A004] ABランク 中古｜フジヤエービック</title>
    <meta name="description" content="Cayin［カイン］ N30LE DAP [SPK-A004] ABランク 中古の商品情報ページです。">
    <script type="application/ld+json">
      {
        "@type": "Product",
        "name": "N30LE DAP [SPK-A004]",
        "image": "https://www.fujiya-avic.co.jp/img/goods/L/240004022460.jpg",
        "mpn": "240004022460",
        "brand": { "name": "Cayin" },
        "offers": {
          "price": 613800,
          "availability": "http://schema.org/InStock"
        }
      }
    </script>
  `;

  expect(parseProductDetail(html, productUrl, "240004022460")).toEqual({
    id: "240004022460",
    name: "N30LE DAP [SPK-A004]",
    price: "￥613,800(税込)",
    condition: "AB",
    stock: "在庫あり",
    url: productUrl,
    brandEnglish: "Cayin",
    brandJapanese: "カイン",
    imageUrl: "https://www.fujiya-avic.co.jp/img/goods/L/240004022460.jpg",
  });
});

test("fetchProductDetail rejects an invalid product id before fetching", async () => {
  let requestCount = 0;

  await expect(
    fetchProductDetail("not-an-id", createRuntimeConfig(), {
      fetchImpl: async () => {
        requestCount += 1;
        return new Response("unexpected");
      },
    })
  ).rejects.toThrow(/exactly 12 digits/);

  expect(requestCount).toBe(0);
});

test("fetchCategoryHtml retries a 429 once using Retry-After", async () => {
  let requestCount = 0;
  const sleeps: number[] = [];
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
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  expect(html).toBe("<html>ok</html>");
  expect(requestCount).toBe(2);
  expect(sleeps).toEqual([2_000]);
});

test("fetchCategoryHtml does not retry a 403", async () => {
  let requestCount = 0;

  await expect(
    fetchCategoryHtml(createRuntimeConfig(), {
      fetchImpl: async () => {
        requestCount += 1;
        return new Response("blocked", { status: 403 });
      },
      sleepImpl: async () => {},
    }),
  ).rejects.toThrow(/returned 403/);

  expect(requestCount).toBe(1);
});

function createRuntimeConfig(): RuntimeConfig {
  return {
    targetUrl,
    stateFile: "/tmp/test-state.json",
    requestTimeoutMs: 1_000,
    retryDelayMs: 1,
    maxRetryAfterMs: 60_000,
    minimumProductCount: 1,
    userAgent: "test-agent",
  };
}
