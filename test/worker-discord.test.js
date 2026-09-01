import assert from "node:assert/strict";
import test from "node:test";

import {
  createNotification,
  handleInteraction,
  verifyDiscordSignature,
} from "../worker/discord.js";

const sampleProducts = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
  name: `Product ${index + 1}`,
  price: "￥12,800(税込)",
  condition: "AB+",
  stock: "在庫あり",
  url: `https://www.fujiya-avic.co.jp/shop/g/g${index + 1}/`,
  brandEnglish: "SAMPLE AUDIO",
  brandJapanese: "サンプルオーディオ",
  imageUrl: "https://www.fujiya-avic.co.jp/sample.jpg",
}));

test("createNotification stores the pages and sends one Bot message", async () => {
  const kv = new MemoryKv();
  const discordRequests = [];
  const request = new Request("https://example.workers.dev/notifications", {
    method: "POST",
    headers: {
      Authorization: "Bearer notifier-secret",
      "Content-Type": "application/json",
      "Idempotency-Key": "a".repeat(64),
    },
    body: JSON.stringify({ products: sampleProducts }),
  });

  const response = await createNotification(
    request,
    createEnv(kv),
    {
      fetchImpl: async (url, options) => {
        discordRequests.push({ url, options });
        return new Response(JSON.stringify({ id: "discord-message-id" }), { status: 200 });
      },
    }
  );
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.ok, true);
  assert.equal(discordRequests.length, 1);
  assert.equal(discordRequests[0].options.headers.Authorization, "Bot discord-secret");
  const payload = JSON.parse(discordRequests[0].options.body);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].footer.text, "1 / 12件");
  assert.equal(payload.components[0].components.length, 4);
  assert.equal(payload.components[0].components[0].label, "⏮ 最初へ");
  assert.ok(await kv.get(`notification:${result.notificationId}`));
  assert.equal(await kv.get(`idempotency:${"a".repeat(64)}`), result.notificationId);
});

test("createNotification deduplicates a successful monitor delivery", async () => {
  const kv = new MemoryKv();
  await kv.put(`idempotency:${"b".repeat(64)}`, "existing-notification");
  const request = new Request("https://example.workers.dev/notifications", {
    method: "POST",
    headers: {
      Authorization: "Bearer notifier-secret",
      "Content-Type": "application/json",
      "Idempotency-Key": "b".repeat(64),
    },
    body: JSON.stringify({ products: sampleProducts }),
  });

  const response = await createNotification(request, createEnv(kv), {
    fetchImpl: async () => {
      throw new Error("Discord must not be called for a duplicate");
    },
  });

  assert.deepEqual(await response.json(), {
    ok: true,
    duplicate: true,
    notificationId: "existing-notification",
  });
});

test("handleInteraction verifies Discord and updates the message page", async () => {
  const notificationId = "c".repeat(32);
  const kv = new MemoryKv();
  await kv.put(
    `notification:${notificationId}`,
    JSON.stringify({ products: sampleProducts, test: false })
  );

  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const publicKeyHex = bytesToHex(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const timestamp = "1720000000";
  const rawBody = JSON.stringify({
    type: 3,
    data: { custom_id: `stock:${notificationId}:1` },
  });
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    new TextEncoder().encode(timestamp + rawBody)
  );
  const headers = new Headers({
    "X-Signature-Ed25519": bytesToHex(signature),
    "X-Signature-Timestamp": timestamp,
  });

  assert.equal(await verifyDiscordSignature(headers, rawBody, publicKeyHex), true);

  const response = await handleInteraction(
    new Request("https://example.workers.dev/interactions", {
      method: "POST",
      headers,
      body: rawBody,
    }),
    { NOTIFICATIONS: kv, DISCORD_PUBLIC_KEY: publicKeyHex }
  );
  const result = await response.json();

  assert.equal(result.type, 7);
  assert.equal(result.data.embeds.length, 1);
  assert.equal(result.data.embeds[0].footer.text, "2 / 12件");
  assert.match(result.data.embeds[0].description, /Product 2/);
});

test("handleInteraction acknowledges immediately and updates the message in the background", async () => {
  const notificationId = "d".repeat(32);
  const kv = new MemoryKv();
  await kv.put(
    `notification:${notificationId}`,
    JSON.stringify({ products: sampleProducts, test: false })
  );

  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const publicKeyHex = bytesToHex(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const timestamp = "1720000001";
  const rawBody = JSON.stringify({
    type: 3,
    application_id: "discord-app-id",
    token: "interaction-token",
    data: { custom_id: `stock:${notificationId}:2` },
  });
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    new TextEncoder().encode(timestamp + rawBody)
  );
  const headers = new Headers({
    "X-Signature-Ed25519": bytesToHex(signature),
    "X-Signature-Timestamp": timestamp,
  });
  const backgroundTasks = [];
  const discordRequests = [];

  const response = await handleInteraction(
    new Request("https://example.workers.dev/interactions", {
      method: "POST",
      headers,
      body: rawBody,
    }),
    { NOTIFICATIONS: kv, DISCORD_PUBLIC_KEY: publicKeyHex },
    { waitUntil: (task) => backgroundTasks.push(task) },
    {
      fetchImpl: async (url, options) => {
        discordRequests.push({ url, options });
        return new Response(null, { status: 204 });
      },
    }
  );

  assert.deepEqual(await response.json(), { type: 6 });
  assert.equal(backgroundTasks.length, 1);
  await backgroundTasks[0];
  assert.equal(
    discordRequests[0].url,
    "https://discord.com/api/v10/webhooks/discord-app-id/interaction-token/messages/@original"
  );
  const payload = JSON.parse(discordRequests[0].options.body);
  assert.equal(payload.embeds[0].footer.text, "3 / 12件");
});

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}

function createEnv(kv) {
  return {
    NOTIFICATIONS: kv,
    NOTIFIER_API_TOKEN: "notifier-secret",
    DISCORD_BOT_TOKEN: "discord-secret",
    DISCORD_CHANNEL_ID: "123456789",
  };
}

function bytesToHex(value) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
