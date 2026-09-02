import type { Product } from "../shared/domain.ts";

export const USED_LIST_URL = "https://www.fujiya-avic.co.jp/shop/c/c40_ssd/";
export const PAGE_SIZE = 1;

export interface DiscordEmbed {
  title: string;
  color: number;
  description: string;
  thumbnail?: { url: string };
  footer?: { text: string };
}

export interface DiscordButton {
  type: 2;
  style: 2;
  label: string;
  custom_id: string;
  disabled: boolean;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

export interface DiscordMessage {
  embeds: DiscordEmbed[];
  components: DiscordActionRow[];
  allowed_mentions: { parse: string[] };
}

export function buildMessage(
  products: Product[],
  notificationId: string,
  page = 0,
  test = false
): DiscordMessage {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("At least one product is required to create a Discord notification");
  }

  const pageCount = Math.ceil(products.length / PAGE_SIZE);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), pageCount - 1);
  const firstIndex = safePage * PAGE_SIZE;
  const pageProducts = products.slice(firstIndex, firstIndex + PAGE_SIZE);
  const product = pageProducts[0];
  if (!product) throw new Error("Requested product page is empty");
  const embed = productToEmbed(product, products.length, test);
  embed.footer = { text: `${safePage + 1} / ${products.length}件` };

  return {
    embeds: [embed],
    components: pageCount > 1 ? [buildActionRow(notificationId, safePage, pageCount)] : [],
    allowed_mentions: { parse: [] },
  };
}

function buildActionRow(notificationId: string, page: number, pageCount: number): DiscordActionRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: "⏮ 最初へ",
        custom_id: `stock:first:${notificationId}:0`,
        disabled: page === 0,
      },
      {
        type: 2,
        style: 2,
        label: "◀ 前へ",
        custom_id: `stock:prev:${notificationId}:${Math.max(0, page - 1)}`,
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
        custom_id: `stock:next:${notificationId}:${Math.min(pageCount - 1, page + 1)}`,
        disabled: page === pageCount - 1,
      },
    ],
  };
}

function productToEmbed(product: Product, totalCount: number, test: boolean): DiscordEmbed {
  const brandLines = [product.brandEnglish, product.brandJapanese]
    .filter(Boolean)
    .map((brand) => `[${escapeLinkText(brand)}](${product.url})`);
  const description = [
    ...brandLines,
    "",
    `[${escapeLinkText(product.name)}](${product.url})`,
    "",
    `**価格: ${product.price || "価格不明"}**`,
    "",
    `➤ [中古リスト一覧ページを開く](${USED_LIST_URL})`,
  ].join("\n");
  const embed: DiscordEmbed = {
    title: test
      ? `🧪 新着通知の表示テスト（全${totalCount}件）`
      : `🚨 新着商品のお知らせ（全${totalCount}件）`,
    color: test ? 0x3498db : 0xe74c3c,
    description,
  };

  if (product.imageUrl) embed.thumbnail = { url: product.imageUrl };
  return embed;
}

function escapeLinkText(value: string): string {
  return value.replace(/[\\[\]()]/g, "\\$&");
}
