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
  brandEnglish: "SAMPLE AUDIO",
  brandJapanese: "サンプルオーディオ",
  imageUrl: "https://www.fujiya-avic.co.jp/sample.jpg",
};

test("productToEmbed produces the requested notification layout", () => {
  const embed = productToEmbed(sampleProduct);
  assert.equal(embed.title, "🚨 新着商品のお知らせ");
  assert.equal(embed.color, 0xe74c3c);
  assert.equal(embed.thumbnail.url, sampleProduct.imageUrl);
  assert.match(embed.description, /\[SAMPLE AUDIO\]\(https:\/\/www\.fujiya-avic\.co\.jp\/shop\/g\/g240000000001\/\)/);
  assert.match(embed.description, /\[サンプルオーディオ\]/);
  assert.match(embed.description, /\[Sample DAC\]/);
  assert.match(embed.description, /\*\*価格: ￥12,800\(税込\)\*\*/);
  assert.match(
    embed.description,
    /\[中古リスト一覧ページを開く\]\(https:\/\/www\.fujiya-avic\.co\.jp\/shop\/c\/c40_ssd\/\)/
  );
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
  assert.equal(payloads[0].username, "フジヤエービック在庫確認BOT");
  assert.equal(payloads[0].content, undefined);
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
