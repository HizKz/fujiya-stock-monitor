import { expect, test } from "bun:test";

import { buildIdempotencyKey, postBotNotification } from "../src/notifier.ts";
import { createProduct, jsonBody, must } from "./helpers.ts";

const products = [
  createProduct({
    id: "240000000002",
    name: "Headphone",
    url: "https://www.fujiya-avic.co.jp/shop/g/g240000000002/",
  }),
  createProduct({
    id: "240000000001",
    name: "DAC",
    url: "https://www.fujiya-avic.co.jp/shop/g/g240000000001/",
  }),
];

test("buildIdempotencyKey is stable regardless of product order", () => {
  expect(buildIdempotencyKey(products)).toBe(buildIdempotencyKey([...products].reverse()));
  expect(buildIdempotencyKey(products)).toMatch(/^[0-9a-f]{64}$/);
});

test("postBotNotification authenticates and sends one request", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

  await postBotNotification("https://example.workers.dev/notifications", "api-secret", products, {
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    },
  });

  const request = must(requests[0]);
  const headers = request.init?.headers as Record<string, string>;
  expect(requests).toHaveLength(1);
  expect(request.url).toBe("https://example.workers.dev/notifications");
  expect(headers.Authorization).toBe("Bearer api-secret");
  expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f]{64}$/);
  expect(jsonBody(request.init)).toEqual({ products });
});
