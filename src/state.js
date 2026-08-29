import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1;

export async function loadState(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    validateState(parsed);
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function saveState(filePath, state) {
  validateState(state);
  await mkdir(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.tmp`;
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, filePath);
}

export function findNewProducts(products, state) {
  const seenIds = new Set(state.seenProductIds);
  return products.filter((product) => !seenIds.has(product.id));
}

export function withSeenProducts(state, products) {
  const ids = [...state.seenProductIds];
  const known = new Set(ids);

  for (const product of products) {
    if (!known.has(product.id)) {
      ids.push(product.id);
      known.add(product.id);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    seenProductIds: ids,
  };
}

export function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, seenProductIds: [] };
}

function validateState(state) {
  if (
    !state ||
    state.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(state.seenProductIds) ||
    state.seenProductIds.some((id) => typeof id !== "string") ||
    new Set(state.seenProductIds).size !== state.seenProductIds.length
  ) {
    throw new Error("State file is invalid or uses an unsupported schema");
  }
}
