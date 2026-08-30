const MAX_EMBED_DESCRIPTION_LENGTH = 4_096;
const USED_LIST_URL = "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/";
const WEBHOOK_USERNAME = "フジヤエービック在庫確認BOT";

export async function postNewProducts(webhookUrl, products, options = {}) {
  await postWebhook(
    webhookUrl,
    {
      username: WEBHOOK_USERNAME,
      embeds: [productsToSummaryEmbed(products)],
      allowed_mentions: { parse: [] },
    },
    options
  );
}

export async function postTestNotification(webhookUrl, products, options = {}) {
  await postWebhook(
    webhookUrl,
    {
      username: WEBHOOK_USERNAME,
      content: "🧪 新着通知の表示テスト",
      embeds: [productsToSummaryEmbed(products)],
      allowed_mentions: { parse: [] },
    },
    options
  );
}

export function productsToSummaryEmbed(products) {
  if (products.length === 0) {
    throw new Error("At least one product is required to create a Discord notification");
  }

  const lines = [];

  for (const [index, product] of products.entries()) {
    const line = productToListLine(product, index + 1);
    const remainingCount = products.length - (lines.length + 1);
    const candidate = buildDescription([...lines, line], remainingCount);

    if (candidate.length > MAX_EMBED_DESCRIPTION_LENGTH) break;
    lines.push(line);
  }

  const hiddenCount = products.length - lines.length;
  const embed = {
    title: `🚨 新着商品のお知らせ（${products.length}件）`,
    color: 0xe74c3c,
    description: buildDescription(lines, hiddenCount),
  };

  if (products[0].imageUrl) {
    embed.thumbnail = { url: products[0].imageUrl };
  }

  return embed;
}

function productToListLine(product, number) {
  const stockIcon = product.stock === "在庫あり" ? "🟢" : "⚫";
  const brand = product.brandEnglish || product.brandJapanese;
  const label = brand ? `${brand} ${product.name}` : product.name;
  return `${number}. ${stockIcon} [${escapeLinkText(label)}](${product.url}) — **${
    product.price || "価格不明"
  }**`;
}

function buildDescription(lines, hiddenCount) {
  const parts = [lines.join("\n")];

  if (hiddenCount > 0) {
    parts.push(`…ほか **${hiddenCount}件** あります`);
  }

  parts.push(`➤ [中古リスト一覧ページを開く](${USED_LIST_URL})`);
  return parts.filter(Boolean).join("\n\n");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
