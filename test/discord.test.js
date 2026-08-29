import assert from "node:assert/strict";
import test from "node:test";

import { postNewProducts, productToEmbed } from "../src/discord.js";

const sampleProduct = {
  id: "240000000001",
  name: "Sample DAC",
  price: "￥12,800(税込)",
  condition: "AB+",
  stock: "在庫あり",
  url: "https://www.fujiya-avic.co.jp/shop/g/g240000000001/",
};

test("productToEmbed produces a linked embed without mentions", () => {
  const embed = productToEmbed(sampleProduct);
  assert.equal(embed.title, "Sample DAC");
  assert.equal(embed.url, sampleProduct.url);
  assert.equal(embed.fields[2].value, "在庫あり");
});

test("postNewProducts splits more than ten products into batches", async () => {
  const payloads = [];
  const products = Array.from({ length: 11 }, (_, index) => ({
    ...sampleProduct,
    id: String(index + 1),
    name: `Product ${index + 1}`,
  }));

  await postNewProducts("https://discord.example/webhook", products, {
    fetchImpl: async (_url, request) => {
      payloads.push(JSON.parse(request.body));
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].embeds.length, 10);
  assert.equal(payloads[1].embeds.length, 1);
  assert.deepEqual(payloads[0].allowed_mentions, { parse: [] });
});

test("postNewProducts retries Discord rate limits once", async () => {
  let requestCount = 0;
  const sleeps = [];

  await postNewProducts("https://discord.example/webhook", [sampleProduct], {
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({ retry_after: 0.25 }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    },
    sleepImpl: async (ms) => sleeps.push(ms),
  });

  assert.equal(requestCount, 2);
  assert.deepEqual(sleeps, [250]);
});

test("postNewProducts reports a permanent Discord failure", async () => {
  await assert.rejects(
    postNewProducts("https://discord.example/webhook", [sampleProduct], {
      fetchImpl: async () => new Response("invalid webhook", { status: 404 }),
    }),
    /HTTP 404: invalid webhook/
  );
});
