import type { Product } from "../shared/domain.ts";

export function createProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "240000000001",
    name: "Sample DAC",
    price: "￥12,800(税込)",
    condition: "AB+",
    stock: "在庫あり",
    url: "https://www.fujiya-avic.co.jp/shop/g/g240000000001/",
    brandEnglish: "SAMPLE AUDIO",
    brandJapanese: "サンプルオーディオ",
    imageUrl: "https://www.fujiya-avic.co.jp/sample.jpg",
    ...overrides,
  };
}

export function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

export function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON string request body");
  return JSON.parse(body) as unknown;
}

export async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
