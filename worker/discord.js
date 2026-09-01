import { buildMessage } from "./render.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const NOTIFICATION_TTL_SECONDS = 60 * 60 * 24 * 7;
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;
const CUSTOM_ID_PATTERN = /^stock:(?:(?:first|prev|next):)?([0-9a-f]{32}):(\d+)$/;

export async function createNotification(request, env, options = {}) {
  if (!isAuthorized(request, env.NOTIFIER_API_TOKEN)) {
    return textResponse("Unauthorized", 401);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON" }, 400);
  }

  const validationError = validateInput(input);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey && !/^[0-9a-f]{64}$/.test(idempotencyKey)) {
    return jsonResponse({ error: "Invalid Idempotency-Key" }, 400);
  }

  if (idempotencyKey) {
    const existingId = await env.NOTIFICATIONS.get(`idempotency:${idempotencyKey}`);
    if (existingId) return jsonResponse({ ok: true, duplicate: true, notificationId: existingId });
  }

  const notificationId = crypto.randomUUID().replaceAll("-", "");
  const record = {
    products: input.products.map(normalizeProduct),
    test: input.test === true,
    createdAt: new Date().toISOString(),
  };

  await env.NOTIFICATIONS.put(`notification:${notificationId}`, JSON.stringify(record), {
    expirationTtl: NOTIFICATION_TTL_SECONDS,
  });

  try {
    await sendDiscordMessage(
      env,
      buildMessage(record.products, notificationId, 0, record.test),
      options
    );
  } catch (error) {
    await env.NOTIFICATIONS.delete(`notification:${notificationId}`);
    throw error;
  }

  if (idempotencyKey) {
    await env.NOTIFICATIONS.put(`idempotency:${idempotencyKey}`, notificationId, {
      expirationTtl: IDEMPOTENCY_TTL_SECONDS,
    });
  }

  return jsonResponse({ ok: true, duplicate: false, notificationId }, 201);
}

export async function handleInteraction(request, env, ctx, options = {}) {
  const rawBody = await request.text();
  if (!(await verifyDiscordSignature(request.headers, rawBody, env.DISCORD_PUBLIC_KEY))) {
    return textResponse("Invalid request signature", 401);
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return textResponse("Invalid JSON", 400);
  }

  if (interaction.type === 1) return jsonResponse({ type: 1 });
  if (interaction.type !== 3) {
    return ephemeralResponse("この操作には対応していません。");
  }

  const match = interaction.data?.custom_id?.match(CUSTOM_ID_PATTERN);
  if (!match) return ephemeralResponse("このボタンには対応していません。");

  const [, notificationId, requestedPage] = match;
  if (ctx?.waitUntil && interaction.application_id && interaction.token) {
    ctx.waitUntil(
      updateInteractionMessage(
        interaction,
        notificationId,
        Number(requestedPage),
        env,
        options
      )
    );
    return jsonResponse({ type: 6 });
  }

  return await buildInteractionUpdate(notificationId, Number(requestedPage), env);
}

async function buildInteractionUpdate(notificationId, requestedPage, env) {
  const stored = await env.NOTIFICATIONS.get(`notification:${notificationId}`);
  if (!stored) {
    return ephemeralResponse("この通知のページ切り替え期限（7日間）が切れました。");
  }

  let record;
  try {
    record = JSON.parse(stored);
  } catch {
    return ephemeralResponse("通知データを読み込めませんでした。");
  }

  return jsonResponse({
    type: 7,
    data: buildMessage(record.products, notificationId, requestedPage, record.test),
  });
}

