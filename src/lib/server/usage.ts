// Spending control and usage log for the Meta Model API.
//
// Every call goes through `reserve()` before it is sent and `settle()` after it returns.
//   - Per account (Postgres, supabase/migrations): `reserve()` holds the call's worst-case cost
//     and refuses it when the account has not enough left: the free allowance of the day
//     (AI_FREE_DAILY_USD, reset at midnight in Morocco; 0 since 2026-10-28) plus its balance
//     ($2 welcome credit, given at sign-up to the first 10 accounts, then by the owner in /admin). `settle()`
//     charges the real cost, free allowance first, and keeps one `api_usage` row per call; it
//     writes after the response is sent, so no answer waits for the database.
//   - Whole platform: a daily cap in isolate memory (DAILY_CAP_USD) stays as a safety net.

import { after } from "next/server";
import postgres from "postgres";
import { withDb } from "./db";

// Prices from https://dev.meta.ai/docs/pricing-rate-limits (Standard mode), in US dollars.
export const PRICES = {
  "muse-spark-1.3": { input: 1.25 / 1e6, cachedInput: 0.15 / 1e6, output: 4.25 / 1e6 },
  "sam-3.1": { image: 2.5 / 1000 },
  "muse-image-1.0": { image: 0.01 },
  "muse-voice-transcribe-1.0": { second: 0.18 / 3600 },
} as const;

export type ModelId = keyof typeof PRICES;

export type Caps = { dailyUsd: number; freeDailyUsd: number };
export type AiContext = { userId: string; caps: Caps };

export type Credit = { freeLeftUsd: number; balanceUsd: number; availableUsd: number; freeDailyUsd: number };

export type UsageEntry = {
  at: string;
  userId: string;
  sessionId: string;
  model: ModelId;
  endpoint: string;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  detail?: Record<string, number | string>;
};

export class SpendingCapError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`Platform spending cap reached for today: $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}`);
  }
}

export class AiCreditError extends Error {
  constructor(
    readonly availableUsd: number,
    readonly pending: boolean, // the account waits for the owner to activate it
  ) {
    super(pending ? "AI not activated yet" : "AI credit used up");
  }
}

export type Reservation = {
  usageId: number;
  ctx: AiContext;
  sessionId: string;
  model: ModelId;
  endpoint: string;
  estimateUsd: number;
  startedAt: number;
};

// Platform total for the current UTC day, in this isolate.
const platform = { day: today(), totalUsd: 0 };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rollDay() {
  const d = today();
  if (platform.day !== d) {
    platform.day = d;
    platform.totalUsd = 0;
  }
}

type StatusRow = { free_left: string; balance: string; available: string };

function toCredit(row: StatusRow, caps: Caps): Credit {
  return {
    freeLeftUsd: Number(row.free_left),
    balanceUsd: Number(row.balance),
    availableUsd: Number(row.available),
    freeDailyUsd: caps.freeDailyUsd,
  };
}

export async function reserve(
  ctx: AiContext,
  sessionId: string,
  model: ModelId,
  endpoint: string,
  estimateUsd: number,
): Promise<Reservation> {
  rollDay();
  if (platform.totalUsd + estimateUsd > ctx.caps.dailyUsd) {
    throw new SpendingCapError(platform.totalUsd, ctx.caps.dailyUsd);
  }
  let usageId: number;
  try {
    usageId = await withDb(async (sql) => {
      const [row] = await sql`select public.ai_reserve(
        ${ctx.userId}::uuid, ${sessionId}, ${model}, ${endpoint},
        ${estimateUsd}::numeric, ${ctx.caps.freeDailyUsd}::numeric) as id`;
      return Number(row.id);
    });
  } catch (err) {
    if (err instanceof postgres.PostgresError && err.code === "P0402") {
      const pending = await withDb(async (sql) => {
        const [row] = await sql<{ ai_access: string }[]>`select ai_access from public.profiles where id = ${ctx.userId}::uuid`;
        return row?.ai_access === "pending";
      }).catch(() => false);
      throw new AiCreditError(Number(err.detail ?? 0), pending);
    }
    throw err;
  }
  platform.totalUsd += estimateUsd;
  return { usageId, ctx, sessionId, model, endpoint, estimateUsd, startedAt: Date.now() };
}

export async function settle(
  r: Reservation,
  costUsd: number,
  ok: boolean,
  detail?: Record<string, number | string>,
): Promise<UsageEntry> {
  rollDay();
  platform.totalUsd += costUsd - r.estimateUsd;
  const entry: UsageEntry = {
    at: new Date().toISOString(),
    userId: r.ctx.userId,
    sessionId: r.sessionId,
    model: r.model,
    endpoint: r.endpoint,
    costUsd,
    latencyMs: Date.now() - r.startedAt,
    ok,
    detail,
  };
  console.log(JSON.stringify({ usage: entry }));
  after(() =>
    withDb(
      (sql) => sql`select public.ai_settle(
        ${r.usageId}, ${costUsd}::numeric, ${ok}, ${entry.latencyMs}, ${sql.json(detail ?? {})},
        ${r.ctx.caps.freeDailyUsd}::numeric)`,
    ).catch((err: unknown) => {
      // The call already happened; a lost settle only leaves the estimate held for 10 minutes.
      console.error("usage settle failed", err);
    }),
  );
  return entry;
}

export async function creditStatus(ctx: AiContext): Promise<Credit> {
  return withDb(async (sql) => {
    const [row] = await sql<StatusRow[]>`select * from public.ai_status(${ctx.userId}::uuid, ${ctx.caps.freeDailyUsd}::numeric)`;
    return toCredit(row, ctx.caps);
  });
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
