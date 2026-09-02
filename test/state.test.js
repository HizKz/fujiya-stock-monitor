import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  emptyState,
  findNewProducts,
  loadState,
  saveState,
  withSeenProducts,
} from "../src/state.js";

const products = [
  { id: "1", name: "one" },
  { id: "2", name: "two" },
];

test("an absent state file is treated as the initial baseline", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fujiya-state-"));
  const state = await loadState(path.join(directory, "missing.json"));
  assert.deepEqual(state, emptyState());
});

test("only unseen products inserted before the first known product are new", () => {
  const orderedProducts = [
    { id: "3", name: "newest" },
    { id: "1", name: "known" },
    { id: "2", name: "older rollover" },
  ];
  const initial = { schemaVersion: 1, seenProductIds: ["1"] };
  assert.deepEqual(findNewProducts(orderedProducts, initial), [orderedProducts[0]]);

  const updated = withSeenProducts(initial, orderedProducts);
  assert.deepEqual(updated.seenProductIds, ["1", "3", "2"]);
  assert.deepEqual(findNewProducts(orderedProducts, updated), []);
});

test("an unseen product after a known product is not treated as a new arrival", () => {
  const initial = { schemaVersion: 1, seenProductIds: ["1"] };
  assert.deepEqual(findNewProducts(products, initial), []);
});

test("a completely replaced page is baselined without a notification burst", () => {
  const initial = { schemaVersion: 1, seenProductIds: ["old"] };
  assert.deepEqual(findNewProducts(products, initial), []);
});

test("saveState writes valid JSON atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fujiya-state-"));
  const filePath = path.join(directory, "nested", "state.json");
  const state = { schemaVersion: 1, seenProductIds: ["1", "2"] };

  await saveState(filePath, state);

  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), state);
});

test("loadState rejects duplicate product ids", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fujiya-state-"));
  const filePath = path.join(directory, "state.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      filePath,
      JSON.stringify({ schemaVersion: 1, seenProductIds: ["1", "1"] }),
      "utf8"
    )
  );

  await assert.rejects(loadState(filePath), /State file is invalid/);
});
