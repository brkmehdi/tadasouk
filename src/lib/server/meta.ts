// Thin client for the Meta Model API (https://dev.meta.ai/docs). Server only.
//
// Endpoints used, each checked against the official docs:
//   POST /responses          sam-3.1 segmentation        docs/sam/segmenting
//   POST /asr/transcribe     muse-voice-transcribe-1.0   docs/api-reference/voice/transcribe
//   POST /chat/completions   muse-spark-1.3 tool calls   docs/tool-calling, docs/reasoning

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { NotSignedInError, requireUser } from "./auth";
import { DbNotConfiguredError } from "./db";
import { REFUSED } from "@/lib/capture/refused";
import { AiCreditError, SpendingCapError, type AiContext, type Caps } from "./usage";

export function serverEnv() {
  const env = getCloudflareContext().env;
  if (!env.MODEL_API_KEY) {
    throw new MissingKeyError();
  }
  const caps: Caps = {
    dailyUsd: Number(env.DAILY_CAP_USD ?? "5"),
    freeDailyUsd: Number(env.AI_FREE_DAILY_USD ?? "0.5"),
  };
  return { env, caps, base: env.MODEL_API_BASE ?? "https://api.meta.ai/v1", key: env.MODEL_API_KEY };
}

// Every AI route starts here: a signed-in account, and the caps its calls are checked against.
export async function aiContext(): Promise<AiContext> {
  const { caps } = serverEnv();
  const user = await requireUser();
  return { userId: user.id, caps };
}

export class MissingKeyError extends Error {
  constructor() {
    super("MODEL_API_KEY is not set. Add it to .dev.vars locally or as a Cloudflare secret.");
  }
}

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Meta Model API returned ${status}: ${body.slice(0, 500)}`);
  }
}

export async function metaFetch(path: string, init: RequestInit & { accept?: string }) {
  const { base, key } = serverEnv();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  if (init.accept) headers.set("Accept", init.accept);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new MetaApiError(res.status, await res.text());
  }
  return res;
}

type ResponsesOutput = {
  output?: { type: string; content?: { type: string; text?: string }[]; results?: { url?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
};

// One non-streaming Responses API call whose answer is constrained to `schema`
// (docs/structured-output). Returns the parsed JSON, token usage, web searches run, and the pages
// those searches returned (with `include: ["web_search_call.results"]`).
export async function responsesJson<T>(body: Record<string, unknown>, name: string, schema: object) {
  const res = await metaFetch("/responses", {
    method: "POST",
    accept: "application/json",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, text: { format: { type: "json_schema", name, strict: true, schema } } }),
  });
  const data = (await res.json()) as ResponsesOutput;
  const text = data.output
    ?.filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .at(-1)?.text;
  let parsed: T | null = null;
  try {
    parsed = text ? (JSON.parse(text) as T) : null;
  } catch {
    // Left null; the caller answers with an error.
  }
  return {
    parsed,
    searches: data.output?.filter((o) => o.type === "web_search_call").length ?? 0,
    found: data.output?.flatMap((o) => (o.type === "web_search_call" ? (o.results ?? []).flatMap((r) => (r.url ? [r.url] : [])) : [])) ?? [],
    usage: {
      prompt_tokens: data.usage?.input_tokens,
      completion_tokens: data.usage?.output_tokens,
      prompt_tokens_details: { cached_tokens: data.usage?.input_tokens_details?.cached_tokens },
    },
  };
}

// An image request can answer 200 and refuse inside the stream, before any image. Reads the
// first part to know, and gives back the same stream whole.
export async function watchRefusal(upstream: Response) {
  const reader = upstream.body!.getReader();
  const first = await reader.read();
  const refused = !!first.value && new TextDecoder().decode(first.value).includes(REFUSED);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.value) controller.enqueue(first.value);
      if (first.done) controller.close();
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: () => reader.cancel(),
  });
  return { refused, body };
}

// A photo as the phone sends it to the AI routes: a JPEG data URL, small enough for one request.
export const isJpegPhoto = (s: unknown, maxLength = 600_000): s is string =>
  typeof s === "string" && s.startsWith("data:image/jpeg;base64,") && s.length <= maxLength;

// Maps known failures to JSON the capture screen can show in its caption line.
export function errorResponse(err: unknown) {
  if (err instanceof NotSignedInError) {
    return NextResponse.json({ error: "signed_out", message: "Connectez-vous pour utiliser l'IA." }, { status: 401 });
  }
  if (err instanceof AiCreditError) {
    return NextResponse.json(
      {
        error: err.pending ? "ai_pending" : "ai_credit",
        availableUsd: err.availableUsd,
        message: err.pending
          ? "L'IA de votre compte attend son activation. Nous vous prévenons dès qu'elle est prête."
          : "Votre crédit IA est épuisé. Écrivez-nous pour le recharger.",
      },
      { status: 402 },
    );
  }
  if (err instanceof SpendingCapError) {
    return NextResponse.json({ error: "spending_cap", message: "L'IA est en pause pour aujourd'hui. Réessayez demain." }, { status: 402 });
  }
  if (err instanceof DbNotConfiguredError) {
    console.error(err.message);
    return NextResponse.json({ error: "no_database", message: err.message }, { status: 500 });
  }
  if (err instanceof MissingKeyError) {
    return NextResponse.json({ error: "missing_key", message: err.message }, { status: 500 });
  }
  if (err instanceof MetaApiError) {
    console.error(err.message);
    return NextResponse.json({ error: "upstream", status: err.status, message: err.body.slice(0, 300) }, { status: 502 });
  }
  console.error(err);
  return NextResponse.json({ error: "internal", message: String(err) }, { status: 500 });
}