async function updateInteractionMessage(interaction, notificationId, requestedPage, env, options) {
  try {
    const response = await buildInteractionUpdate(notificationId, requestedPage, env);
    const result = await response.json();
    if (result.type !== 7) {
      console.error("Unable to build deferred interaction update", result);
      return;
    }

    const fetchImpl = options.fetchImpl || fetch;
    const url = `${DISCORD_API_BASE}/webhooks/${encodeURIComponent(
      interaction.application_id
    )}/${encodeURIComponent(interaction.token)}/messages/@original`;
    const discordResponse = await fetchImpl(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.data),
    });

    if (!discordResponse.ok) {
      const body = await safeResponseText(discordResponse);
      console.error(
        `Deferred Discord update failed with HTTP ${discordResponse.status}${
          body ? `: ${body}` : ""
        }`
      );
    }
  } catch (error) {
    console.error("Deferred Discord update failed", error);
  }
}

export async function verifyDiscordSignature(headers, rawBody, publicKeyHex) {
  const signatureHex = headers.get("X-Signature-Ed25519");
  const timestamp = headers.get("X-Signature-Timestamp");

  if (!signatureHex || !timestamp || !publicKeyHex) return false;

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      hexToBytes(signatureHex),
      new TextEncoder().encode(timestamp + rawBody)
    );
  } catch {
    return false;
  }
}

function validateInput(input) {
  if (!input || !Array.isArray(input.products)) return "products must be an array";
  if (input.products.length < 1 || input.products.length > 200) {
    return "products must contain between 1 and 200 items";
  }

  for (const product of input.products) {
    if (!isShortString(product.id, 100)) return "Each product needs a valid id";
    if (!isShortString(product.name, 500)) return "Each product needs a valid name";
    if (!isHttpUrl(product.url)) return "Each product needs a valid HTTPS URL";
    if (product.imageUrl && !isHttpUrl(product.imageUrl)) return "imageUrl must be HTTPS";
  }

  return null;
}

function normalizeProduct(product) {
  return {
    id: String(product.id),
    name: String(product.name),
    price: optionalString(product.price, 100),
    condition: optionalString(product.condition, 100),
    stock: optionalString(product.stock, 100),
    url: String(product.url),
    brandEnglish: optionalString(product.brandEnglish, 200),
    brandJapanese: optionalString(product.brandJapanese, 200),
    imageUrl: product.imageUrl ? String(product.imageUrl) : null,
  };
}

async function sendDiscordMessage(env, payload, options) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) {
    throw new Error("Discord Bot credentials are not configured");
  }

  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const url = `${DISCORD_API_BASE}/channels/${encodeURIComponent(env.DISCORD_CHANNEL_ID)}/messages`;
  let response = await discordRequest(fetchImpl, url, env.DISCORD_BOT_TOKEN, payload);

  if (response.status === 429) {
    const retryAfterMs = await discordRetryAfterMs(response);
    await sleepImpl(Math.min(retryAfterMs, 60_000));
    response = await discordRequest(fetchImpl, url, env.DISCORD_BOT_TOKEN, payload);
  }

  if (!response.ok) {
    const body = await safeResponseText(response);
    throw new Error(
      `Discord Bot message failed with HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }
}

function discordRequest(fetchImpl, url, token, payload) {
  return fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://github.com/HizKz/fujiya-stock-monitor, 1.0)",
    },
    body: JSON.stringify(payload),
  });
}

async function discordRetryAfterMs(response) {
  const header = response.headers.get("Retry-After");
  if (header && Number.isFinite(Number(header))) {
    return Math.max(0, Math.ceil(Number(header) * 1_000));
  }

  try {
    const body = await response.json();
    if (Number.isFinite(Number(body.retry_after))) {
      return Math.max(0, Math.ceil(Number(body.retry_after) * 1_000));
    }
  } catch {
    // Discord does not guarantee JSON for all failures.
  }
  return 3_000;
}

function isAuthorized(request, expectedToken) {
  return Boolean(expectedToken) && request.headers.get("Authorization") === `Bearer ${expectedToken}`;
}

function isShortString(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function optionalString(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function isHttpUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("Invalid hexadecimal value");
  }
  return Uint8Array.from(hex.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
}

function ephemeralResponse(content) {
  return jsonResponse({ type: 4, data: { content, flags: 64 } });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function textResponse(value, status = 200) {
  return new Response(value, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function safeResponseText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
