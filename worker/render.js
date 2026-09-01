export const USED_LIST_URL = "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/";
export const PAGE_SIZE = 5;

export function buildMessage(products, notificationId, page = 0, test = false) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("At least one product is required to create a Discord notification");
  }

  const pageCount = Math.ceil(products.length / PAGE_SIZE);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), pageCount - 1);
  const firstIndex = safePage * PAGE_SIZE;
  const pageProducts = products.slice(firstIndex, firstIndex + PAGE_SIZE);
  const titlePrefix = test ? "🧪 表示テスト" : "🚨 新着商品のお知らせ";
  const embed = {
    title: `${titlePrefix}（${products.length}件）`,
    color: test ? 0x3498db : 0xe74c3c,
    description: pageProducts
      .map((product, index) => productToListLine(product, firstIndex + index + 1))
      .join("\n\n"),
    footer: { text: `ページ ${safePage + 1} / ${pageCount}` },
  };

  if (pageProducts[0]?.imageUrl) {
    embed.thumbnail = { url: pageProducts[0].imageUrl };
  }

  return {
    embeds: [embed],
    components: [buildActionRow(notificationId, safePage, pageCount)],
    allowed_mentions: { parse: [] },
  };
}

function buildActionRow(notificationId, page, pageCount) {
  const components = [];

  if (pageCount > 1) {
    components.push(
      {
        type: 2,
        style: 2,
        label: "◀ 前へ",
        custom_id: `stock:${notificationId}:${Math.max(0, page - 1)}`,
        disabled: page === 0,
      },
      {
        type: 2,
        style: 2,
        label: `${page + 1} / ${pageCount}`,
        custom_id: `stock-page:${notificationId}:${page}`,
        disabled: true,
      },
      {
        type: 2,
        style: 2,
        label: "次へ ▶",
        custom_id: `stock:${notificationId}:${Math.min(pageCount - 1, page + 1)}`,
        disabled: page === pageCount - 1,
      }
    );
  }

  components.push({
    type: 2,
    style: 5,
    label: "中古一覧ページを開く",
    url: USED_LIST_URL,
  });

  return { type: 1, components };
}

function productToListLine(product, number) {
  const stockIcon = product.stock === "在庫あり" ? "🟢" : "⚫";
  const brand = product.brandEnglish || product.brandJapanese;
  const label = brand ? `${brand} ${product.name}` : product.name;
  const condition = product.condition ? ` / ${product.condition}` : "";
  return `${number}. ${stockIcon} [${escapeLinkText(label)}](${product.url})\n**${
    product.price || "価格不明"
  }**${condition}`;
}

function escapeLinkText(value) {
  return String(value).replace(/[\\[\]()]/g, "\\$&");
}
