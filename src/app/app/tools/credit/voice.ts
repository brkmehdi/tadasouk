"use client";

// A credit said out loud. The microphone is cut into short clips at pauses (same recorder as the
// store assistant), each clip is transcribed by /api/transcribe, and "Done" sends the whole
// sentence to /api/credit/parse, which answers a draft for the "New credit" form.

import { useCallback, useEffect, useRef, useState } from "react";
import { startVoice } from "@/lib/capture/voice";
import type { Lang } from "@/lib/lang";
import type { Words } from "./words";

export type Draft = {
  customer_name: string;
  phone: string;
  note: string;
  amount: number;
  installments: number;
  interval_days: number;
  first_due: string;
};

type Mic = {
  voice: Awaited<ReturnType<typeof startVoice>>;
  stream: MediaStream;
  ctx: AudioContext;
};
export type VoicePhase = "idle" | "listening" | "thinking";

function closeMic(m: Mic | null) {
  if (!m) return Promise.resolve();
  m.stream.getTracks().forEach((t) => t.stop());
  return m.voice.stop().catch(() => {});
}

export function useCreditVoice({ lang, names, w, onDraft }: { lang: Lang; names: string[]; w: Words; onDraft: (d: Draft, said: string) => void }) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noMic, setNoMic] = useState(false);
  const mic = useRef<Mic | null>(null);
  const ready = useRef<Promise<void>>(Promise.resolve());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const said = useRef("");
  const live = useRef(0); // which recording the clips belong to; a cancelled one is dropped

  useEffect(
    () => () => {
      live.current++;
      void closeMic(mic.current);
      mic.current = null;
    },
    [],
  );

  const parse = useCallback(
    async (text: string) => {
      setPhase("thinking");
      setError(null);
      try {
        const res = await fetch("/api/credit/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, text, lang, names }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          draft?: Draft;
          message?: string;
        };
        if (!res.ok || !body.draft) throw new Error(body.message ?? w.error);
        onDraft(body.draft, text);
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : w.error);
      } finally {
        setPhase("idle");
      }
    },
    [sessionId, lang, names, w, onDraft],
  );

  // Call it inside the tap: iOS keeps an AudioContext made later silent.
  const start = () => {
    if (mic.current || phase !== "idle") return;
    const run = ++live.current;
    const ctx = new AudioContext();
    said.current = "";
    setHeard("");
    setError(null);
    setPhase("listening");
    ready.current = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        const voice = await startVoice(ctx, stream, {
          onSpeechStart: () => {},
          onLevel: (rms) => setLevel(Math.min(1, rms * 12)),
          onChunk: (wav) => {
            queue.current = queue.current
              .then(async () => {
                if (run !== live.current) return;
                const res = await fetch(`/api/transcribe?sessionId=${sessionId}`, {
                  method: "POST",
                  headers: { "Content-Type": "audio/wav" },
                  body: wav,
                });
                const body = (await res.json().catch(() => ({}))) as {
                  transcript?: string;
                  message?: string;
                };
                if (run !== live.current) return;
                if (!res.ok) setError(body.message ?? w.error);
                else if (body.transcript?.trim()) {
                  said.current = `${said.current} ${body.transcript.trim()}`.trim();
                  setHeard(said.current);
                }
              })
              .catch(() => {});
          },
        });
        if (run !== live.current) {
          void closeMic({ voice, stream, ctx });
          return;
        }
        mic.current = { voice, stream, ctx };
      } catch {
        void ctx.close().catch(() => {});
        if (run !== live.current) return;
        setNoMic(true);
        setError(w.noMic);
        setPhase("idle");
      }
    })();
  };

  // "Done": the last clip is flushed and transcribed, then the sentence is parsed.
  const finish = async () => {
    const run = live.current;
    await ready.current;
    const m = mic.current;
    mic.current = null;
    setLevel(0);
    if (!m) return;
    setPhase("thinking");
    await closeMic(m);
    await queue.current;
    if (run !== live.current) return;
    const text = said.current.trim();
    if (!text) {
      setError(w.heardNothing);
      setPhase("idle");
      return;
    }
    await parse(text);
  };

  const cancel = () => {
    live.current++;
    void closeMic(mic.current);
    mic.current = null;
    setLevel(0);
    setPhase("idle");
    setError(null);
    setHeard("");
  };

  return { phase, level, heard, error, noMic, start, finish, cancel, parse };
}
export type CreditVoice = ReturnType<typeof useCreditVoice>;
