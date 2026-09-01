import assert from "node:assert/strict";
import test from "node:test";

import { buildIdempotencyKey, postBotNotification } from "../src/notifier.js";

const products = [
  {
    id: "240000000002",
    name: "Headphone",
    url: "https://www.fujiya-avic.co.jp/shop/g/g240000000002/",
  },
  {
    id: "240000000001",
    name: "DAC",
    url: "https://www.fujiya-avic.co.jp/shop/g/g240000000001/",
  },
];

test("buildIdempotencyKey is stable regardless of product order", () => {
  assert.equal(buildIdempotencyKey(products), buildIdempotencyKey([...products].reverse()));
  assert.match(buildIdempotencyKey(products), /^[0-9a-f]{64}$/);
});

test("postBotNotification authenticates and sends one request", async () => {
  const requests = [];

  await postBotNotification("https://example.workers.dev/notifications", "api-secret", products, {
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example.workers.dev/notifications");
  assert.equal(requests[0].request.headers.Authorization, "Bearer api-secret");
  assert.match(requests[0].request.headers["Idempotency-Key"], /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(requests[0].request.body), { products });
});
