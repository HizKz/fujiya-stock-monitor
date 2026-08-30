import assert from "node:assert/strict";
import test from "node:test";

import { postNewProducts, productsToSummaryEmbed } from "../src/discord.js";

const sampleProduct = {
  id: "240000000001",
  name: "Sample DAC",
  price: "￥12,800(税込)",
  condition: "AB+",
  stock: "在庫あり",
  url: "https://www.fujiya-avic.co.jp/shop/g/g240000000001/",
  brandEnglish: "SAMPLE AUDIO",
  brandJapanese: "サンプルオーディオ",
  imageUrl: "https://www.fujiya-avic.co.jp/sample.jpg",
};

test("productsToSummaryEmbed produces a compact linked list", () => {
  const secondProduct = {
    ...sampleProduct,
    id: "240000000002",
    name: "Sample Headphone",
    stock: "売り切れ",
    url: "https://www.fujiya-avic.co.jp/shop/g/g240000000002/",
  };
  const embed = productsToSummaryEmbed([sampleProduct, secondProduct]);
  assert.equal(embed.title, "🚨 新着商品のお知らせ（2件）");
  assert.equal(embed.color, 0xe74c3c);
  assert.equal(embed.thumbnail.url, sampleProduct.imageUrl);
  assert.match(embed.description, /1\. 🟢 \[SAMPLE AUDIO Sample DAC\]/);
  assert.match(embed.description, /2\. ⚫ \[SAMPLE AUDIO Sample Headphone\]/);
  assert.match(embed.description, /\*\*￥12,800\(税込\)\*\*/);
  assert.match(
    embed.description,
    /\[中古リスト一覧ページを開く\]\(https:\/\/www\.fujiya-avic\.co\.jp\/shop\/c\/c40_ssd\/\)/
  );
});

test("postNewProducts sends fifty products as one Discord message", async () => {
  const payloads = [];
  const products = Array.from({ length: 50 }, (_, index) => ({
    ...sampleProduct,
    id: String(index + 1),
    name: `Product with a moderately long product name ${index + 1}`,
    url: `https://www.fujiya-avic.co.jp/shop/g/g${String(index + 1).padStart(12, "0")}/`,
  }));

  await postNewProducts("https://discord.example/webhook", products, {
    fetchImpl: async (_url, request) => {
      payloads.push(JSON.parse(request.body));
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 1);
  assert.equal(payloads[0].username, "フジヤエービック在庫確認BOT");
  assert.equal(payloads[0].content, undefined);
  assert.ok(payloads[0].embeds[0].description.length <= 4_096);
  assert.match(payloads[0].embeds[0].description, /…ほか \*\*\d+件\*\* あります/);
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
