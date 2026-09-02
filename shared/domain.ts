export type StockStatus = "在庫あり" | "売り切れ";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Product {
  id: string;
  name: string;
  price: string;
  condition: string;
  stock: StockStatus;
  url: string;
  brandEnglish: string;
  brandJapanese: string;
  imageUrl: string | null;
}

export interface MonitorState {
  schemaVersion: 1;
  seenProductIds: string[];
}

export interface NotificationInput {
  products: Product[];
  test?: boolean;
}

export interface NotificationRecord {
  products: Product[];
  test: boolean;
  createdAt: string;
}

export type SchedulerAction = "dispatched" | "skipped" | "failed";

export interface SchedulerStatus {
  ok: boolean;
  action: SchedulerAction;
  cron: string | null;
  scheduledTime: string | null;
  startedAt: string;
  completedAt: string;
  lastDispatchAt: string | null;
  nextDispatchAfter?: string;
  error?: string;
}

export interface RuntimeConfig {
  targetUrl: string;
  stateFile: string;
  requestTimeoutMs: number;
  retryDelayMs: number;
  maxRetryAfterMs: number;
  minimumProductCount: number;
  userAgent: string;
}

export type RunMode = "monitor" | "dry-run" | "notification-test";

export type RunResult =
  | { status: "notification-test"; productCount: number }
  | { status: "dry-run"; productCount: number }
  | { status: "baseline"; productCount: number }
  | { status: "no-change"; productCount: number }
  | { status: "rollover"; productCount: number }
  | { status: "notified"; productCount: number };
