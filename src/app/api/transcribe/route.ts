// One voice chunk -> text. The browser cuts speech into short WAV clips (16 kHz mono PCM)
// with voice activity detection; each clip is one PUSH_TO_TALK turn.

import { NextResponse } from "next/server";
import { errorResponse, metaFetch, serverEnv } from "@/lib/server/meta";
import { PRICES, reserve, settle } from "@/lib/server/usage";

const MAX_BYTES = 32_000 * 30 + 44; // 30 s of 16 kHz 16-bit mono, plus the WAV header

// Words the merchant says that a general model tends to mishear.
const KEYWORDS = ["hada", "hadi", "hadou", "dirham", "drahem", "euro", "promo", "remise", "taman", "bghit"];

export async function POST(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const audio = await req.arrayBuffer();
  if (audio.byteLength < 44 || audio.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "bad_audio" }, { status: 400 });
  }
  const seconds = (audio.byteLength - 44) / 32_000;

  try {
    const { caps } = serverEnv();
    const r = reserve(
      caps,
      sessionId,
      "muse-voice-transcribe-1.0",
      "/asr/transcribe",
      Math.ceil(seconds) * PRICES["muse-voice-transcribe-1.0"].second,
    );
    const form = new FormData();
    form.append(
      "request",
      new Blob(
        [
          JSON.stringify({
            model: "muse-voice-transcribe-1.0",
            audioEncoding: "WAV",
            mode: "PUSH_TO_TALK",
            languageBias: ["Arabic", "French", "English"],
            keywords: KEYWORDS,
          }),
        ],
        { type: "application/json" },
      ),
    );
    form.append("audio", new Blob([audio], { type: "audio/wav" }), "chunk.wav");

    try {
      const res = await metaFetch(`/asr/transcribe?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "POST",
        accept: "application/json",
        body: form,
      });
      const data = (await res.json()) as { transcript?: string; audioDurationMs?: number };
      const billedSeconds = Math.floor((data.audioDurationMs ?? seconds * 1000) / 1000);
      const entry = settle(r, billedSeconds * PRICES["muse-voice-transcribe-1.0"].second, true, {
        audioMs: data.audioDurationMs ?? 0,
      });
      return NextResponse.json({ transcript: data.transcript ?? "", latencyMs: entry.latencyMs });
    } catch (err) {
      settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
