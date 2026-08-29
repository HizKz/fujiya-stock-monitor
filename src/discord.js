const MAX_EMBEDS_PER_MESSAGE = 10;

export async function postNewProducts(webhookUrl, products, options = {}) {
  const batches = chunk(products, MAX_EMBEDS_PER_MESSAGE);

  for (let index = 0; index < batches.length; index += 1) {
    await postWebhook(
      webhookUrl,
      {
        username: "Fujiya AVIC Stock Monitor",
        content: `🆕 新着中古商品 ${products.length}件${
          batches.length > 1 ? ` (${index + 1}/${batches.length})` : ""
        }`,
        embeds: batches[index].map(productToEmbed),
        allowed_mentions: { parse: [] },
      },
      options
    );
  }
}

export async function postTestNotification(webhookUrl, options = {}) {
  await postWebhook(
    webhookUrl,
    {
      username: "Fujiya AVIC Stock Monitor",
      content: "✅ Fujiya AVIC新着監視のWebhook接続テストに成功しました。",
      allowed_mentions: { parse: [] },
    },
    options
  );
}

export function productToEmbed(product) {
  return {
    title: product.name.slice(0, 256),
    url: product.url,
    color: product.stock === "在庫あり" ? 0x2ecc71 : 0x95a5a6,
    fields: [
      { name: "価格", value: product.price || "不明", inline: true },
      { name: "ランク", value: product.condition || "不明", inline: true },
      { name: "在庫", value: product.stock, inline: true },
    ],
    footer: { text: `商品コード: ${product.id}` },
  };
}

async function postWebhook(webhookUrl, payload, options) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const timeoutMs = options.timeoutMs || 10_000;

  let response = await sendRequest(fetchImpl, webhookUrl, payload, timeoutMs);

  if (response.status === 429) {
    const retryAfterMs = await getRetryAfterMs(response);
    await sleepImpl(Math.min(retryAfterMs, 60_000));
    response = await sendRequest(fetchImpl, webhookUrl, payload, timeoutMs);
  }

  if (!response.ok) {
    const body = await safeResponseText(response);
    throw new Error(`Discord webhook failed with HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }
}

async function sendRequest(fetchImpl, webhookUrl, payload, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Discord webhook timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getRetryAfterMs(response) {
  const header = response.headers.get("Retry-After");
  if (header && Number.isFinite(Number(header))) {
    return Math.max(0, Math.ceil(Number(header) * 1000));
  }

  try {
    const body = await response.json();
    if (Number.isFinite(Number(body.retry_after))) {
      return Math.max(0, Math.ceil(Number(body.retry_after) * 1000));
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

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
