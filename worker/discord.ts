import type {
  FetchLike,
  NotificationInput,
  NotificationRecord,
  Product,
  StockStatus,
} from "../shared/domain.ts";
import { buildMessage, type DiscordMessage } from "./render.ts";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const NOTIFICATION_TTL_SECONDS = 60 * 60 * 24 * 7;
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;
const CUSTOM_ID_PATTERN = /^stock:(?:(?:first|prev|next):)?([0-9a-f]{32}):(\d+)$/;

export interface NotificationKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface NotificationEnv {
  NOTIFICATIONS: NotificationKv;
  NOTIFIER_API_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CHANNEL_ID?: string;
}

export interface InteractionEnv {
  NOTIFICATIONS: NotificationKv;
  DISCORD_PUBLIC_KEY?: string;
}

interface RequestOptions {
  fetchImpl?: FetchLike;
  sleepImpl?: (milliseconds: number) => Promise<void>;
}

interface InteractionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface DiscordInteraction {
  type: number;
  application_id?: string;
  token?: string;
  data?: { custom_id?: string };
}

interface InteractionUpdate {
  type: 7;
  data: DiscordMessage;
}

export async function createNotification(
  request: Request,
  env: NotificationEnv,
  options: RequestOptions = {}
): Promise<Response> {
  if (!isAuthorized(request, env.NOTIFIER_API_TOKEN)) {
    return textResponse("Unauthorized", 401);
  }

  let rawInput: unknown;
  try {
    rawInput = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON" }, 400);
  }

  const parsedInput = parseNotificationInput(rawInput);
  if (!parsedInput.ok) return jsonResponse({ error: parsedInput.error }, 400);

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey && !/^[0-9a-f]{64}$/.test(idempotencyKey)) {
    return jsonResponse({ error: "Invalid Idempotency-Key" }, 400);
  }

  if (idempotencyKey) {
    const existingId = await env.NOTIFICATIONS.get(`idempotency:${idempotencyKey}`);
    if (existingId) return jsonResponse({ ok: true, duplicate: true, notificationId: existingId });
  }

  const notificationId = crypto.randomUUID().replaceAll("-", "");
  const record: NotificationRecord = {
    products: parsedInput.value.products,
    test: parsedInput.value.test === true,
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

export async function handleInteraction(
  request: Request,
  env: InteractionEnv,
  ctx?: InteractionContext,
  options: RequestOptions = {}
): Promise<Response> {
  const rawBody = await request.text();
  if (!(await verifyDiscordSignature(request.headers, rawBody, env.DISCORD_PUBLIC_KEY))) {
    return textResponse("Invalid request signature", 401);
  }

  let rawInteraction: unknown;
  try {
    rawInteraction = JSON.parse(rawBody);
  } catch {
    return textResponse("Invalid JSON", 400);
  }

  if (!isDiscordInteraction(rawInteraction)) return textResponse("Invalid interaction", 400);
  const interaction = rawInteraction;

  if (interaction.type === 1) return jsonResponse({ type: 1 });
  if (interaction.type !== 3) {
    return ephemeralResponse("この操作には対応していません。");
  }

  const match = interaction.data?.custom_id?.match(CUSTOM_ID_PATTERN);
  if (!match) return ephemeralResponse("このボタンには対応していません。");

  const notificationId = match[1];
  const requestedPage = match[2];
  if (!notificationId || requestedPage === undefined) {
    return ephemeralResponse("このボタンには対応していません。");
  }

  if (ctx && interaction.application_id && interaction.token) {
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

  return buildInteractionUpdate(notificationId, Number(requestedPage), env);
}

async function buildInteractionUpdate(
  notificationId: string,
  requestedPage: number,
  env: InteractionEnv
): Promise<Response> {
  const stored = await env.NOTIFICATIONS.get(`notification:${notificationId}`);
  if (!stored) {
    return ephemeralResponse("この通知のページ切り替え期限（7日間）が切れました。");
  }

  let rawRecord: unknown;
  try {
    rawRecord = JSON.parse(stored);
  } catch {
    return ephemeralResponse("通知データを読み込めませんでした。");
  }

  const record = parseNotificationRecord(rawRecord);
  if (!record) return ephemeralResponse("通知データを読み込めませんでした。");

  const result: InteractionUpdate = {
    type: 7,
    data: buildMessage(record.products, notificationId, requestedPage, record.test),
  };
  return jsonResponse(result);
}

async function updateInteractionMessage(
  interaction: DiscordInteraction,
  notificationId: string,
  requestedPage: number,
  env: InteractionEnv,
  options: RequestOptions
): Promise<void> {
  try {
    const response = await buildInteractionUpdate(notificationId, requestedPage, env);
    const result: unknown = await response.json();
    if (!isInteractionUpdate(result)) {
      console.error("Unable to build deferred interaction update", result);
      return;
    }

    if (!interaction.application_id || !interaction.token) return;
    const fetchImpl = options.fetchImpl ?? fetch;
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

export async function verifyDiscordSignature(
  headers: Headers,
  rawBody: string,
  publicKeyHex: string | undefined
): Promise<boolean> {
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

function parseNotificationInput(
  input: unknown
): { ok: true; value: NotificationInput } | { ok: false; error: string } {
  if (!isRecord(input) || !Array.isArray(input.products)) {
    return { ok: false, error: "products must be an array" };
  }
  if (input.products.length < 1 || input.products.length > 200) {
    return { ok: false, error: "products must contain between 1 and 200 items" };
  }

  const products: Product[] = [];
  for (const product of input.products) {
    if (!isRecord(product) || !isShortString(product.id, 100)) {
      return { ok: false, error: "Each product needs a valid id" };
    }
    if (!isShortString(product.name, 500)) {
      return { ok: false, error: "Each product needs a valid name" };
    }
    if (!isHttpUrl(product.url)) {
      return { ok: false, error: "Each product needs a valid HTTPS URL" };
    }
    if (product.imageUrl && !isHttpUrl(product.imageUrl)) {
      return { ok: false, error: "imageUrl must be HTTPS" };
    }

    products.push(normalizeProduct(product));
  }

  return { ok: true, value: { products, test: input.test === true } };
}

function parseNotificationRecord(input: unknown): NotificationRecord | null {
  const parsed = parseNotificationInput(input);
  if (!parsed.ok || !isRecord(input)) return null;
  return {
    products: parsed.value.products,
    test: input.test === true,
    createdAt: typeof input.createdAt === "string" ? input.createdAt : "",
  };
}

function normalizeProduct(product: Record<string, unknown>): Product {
  return {
    id: String(product.id),
    name: String(product.name),
    price: optionalString(product.price, 100),
    condition: optionalString(product.condition, 100),
    stock: normalizeStock(product.stock),
    url: String(product.url),
    brandEnglish: optionalString(product.brandEnglish, 200),
    brandJapanese: optionalString(product.brandJapanese, 200),
    imageUrl: product.imageUrl ? String(product.imageUrl) : null,
  };
}

function normalizeStock(value: unknown): StockStatus {
  return value === "在庫あり" ? "在庫あり" : "売り切れ";
}

async function sendDiscordMessage(
  env: NotificationEnv,
  payload: DiscordMessage,
  options: RequestOptions
): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) {
    throw new Error("Discord Bot credentials are not configured");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
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

function discordRequest(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  payload: DiscordMessage
): Promise<Response> {
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

async function discordRetryAfterMs(response: Response): Promise<number> {
  const header = response.headers.get("Retry-After");
  if (header && Number.isFinite(Number(header))) {
    return Math.max(0, Math.ceil(Number(header) * 1_000));
  }

  try {
    const body: unknown = await response.json();
    if (isRecord(body) && Number.isFinite(Number(body.retry_after))) {
      return Math.max(0, Math.ceil(Number(body.retry_after) * 1_000));
    }
  } catch {
    // Discord does not guarantee JSON for all failures.
  }
  return 3_000;
}

function isAuthorized(request: Request, expectedToken: string | undefined): boolean {
  return Boolean(expectedToken) && request.headers.get("Authorization") === `Bearer ${expectedToken}`;
}

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function optionalString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isDiscordInteraction(value: unknown): value is DiscordInteraction {
  if (!isRecord(value) || typeof value.type !== "number") return false;
  if (value.application_id !== undefined && typeof value.application_id !== "string") return false;
  if (value.token !== undefined && typeof value.token !== "string") return false;
  if (value.data !== undefined) {
    if (!isRecord(value.data)) return false;
    if (value.data.custom_id !== undefined && typeof value.data.custom_id !== "string") return false;
  }
  return true;
}

function isInteractionUpdate(value: unknown): value is InteractionUpdate {
  return isRecord(value) && value.type === 7 && isRecord(value.data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("Invalid hexadecimal value");
  }
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

function ephemeralResponse(content: string): Response {
  return jsonResponse({ type: 4, data: { content, flags: 64 } });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function textResponse(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
