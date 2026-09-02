import { expect, test } from "bun:test";

import { buildMessage, PAGE_SIZE, USED_LIST_URL } from "../worker/render.ts";
import { createProduct, must } from "./helpers.ts";

const products = Array.from({ length: 12 }, (_, index) =>
  createProduct({
    id: String(index + 1),
    name: `Product ${index + 1}`,
    price: `￥${index + 1},000(税込)`,
    condition: "A",
    url: `https://www.fujiya-avic.co.jp/shop/g/g${index + 1}/`,
    brandEnglish: "SAMPLE",
    brandJapanese: "",
    imageUrl: `https://www.fujiya-avic.co.jp/images/${index + 1}.jpg`,
  })
);

test("buildMessage renders one product card with horizontal-style navigation", () => {
  const message = buildMessage(products.slice(0, 10), "a".repeat(32));
  const embed = must(message.embeds[0]);
  const row = must(message.components[0]);

  expect(PAGE_SIZE).toBe(1);
  expect(message.embeds).toHaveLength(1);
  expect(embed.title).toBe("🚨 新着商品のお知らせ（全10件）");
  expect(embed.description).toMatch(/\[SAMPLE\].*\n\n\[Product 1\]/);
  expect(embed.description).toMatch(/\*\*価格: ￥1,000\(税込\)\*\*/);
  expect(embed.description).toContain(USED_LIST_URL);
  expect(embed.thumbnail?.url).toBe(products[0]?.imageUrl ?? undefined);
  expect(embed.footer?.text).toBe("1 / 10件");
  expect(row.components[0]?.disabled).toBe(true);
  expect(row.components[1]?.disabled).toBe(true);
  expect(row.components[3]?.custom_id).toBe(`stock:next:${"a".repeat(32)}:1`);
});

test("buildMessage clamps an out-of-range product page", () => {
  const message = buildMessage(products, "b".repeat(32), 99, true);
  const embed = must(message.embeds[0]);
  const row = must(message.components[0]);

  expect(message.embeds).toHaveLength(1);
  expect(embed.title).toBe("🧪 新着通知の表示テスト（全12件）");
  expect(embed.description).toMatch(/Product 12/);
  expect(embed.footer?.text).toBe("12 / 12件");
  expect(row.components[0]?.custom_id).toBe(`stock:first:${"b".repeat(32)}:0`);
  expect(row.components[1]?.custom_id).toBe(`stock:prev:${"b".repeat(32)}:10`);
  expect(row.components[3]?.disabled).toBe(true);
});

test("buildMessage gives every navigation component a unique custom id", () => {
  const message = buildMessage(products, "c".repeat(32), 1);
  const row = must(message.components[0]);
  const customIds = row.components.map((component) => component.custom_id);

  expect(new Set(customIds).size).toBe(customIds.length);
  expect(customIds[0]).toBe(`stock:first:${"c".repeat(32)}:0`);
  expect(customIds[1]).toBe(`stock:prev:${"c".repeat(32)}:0`);
});
