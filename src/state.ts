import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MonitorState, Product } from "../shared/domain.ts";

const SCHEMA_VERSION = 1;

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

  // The category is sorted by newest first. Only an unseen prefix represents
  // products inserted at the top. Unseen products after a known item are older
  // products rolling over from page 2 as items disappear from page 1.
  if (firstKnownIndex < 0) return [];
  return products.slice(0, firstKnownIndex).filter((product) => !seenIds.has(product.id));
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
