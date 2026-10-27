// Spending caps and per-call usage log for the Meta Model API.
//
// Every call goes through `reserve()` before it is sent and `settle()` after it returns.
// `reserve()` refuses the call when the worst-case cost would push the capture session
// or the current UTC day over its cap. `settle()` replaces the estimate with the real cost
// and writes one log line per call.
//
// Phase 0 keeps the ledger in isolate memory and logs to Workers Logs. Phase 1 moves it to
// the `api_usage` table in Postgres so the caps hold across isolates and restarts.

// Prices from https://dev.meta.ai/docs/pricing-rate-limits (Standard mode), in US dollars.
export const PRICES = {
  "muse-spark-1.3": { input: 1.25 / 1e6, cachedInput: 0.15 / 1e6, output: 4.25 / 1e6 },
  "sam-3.1": { image: 2.5 / 1000 },
  "muse-image-1.0": { image: 0.01 },
  "muse-voice-transcribe-1.0": { second: 0.18 / 3600 },
} as const;

export type ModelId = keyof typeof PRICES;

export type UsageEntry = {
  at: string;
  sessionId: string;
  model: ModelId;
  endpoint: string;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  detail?: Record<string, number | string>;
};

type Ledger = {
  day: string;
  dayTotal: number;
  sessions: Map<string, number>;
  log: UsageEntry[];
};

const ledger: Ledger = { day: today(), dayTotal: 0, sessions: new Map(), log: [] };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rollDay() {
  const d = today();
  if (ledger.day !== d) {
    ledger.day = d;
    ledger.dayTotal = 0;
    ledger.sessions.clear();
    ledger.log = [];
  }
}

export class SpendingCapError extends Error {
  constructor(
    readonly scope: "session" | "day",
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`Spending cap reached for this ${scope}: $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}`);
  }
}

export type Caps = { sessionUsd: number; dailyUsd: number };

export type Reservation = {
  sessionId: string;
  model: ModelId;
  endpoint: string;
  estimateUsd: number;
  startedAt: number;
};

export function reserve(
  caps: Caps,
  sessionId: string,
  model: ModelId,
  endpoint: string,
  estimateUsd: number,
): Reservation {
  rollDay();
  const sessionSpent = ledger.sessions.get(sessionId) ?? 0;
  if (ledger.dayTotal + estimateUsd > caps.dailyUsd) {
    throw new SpendingCapError("day", ledger.dayTotal, caps.dailyUsd);
  }
  if (sessionSpent + estimateUsd > caps.sessionUsd) {
    throw new SpendingCapError("session", sessionSpent, caps.sessionUsd);
  }
  // Hold the estimate so concurrent calls in this isolate see it.
  ledger.dayTotal += estimateUsd;
  ledger.sessions.set(sessionId, sessionSpent + estimateUsd);
  return { sessionId, model, endpoint, estimateUsd, startedAt: Date.now() };
}

export function settle(
  r: Reservation,
  costUsd: number,
  ok: boolean,
  detail?: Record<string, number | string>,
): UsageEntry {
  rollDay();
  const delta = costUsd - r.estimateUsd;
  ledger.dayTotal += delta;
  ledger.sessions.set(r.sessionId, (ledger.sessions.get(r.sessionId) ?? 0) + delta);
  const entry: UsageEntry = {
    at: new Date().toISOString(),
    sessionId: r.sessionId,
    model: r.model,
    endpoint: r.endpoint,
    costUsd,
    latencyMs: Date.now() - r.startedAt,
    ok,
    detail,
  };
  ledger.log.push(entry);
  if (ledger.log.length > 500) ledger.log.shift();
  console.log(JSON.stringify({ usage: entry }));
  return entry;
}

export function summary(sessionId?: string) {
  rollDay();
  return {
    day: ledger.day,
    dayTotalUsd: ledger.dayTotal,
    sessionTotalUsd: sessionId ? (ledger.sessions.get(sessionId) ?? 0) : undefined,
    calls: (sessionId ? ledger.log.filter((e) => e.sessionId === sessionId) : ledger.log).slice(-100),
  };
}

export function chatCost(usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}) {
  if (!usage) return 0;
  const p = PRICES["muse-spark-1.3"];
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const fresh = (usage.prompt_tokens ?? 0) - cached;
  return fresh * p.input + cached * p.cachedInput + (usage.completion_tokens ?? 0) * p.output;
}
