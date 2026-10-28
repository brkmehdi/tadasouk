"use client";

// "Parlez à votre boutique": a microphone button in the back office. Each sentence the merchant
// says (cut at pauses, transcribed) or types goes to /api/store-agent, which changes the store
// and answers in one sentence, read aloud. Every change shows with "Annuler", which puts back
// what it replaced; deleting products waits for the merchant's button.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startVoice } from "@/lib/capture/voice";
import { useT } from "@/lib/i18n";
import type { AgentAction, AgentAnswer, ClientStep } from "@/lib/store-agent";
import { supabase } from "@/lib/supabase/browser";

type Entry =
  | { id: number; who: "me"; text: string }
  | { id: number; who: "store"; text: string; actions: (AgentAction & { undone?: boolean })[]; client: ClientStep[]; error?: boolean }
  | { id: number; who: "note"; text: string };

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never; // per member of the union
type NewEntry = WithoutId<Entry>;
type Voice = Awaited<ReturnType<typeof startVoice>>;
type Mic = { voice: Voice; stream: MediaStream; ctx: AudioContext };

function closeMic(m: Mic | null) {
  if (!m) return;
  void m.voice.stop().catch(() => {});
  m.stream.getTracks().forEach((tr) => tr.stop());
  void m.ctx.close();
}

