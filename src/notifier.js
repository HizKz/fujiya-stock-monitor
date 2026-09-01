import { createHash } from "node:crypto";

export async function postBotNotification(apiUrl, apiToken, products, options = {}) {
  return postNotification(apiUrl, apiToken, { products }, {
    ...options,
    idempotencyKey: buildIdempotencyKey(products),
  });
}

export async function postBotTestNotification(apiUrl, apiToken, products, options = {}) {
  return postNotification(apiUrl, apiToken, { products, test: true }, options);
}

export function buildIdempotencyKey(products) {
  const ids = products.map((product) => product.id).sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

async function postNotification(apiUrl, apiToken, payload, options) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const timeoutMs = options.timeoutMs || 15_000;
  const headers = {
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

async function sendRequest(fetchImpl, apiUrl, headers, payload, timeoutMs) {
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
    if (error?.name === "AbortError") {
      throw new Error(`Bot notification API timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getRetryAfterMs(response) {
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
    // A rate-limit response is not guaranteed to contain JSON.
  }

  return 3_000;
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
