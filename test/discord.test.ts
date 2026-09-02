import { expect, test } from "bun:test";

import { postNewProducts, productsToSummaryEmbed } from "../src/discord.ts";
import { createProduct, jsonBody, must } from "./helpers.ts";

const sampleProduct = createProduct();

test("productsToSummaryEmbed produces a compact linked list", () => {
  const secondProduct = createProduct({
    id: "240000000002",
    name: "Sample Headphone",
    stock: "売り切れ",
    url: "https://www.fujiya-avic.co.jp/shop/g/g240000000002/",
  });
  const embed = productsToSummaryEmbed([sampleProduct, secondProduct]);
  expect(embed.title).toBe("🚨 新着商品のお知らせ（2件）");
  expect(embed.color).toBe(0xe74c3c);
  expect(embed.thumbnail?.url).toBe(sampleProduct.imageUrl ?? undefined);
  expect(embed.description).toMatch(/1\. 🟢 \[SAMPLE AUDIO Sample DAC\]/);
  expect(embed.description).toMatch(/2\. ⚫ \[SAMPLE AUDIO Sample Headphone\]/);
  expect(embed.description).toMatch(/\*\*￥12,800\(税込\)\*\*/);
  expect(embed.description).toMatch(
    /\[中古リスト一覧ページを開く\]\(https:\/\/www\.fujiya-avic\.co\.jp\/shop\/c\/c40_ssd\/\)/
  );
});

test("postNewProducts sends fifty products as one Discord message", async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const products = Array.from({ length: 50 }, (_, index) =>
    createProduct({
      id: String(index + 1),
      name: `Product with a moderately long product name ${index + 1}`,
      url: `https://www.fujiya-avic.co.jp/shop/g/g${String(index + 1).padStart(12, "0")}/`,
    })
  );

  await postNewProducts("https://discord.example/webhook", products, {
    fetchImpl: async (_url, request) => {
      payloads.push(jsonBody(request) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    },
  });

  const payload = must(payloads[0]);
  const embeds = payload.embeds as Array<{ description: string }>;
  const firstEmbed = must(embeds[0]);
  expect(payloads).toHaveLength(1);
  expect(embeds).toHaveLength(1);
  expect(payload.username).toBe("フジヤエービック在庫確認BOT");
  expect(payload.content).toBeUndefined();
  expect(firstEmbed.description.length).toBeLessThanOrEqual(4_096);
  expect(firstEmbed.description).toMatch(/…ほか \*\*\d+件\*\* あります/);
  expect(payload.allowed_mentions).toEqual({ parse: [] });
});

test("postNewProducts retries Discord rate limits once", async () => {
  let requestCount = 0;
  const sleeps: number[] = [];

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
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  expect(requestCount).toBe(2);
  expect(sleeps).toEqual([250]);
});

test("postNewProducts reports a permanent Discord failure", async () => {
  await expect(
    postNewProducts("https://discord.example/webhook", [sampleProduct], {
      fetchImpl: async () => new Response("invalid webhook", { status: 404 }),
    })
  ).rejects.toThrow(/HTTP 404: invalid webhook/);
});
