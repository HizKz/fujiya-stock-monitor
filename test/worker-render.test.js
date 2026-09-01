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

test("buildMessage renders five products and pagination buttons", () => {
  const message = buildMessage(products, "a".repeat(32), 1);

  assert.equal(PAGE_SIZE, 5);
  assert.equal(message.embeds[0].title, "🚨 新着商品のお知らせ（12件）");
  assert.match(message.embeds[0].description, /6\. 🟢 \[SAMPLE Product 6\]/);
  assert.match(message.embeds[0].description, /10\. 🟢 \[SAMPLE Product 10\]/);
  assert.doesNotMatch(message.embeds[0].description, /Product 11/);
  assert.equal(message.embeds[0].footer.text, "ページ 2 / 3");
  assert.equal(message.components[0].components[0].custom_id, `stock:${"a".repeat(32)}:0`);
  assert.equal(message.components[0].components[2].custom_id, `stock:${"a".repeat(32)}:2`);
  assert.equal(message.components[0].components[3].url, USED_LIST_URL);
});

test("buildMessage clamps an out-of-range page", () => {
  const message = buildMessage(products, "b".repeat(32), 99, true);
  assert.equal(message.embeds[0].title, "🧪 表示テスト（12件）");
  assert.equal(message.embeds[0].footer.text, "ページ 3 / 3");
  assert.equal(message.components[0].components[2].disabled, true);
});
