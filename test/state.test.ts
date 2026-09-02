import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { MonitorState } from "../shared/domain.ts";
import {
  emptyState,
  findNewProducts,
  loadState,
  saveState,
  withSeenProducts,
} from "../src/state.ts";
import { createProduct, must } from "./helpers.ts";

const products = [
  createProduct({ id: "1", name: "one" }),
  createProduct({ id: "2", name: "two" }),
];

test("an absent state file is treated as the initial baseline", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fujiya-state-"));
  const state = await loadState(path.join(directory, "missing.json"));
  expect(state).toEqual(emptyState());
});

test("only unseen products inserted before the first known product are new", () => {
  const orderedProducts = [
    createProduct({ id: "3", name: "newest" }),
    createProduct({ id: "1", name: "known" }),
    createProduct({ id: "2", name: "older rollover" }),
  ];
  const initial: MonitorState = { schemaVersion: 1, seenProductIds: ["1"] };
  expect(findNewProducts(orderedProducts, initial)).toEqual([must(orderedProducts[0])]);

  const updated = withSeenProducts(initial, orderedProducts);
  expect(updated.seenProductIds).toEqual(["1", "3", "2"]);
  expect(findNewProducts(orderedProducts, updated)).toEqual([]);
});

test("an unseen product after a known product is not treated as a new arrival", () => {
  const initial: MonitorState = { schemaVersion: 1, seenProductIds: ["1"] };
  expect(findNewProducts(products, initial)).toEqual([]);
});

test("a completely replaced page is baselined without a notification burst", () => {
  const initial: MonitorState = { schemaVersion: 1, seenProductIds: ["old"] };
  expect(findNewProducts(products, initial)).toEqual([]);
});

test("saveState writes valid JSON atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fujiya-state-"));
  const filePath = path.join(directory, "nested", "state.json");
  const state: MonitorState = { schemaVersion: 1, seenProductIds: ["1", "2"] };

  await saveState(filePath, state);

  expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(state);
});

test("loadState rejects duplicate product ids", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fujiya-state-"));
  const filePath = path.join(directory, "state.json");
  await writeFile(
    filePath,
    JSON.stringify({ schemaVersion: 1, seenProductIds: ["1", "1"] }),
    "utf8"
  );

  await expect(loadState(filePath)).rejects.toThrow(/State file is invalid/);
});
