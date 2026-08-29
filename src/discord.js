const MAX_EMBEDS_PER_MESSAGE = 10;
const USED_LIST_URL = "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/";
const WEBHOOK_USERNAME = "フジヤエービック在庫確認BOT";

export async function postNewProducts(webhookUrl, products, options = {}) {
  const batches = chunk(products, MAX_EMBEDS_PER_MESSAGE);

  for (let index = 0; index < batches.length; index += 1) {
    await postWebhook(
      webhookUrl,
      {
        username: WEBHOOK_USERNAME,
        embeds: batches[index].map(productToEmbed),
        allowed_mentions: { parse: [] },
      },
      options
    );
  }
}

export async function postTestNotification(webhookUrl, product, options = {}) {
  await postWebhook(
    webhookUrl,
    {
      username: WEBHOOK_USERNAME,
      content: "🧪 新着通知の表示テスト",
      embeds: [productToEmbed(product)],
      allowed_mentions: { parse: [] },
    },
    options
  );
}

export function productToEmbed(product) {
  const brandLines = [product.brandEnglish, product.brandJapanese]
    .filter(Boolean)
    .map((brand) => `[${escapeLinkText(brand)}](${product.url})`);
  const description = [
    ...brandLines,
    "",
    `[${escapeLinkText(product.name)}](${product.url})`,
    "",
    `**価格: ${product.price || "不明"}**`,
    "",
    `➤ [中古リスト一覧ページを開く](${USED_LIST_URL})`,
  ].join("\n");

  const embed = {
    title: "🚨 新着商品のお知らせ",
    color: 0xe74c3c,
    description,
  };

  if (product.imageUrl) {
    embed.thumbnail = { url: product.imageUrl };
  }

  return embed;
}

function escapeLinkText(value) {
  return value.replace(/[\\[\]()]/g, "\\$&");
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
