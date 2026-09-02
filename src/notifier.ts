import { createHash } from "node:crypto";

import type { FetchLike, NotificationInput, Product } from "../shared/domain.ts";

interface RequestOptions {
  fetchImpl?: FetchLike;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  idempotencyKey?: string;
}

export async function postBotNotification(
  apiUrl: string,
  apiToken: string,
  products: Product[],
  options: RequestOptions = {}
): Promise<void> {
  return postNotification(apiUrl, apiToken, { products }, {
    ...options,
    idempotencyKey: buildIdempotencyKey(products),
  });
}

export async function postBotTestNotification(
  apiUrl: string,
  apiToken: string,
  products: Product[],
  options: RequestOptions = {}
): Promise<void> {
  return postNotification(apiUrl, apiToken, { products, test: true }, options);
}

export function buildIdempotencyKey(products: Pick<Product, "id">[]): string {
  const ids = products.map((product) => product.id).sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

async function postNotification(
  apiUrl: string,
  apiToken: string,
  payload: NotificationInput,
  options: RequestOptions
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  let response = await sendRequest(fetchImpl, apiUrl, headers, payload, timeoutMs);

  if (response.status === 429) {
    const retryAfterMs = await getRetryAfterMs(response);
    await sleepImpl(Math.min(retryAfterMs, 60_000));
    response = await sendRequest(fetchImpl, apiUrl, headers, payload, timeoutMs);
  }

  if (!response.ok) {
    const body = await safeResponseText(response);
    throw new Error(
      `Bot notification API failed with HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }
}

async function sendRequest(
  fetchImpl: FetchLike,
  apiUrl: string,
  headers: Record<string, string>,
  payload: NotificationInput,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Bot notification API timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getRetryAfterMs(response: Response): Promise<number> {
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
    // A rate-limit response is not guaranteed to contain JSON.
  }

  return 3_000;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
