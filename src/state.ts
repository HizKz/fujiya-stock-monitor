import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MonitorState, Product } from "../shared/domain.ts";

const SCHEMA_VERSION = 1;
const PRODUCT_ID_PATTERN = /^\d{12}$/;
const PRODUCT_ID_SERIES_LENGTH = 6;

export async function loadState(filePath: string): Promise<MonitorState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    validateState(parsed);
    return parsed;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function saveState(filePath: string, state: MonitorState): Promise<void> {
  validateState(state);
  await mkdir(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.tmp`;
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, filePath);
}

export function findNewProducts(products: Product[], state: MonitorState): Product[] {
  const seenIds = new Set(state.seenProductIds);
  const firstKnownIndex = products.findIndex((product) => seenIds.has(product.id));
  const latestSeenIdBySeries = findLatestSeenIdBySeries(state.seenProductIds);

  // The category is usually sorted newest first, so keep treating an unseen
  // prefix as new. The site can also insert a new item later in the page; in
  // that case, a product ID newer than the latest known ID in the same series
  // is also new. Lower IDs are older products rolling over from another page.
  return products.filter((product, index) => {
    if (seenIds.has(product.id)) return false;
    if (firstKnownIndex >= 0 && index < firstKnownIndex) return true;

    if (!PRODUCT_ID_PATTERN.test(product.id)) return false;
    const series = product.id.slice(0, PRODUCT_ID_SERIES_LENGTH);
    const latestSeenId = latestSeenIdBySeries.get(series);
    return latestSeenId !== undefined && product.id > latestSeenId;
  });
}

export function withSeenProducts(state: MonitorState, products: Product[]): MonitorState {
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

export function emptyState(): MonitorState {
  return { schemaVersion: SCHEMA_VERSION, seenProductIds: [] };
}

function findLatestSeenIdBySeries(ids: string[]): Map<string, string> {
  const latestBySeries = new Map<string, string>();

  for (const id of ids) {
    if (!PRODUCT_ID_PATTERN.test(id)) continue;

    const series = id.slice(0, PRODUCT_ID_SERIES_LENGTH);
    const latestId = latestBySeries.get(series);
    if (latestId === undefined || id > latestId) latestBySeries.set(series, id);
  }

  return latestBySeries;
}

function validateState(state: unknown): asserts state is MonitorState {
  if (
    !isRecord(state) ||
    state.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(state.seenProductIds) ||
    state.seenProductIds.some((id) => typeof id !== "string") ||
    new Set(state.seenProductIds).size !== state.seenProductIds.length
  ) {
    throw new Error("State file is invalid or uses an unsupported schema");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
