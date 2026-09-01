import assert from "node:assert/strict";
import test from "node:test";

import { buildMessage, PAGE_SIZE, USED_LIST_URL } from "../worker/render.js";

const products = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
  name: `Product ${index + 1}`,
  price: `￥${index + 1},000(税込)`,
  condition: "A",
  stock: "在庫あり",
  url: `https://www.fujiya-avic.co.jp/shop/g/g${index + 1}/`,
  brandEnglish: "SAMPLE",
  imageUrl: `https://www.fujiya-avic.co.jp/images/${index + 1}.jpg`,
}));

test("buildMessage renders one product card with horizontal-style navigation", () => {
  const message = buildMessage(products.slice(0, 10), "a".repeat(32));

  assert.equal(PAGE_SIZE, 1);
  assert.equal(message.embeds.length, 1);
  assert.equal(message.embeds[0].title, "🚨 新着商品のお知らせ（全10件）");
  assert.match(message.embeds[0].description, /\[SAMPLE\].*\n\n\[Product 1\]/);
  assert.match(message.embeds[0].description, /\*\*価格: ￥1,000\(税込\)\*\*/);
  assert.match(message.embeds[0].description, new RegExp(USED_LIST_URL.replaceAll("/", "\\/")));
  assert.equal(message.embeds[0].thumbnail.url, products[0].imageUrl);
  assert.equal(message.embeds[0].footer.text, "1 / 10件");
  assert.equal(message.components[0].components[0].disabled, true);
  assert.equal(message.components[0].components[1].disabled, true);
  assert.equal(message.components[0].components[3].custom_id, `stock:next:${"a".repeat(32)}:1`);
});

test("buildMessage clamps an out-of-range product page", () => {
  const message = buildMessage(products, "b".repeat(32), 99, true);
  assert.equal(message.embeds.length, 1);
  assert.equal(message.embeds[0].title, "🧪 新着通知の表示テスト（全12件）");
  assert.match(message.embeds[0].description, /Product 12/);
  assert.equal(message.embeds[0].footer.text, "12 / 12件");
  assert.equal(message.components[0].components[0].custom_id, `stock:first:${"b".repeat(32)}:0`);
  assert.equal(message.components[0].components[1].custom_id, `stock:prev:${"b".repeat(32)}:10`);
  assert.equal(message.components[0].components[3].disabled, true);
});

test("buildMessage gives every navigation component a unique custom id", () => {
  const message = buildMessage(products, "c".repeat(32), 1);
  const customIds = message.components[0].components.map((component) => component.custom_id);

  assert.equal(new Set(customIds).size, customIds.length);
  assert.equal(customIds[0], `stock:first:${"c".repeat(32)}:0`);
  assert.equal(customIds[1], `stock:prev:${"c".repeat(32)}:0`);
});
