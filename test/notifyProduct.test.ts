import { expect, test } from "bun:test";

import { selectProductsThrough } from "../src/notifyProduct.ts";
import { createProduct } from "./helpers.ts";

test("selectProductsThrough returns the page prefix including the selected product", () => {
  const products = [
    createProduct({ id: "240004022461" }),
    createProduct({ id: "240004022463" }),
    createProduct({ id: "240004022478" }),
    createProduct({ id: "240001211536" }),
  ];

  expect(selectProductsThrough(products, "240004022478")).toEqual(products.slice(0, 3));
});

test("selectProductsThrough rejects a product outside the selected page", () => {
  expect(() =>
    selectProductsThrough([createProduct({ id: "240004022461" })], "240004022478")
  ).toThrow(/was not found/);
});