export function StoreAssistant() {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("assistant.open")}
        className="fixed end-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 flex h-12 w-12 items-center justify-center rounded-full bg-navy text-white shadow-[0_8px_24px_rgba(10,37,64,.35)] active:scale-95"
      >
        <MicIcon />
      </button>
      {open && <Panel onClose={() => setOpen(false)} />}
    </>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const voiceRef = useRef<Mic | null>(null);
  const queueRef = useRef(Promise.resolve());
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const push = (e: NewEntry) => setEntries((l) => [...l, { ...e, id: nextId.current++ } as Entry]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, busy]);
  // Closing the panel stops the microphone.
  useEffect(
    () => () => {
      closeMic(voiceRef.current);
      voiceRef.current = null;
    },
    [],
  );

  const speak = (s: string) => {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(s);
      u.lang = lang === "en" ? "en-US" : "fr-FR";
      speechSynthesis.speak(u);
    } catch {
      // no voice on this browser: the answer stays on screen
    }
  };

  const send = async (said: string) => {
    const clean = said.trim();
    if (!clean) return;
    push({ who: "me", text: clean });
    setBusy(true);
    try {
      const res = await fetch("/api/store-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, text: clean, history: historyRef.current }),
      });
      const body = (await res.json()) as AgentAnswer & { message?: string };
      if (!res.ok) throw new Error(body.message ?? t("common.error"));
      historyRef.current = [...historyRef.current, { role: "user" as const, content: clean }, { role: "assistant" as const, content: body.reply }].slice(-6);
      push({ who: "store", text: body.reply, actions: body.actions, client: body.client });
      if (body.reply) speak(body.reply);
      if (body.actions.length) router.refresh();
      for (const step of body.client) if (step.type === "hero") void makeHero();
    } catch (err) {
      push({ who: "store", text: err instanceof Error ? err.message : t("common.error"), actions: [], client: [], error: true });
    } finally {
      setBusy(false);
    }
  };

  const makeHero = async () => {
    push({ who: "note", text: t("assistant.heroMaking") });
    const res = await fetch("/api/store-hero", { method: "POST" });
    push({ who: "note", text: res.ok ? t("assistant.heroDone") : t("common.error") });
    if (res.ok) router.refresh();
  };

  const undo = async (entryId: number, index: number) => {
    const entry = entries.find((e) => e.id === entryId);
    if (entry?.who !== "store") return;
    const action = entry.actions[index];
    const db = supabase();
    for (const u of [...action.undo].reverse()) {
      const q = u.remove ? db.from(u.table).delete().eq("id", u.id) : db.from(u.table).update(u.before ?? {}).eq("id", u.id);
      const { error } = await q;
      if (error) {
        push({ who: "note", text: t("common.error") });
        return;
      }
    }
    setEntries((l) =>
      l.map((e) => (e.id === entryId && e.who === "store" ? { ...e, actions: e.actions.map((a, i) => (i === index ? { ...a, undone: true } : a)) } : e)),
    );
    router.refresh();
  };

  const confirmDelete = async (entryId: number, ids: string[]) => {
    const { error } = await supabase().from("products").delete().in("id", ids);
    setEntries((l) => l.map((e) => (e.id === entryId && e.who === "store" ? { ...e, client: e.client.filter((c) => c.type !== "confirm_delete") } : e)));
    push({ who: "note", text: error ? t("common.error") : t("assistant.deleted") });
    if (!error) router.refresh();
  };

  const startListening = async () => {
    if (voiceRef.current) return;
    const ctx = new AudioContext(); // in the tap: iOS keeps a later one silent
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const voice = await startVoice(ctx, stream, {
        onSpeechStart: () => speechSynthesis?.cancel(),
        onLevel: (rms) => setLevel(Math.min(1, rms * 12)),
        onChunk: (wav) => {
          queueRef.current = queueRef.current.then(async () => {
            const res = await fetch(`/api/transcribe?sessionId=${sessionId}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
            const body = (await res.json().catch(() => ({}))) as { transcript?: string; message?: string };
            if (!res.ok) {
              push({ who: "note", text: body.message ?? t("common.error") });
              return;
            }
            await send(body.transcript ?? "");
          });
        },
      });
      voiceRef.current = { voice, stream, ctx };
      setListening(true);
    } catch {
      void ctx.close();
      push({ who: "note", text: t("assistant.noMic") });
    }
  };
  const stopListening = async () => {
    closeMic(voiceRef.current);
    voiceRef.current = null;
    setListening(false);
    setLevel(0);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("assistant.title")}>
      <div
        className="ui-scrim"
        onClick={() => {
          void stopListening();
          onClose();
        }}
      />
      <div className="ui-sheet-up absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white text-ink shadow-[0_-12px_40px_rgba(0,0,0,.25)]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium">{t("assistant.title")}</p>
            <p className="text-xs text-ink-3">{t("assistant.hint")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void stopListening();
              onClose();
            }}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-soft"
          >
            ✕
          </button>
        </div>

        <div ref={listRef} className="flex min-h-[180px] flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {entries.length === 0 && (
            <div className="text-sm text-ink-3">
              <p>{t("assistant.examplesTitle")}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {[t("assistant.ex1"), t("assistant.ex2"), t("assistant.ex3"), t("assistant.ex4")].map((ex) => (
                  <li key={ex}>
                    <button type="button" onClick={() => void send(ex)} disabled={busy} className="rounded-md bg-soft px-2.5 py-1.5 text-start text-[13px] text-ink-2 hover:bg-black/10">
                      « {ex} »
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {entries.map((e) =>
            e.who === "me" ? (
              <p key={e.id} className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white">
                {e.text}
              </p>
            ) : e.who === "note" ? (
              <p key={e.id} className="self-center text-xs text-ink-3">
                {e.text}
              </p>
            ) : (
              <div key={e.id} className="max-w-[90%] self-start">
                {e.text && <p className={`rounded-2xl rounded-bl-sm bg-soft px-3 py-2 text-sm ${e.error ? "text-danger" : ""}`}>{e.text}</p>}
                {e.actions.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {e.actions.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <span className={a.undone ? "text-ink-3 line-through" : "text-ok"}>✓</span>
                        <span className={`min-w-0 flex-1 ${a.undone ? "text-ink-3 line-through" : "text-ink-2"}`}>{a.label}</span>
                        {!a.undone && (
                          <button type="button" onClick={() => void undo(e.id, i)} className="shrink-0 font-medium text-brand">
                            {t("assistant.undo")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {e.client.map((c, i) =>
                  c.type === "confirm_delete" ? (
                    <div key={i} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-ink-2">
                        {t("assistant.deleteAsk")} {c.names.join(", ")} ?
                      </span>
                      <button type="button" onClick={() => void confirmDelete(e.id, c.ids)} className="ui-btn h-8 bg-danger px-3 text-[12px] text-white">
                        {t("products.delete")}
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            ),
          )}
          {busy && <p className="self-start rounded-2xl bg-soft px-3 py-2 text-sm text-ink-3">…</p>}
        </div>

        <form
          className="flex items-center gap-2 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            const s = text;
            setText("");
            void send(s);
          }}
        >
          <button
            type="button"
            onClick={() => void (listening ? stopListening() : startListening())}
            aria-pressed={listening}
            aria-label={listening ? t("assistant.stop") : t("assistant.talk")}
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-colors ${listening ? "bg-danger" : "bg-navy"}`}
          >
            {listening && <span className="absolute inset-0 rounded-full bg-danger/40" style={{ transform: `scale(${1 + level * 0.6})` }} />}
            <span className="relative">
              <MicIcon />
            </span>
          </button>
          <input
            className="ui-input h-11 flex-1 text-[15px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={listening ? t("assistant.listening") : t("assistant.placeholder")}
            aria-label={t("assistant.placeholder")}
          />
          <button type="submit" disabled={!text.trim() || busy} className="ui-btn ui-btn-primary h-11 px-4">
            {t("assistant.send")}
          </button>
        </form>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="7" y="2.5" width="6" height="10" rx="3" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
    </svg>
  );
}
