import { expect, test } from "bun:test";

import type { Product } from "../shared/domain.ts";
import {
  createNotification,
  handleInteraction,
  type NotificationEnv,
  type NotificationKv,
  verifyDiscordSignature,
} from "../worker/discord.ts";
import { createProduct, jsonBody, must, responseJson } from "./helpers.ts";

const sampleProducts: Product[] = Array.from({ length: 12 }, (_, index) =>
  createProduct({
    id: String(index + 1),
    name: `Product ${index + 1}`,
    url: `https://www.fujiya-avic.co.jp/shop/g/g${index + 1}/`,
  })
);

interface NotificationResponse {
  ok: boolean;
  duplicate: boolean;
  notificationId: string;
}

interface InteractionResponse {
  type: number;
  data: {
    embeds: Array<{ description: string; footer: { text: string } }>;
  };
}

test("createNotification stores the pages and sends one Bot message", async () => {
  const kv = new MemoryKv();
  const discordRequests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const request = new Request("https://example.workers.dev/notifications", {
    method: "POST",
    headers: {
      Authorization: "Bearer notifier-secret",
      "Content-Type": "application/json",
      "Idempotency-Key": "a".repeat(64),
    },
    body: JSON.stringify({ products: sampleProducts }),
  });

  const response = await createNotification(request, createEnv(kv), {
    fetchImpl: async (url, init) => {
      discordRequests.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "discord-message-id" }), { status: 200 });
    },
  });
  const result = await responseJson<NotificationResponse>(response);

  const discordRequest = must(discordRequests[0]);
  const headers = discordRequest.init?.headers as Record<string, string>;
  const payload = jsonBody(discordRequest.init) as {
    embeds: Array<{ footer: { text: string } }>;
    components: Array<{ components: Array<{ label: string }> }>;
  };
  expect(response.status).toBe(201);
  expect(result.ok).toBe(true);
  expect(discordRequests).toHaveLength(1);
  expect(headers.Authorization).toBe("Bot discord-secret");
  expect(payload.embeds).toHaveLength(1);
  expect(payload.embeds[0]?.footer.text).toBe("1 / 12件");
  expect(payload.components[0]?.components).toHaveLength(4);
  expect(payload.components[0]?.components[0]?.label).toBe("⏮ 最初へ");
  expect(await kv.get(`notification:${result.notificationId}`)).toBeTruthy();
  expect(await kv.get(`idempotency:${"a".repeat(64)}`)).toBe(result.notificationId);
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

  expect(await responseJson<Record<string, unknown>>(response)).toEqual({
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

  expect(await verifyDiscordSignature(headers, rawBody, publicKeyHex)).toBe(true);

  const response = await handleInteraction(
    new Request("https://example.workers.dev/interactions", {
      method: "POST",
      headers,
      body: rawBody,
    }),
    { NOTIFICATIONS: kv, DISCORD_PUBLIC_KEY: publicKeyHex }
  );
  const result = await responseJson<InteractionResponse>(response);

  expect(result.type).toBe(7);
  expect(result.data.embeds).toHaveLength(1);
  expect(result.data.embeds[0]?.footer.text).toBe("2 / 12件");
  expect(result.data.embeds[0]?.description).toMatch(/Product 2/);
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
  const backgroundTasks: Promise<unknown>[] = [];
  const discordRequests: Array<{ url: string; init: RequestInit | undefined }> = [];

  const response = await handleInteraction(
    new Request("https://example.workers.dev/interactions", {
      method: "POST",
      headers,
      body: rawBody,
    }),
    { NOTIFICATIONS: kv, DISCORD_PUBLIC_KEY: publicKeyHex },
    {
      waitUntil: (task) => {
        backgroundTasks.push(task);
      },
    },
    {
      fetchImpl: async (url, init) => {
        discordRequests.push({ url: String(url), init });
        return new Response(null, { status: 204 });
      },
    }
  );

  expect(await responseJson<Record<string, unknown>>(response)).toEqual({ type: 6 });
  expect(backgroundTasks).toHaveLength(1);
  await must(backgroundTasks[0]);
  const discordRequest = must(discordRequests[0]);
  expect(discordRequest.url).toBe(
    "https://discord.com/api/v10/webhooks/discord-app-id/interaction-token/messages/@original"
  );
  const payload = jsonBody(discordRequest.init) as {
    embeds: Array<{ footer: { text: string } }>;
  };
  expect(payload.embeds[0]?.footer.text).toBe("3 / 12件");
});

class MemoryKv implements NotificationKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function createEnv(kv: NotificationKv): NotificationEnv {
  return {
    NOTIFICATIONS: kv,
    NOTIFIER_API_TOKEN: "notifier-secret",
    DISCORD_BOT_TOKEN: "discord-secret",
    DISCORD_CHANNEL_ID: "123456789",
  };
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
