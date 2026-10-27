// Thin client for the Meta Model API (https://dev.meta.ai/docs). Server only.
//
// Endpoints used, each checked against the official docs:
//   POST /responses          sam-3.1 segmentation        docs/sam/segmenting
//   POST /asr/transcribe     muse-voice-transcribe-1.0   docs/api-reference/voice/transcribe
//   POST /chat/completions   muse-spark-1.3 tool calls   docs/tool-calling, docs/reasoning

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { SpendingCapError, type Caps } from "./usage";

export function serverEnv() {
  const env = getCloudflareContext().env;
  if (!env.MODEL_API_KEY) {
    throw new MissingKeyError();
  }
  const caps: Caps = {
    sessionUsd: Number(env.SESSION_CAP_USD ?? "0.5"),
    dailyUsd: Number(env.DAILY_CAP_USD ?? "5"),
  };
  return { env, caps, base: env.MODEL_API_BASE ?? "https://api.meta.ai/v1", key: env.MODEL_API_KEY };
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

// Maps known failures to JSON the capture screen can show in its caption line.
export function errorResponse(err: unknown) {
  if (err instanceof SpendingCapError) {
    return NextResponse.json({ error: "spending_cap", scope: err.scope, message: err.message }, { status: 402 });
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
