"use client";

import Link from "next/link";
import { useState } from "react";
import type { Capture } from "@/lib/server/admin";

const src = (key: string) => `/api/admin/captures?key=${encodeURIComponent(key)}`;
const minutes = (s: number) => `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;

export default function Videos({ captures }: { captures: Capture[] }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const total = captures.reduce((n, c) => n + c.bytes, 0);

  return (
    <main className="mx-auto min-h-dvh max-w-5xl bg-white px-5 py-6 text-ink">
      <div className="flex items-baseline gap-4">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">Vidéos</h1>
        <Link href="/admin" className="text-sm font-medium text-brand">
          Comptes
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-3">
        {captures.length} vidéos · {(total / 1e6).toFixed(0)} Mo. Chaque session filmée est envoyée ici quand le marchand
        arrête la caméra.
      </p>

      {captures.length === 0 && <p className="mt-6 text-sm text-ink-3">Aucune vidéo pour l&apos;instant.</p>}
      <ul className="mt-4 divide-y divide-line">
        {captures.map((c) => (
          <li key={c.key} className="py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-medium">{c.store ?? c.login ?? "Compte supprimé"}</p>
                <p className="text-xs text-ink-3">
                  {c.login} · {new Date(c.uploaded).toLocaleString("fr-MA", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
              <p className="basis-32 text-xs text-ink-3 tabular-nums">
                {c.seconds ? `${minutes(c.seconds)} · ` : ""}
                {(c.bytes / 1e6).toFixed(1)} Mo
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPlaying(playing === c.key ? null : c.key)}
                  className="ui-btn ui-btn-primary h-8 px-3 text-[13px]"
                >
                  {playing === c.key ? "Fermer" : "Regarder"}
                </button>
                <a href={`${src(c.key)}&download=1`} className="ui-btn ui-btn-secondary h-8 px-3 text-[13px]">
                  Télécharger
                </a>
              </div>
            </div>
            {playing === c.key && (
              <video
                src={src(c.key)}
                controls
                autoPlay
                playsInline
                className="mt-3 max-h-[70dvh] w-full rounded-lg bg-black"
              />
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
