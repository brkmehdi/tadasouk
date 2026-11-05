"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Account } from "@/lib/server/admin";
import SignOutButton from "../SignOutButton";

const METHOD: Record<string, string> = { email: "Email", google: "Google", phone: "Téléphone" };

export default function Accounts({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const pending = accounts.filter((a) => a.ai_access === "pending").length;
  const shown = filter === "pending" ? accounts.filter((a) => a.ai_access === "pending") : accounts;

  const act = async (userId: string, action: "activate" | "gift", amount?: number) => {
    setBusy(userId);
    await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action, amount }),
    });
    setBusy(null);
    router.refresh();
  };

  return (
    <main className="mx-auto min-h-dvh max-w-5xl bg-white px-5 py-6 text-ink">
      <div className="flex items-baseline gap-4">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">Comptes</h1>
        <Link href="/admin/videos" className="text-sm font-medium text-brand">
          Vidéos
        </Link>
        <Link href="/admin/tchentchen" className="text-sm font-medium text-brand">
          Tchentchen
        </Link>
        <span className="ms-auto">
          <SignOutButton />
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-3">
        {accounts.length} comptes · {pending} en attente d&apos;activation. Les 10 premiers ont reçu 2 $ d&apos;IA à
        l&apos;inscription ; activer un compte lui donne les mêmes 2 $.
      </p>
      <div className="mt-3 flex gap-2 text-[13px]">
        {(
          [
            ["all", "Tous"],
            ["pending", `En attente (${pending})`],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 ${filter === f ? "bg-ink text-white" : "bg-soft text-ink-2"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="mt-4 divide-y divide-line">
        {shown.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
            <div className="min-w-0 flex-1 basis-56">
              <p className="truncate font-medium">{a.login}</p>
              <p className="text-xs text-ink-3">
                {METHOD[a.signup_method] ?? a.signup_method} · {new Date(a.created_at).toLocaleDateString("fr-MA")}
                {a.role === "admin" ? " · admin" : ""}
              </p>
            </div>
            <div className="min-w-0 basis-40">
              <p className="truncate">{a.store ?? <span className="text-ink-3">Pas de boutique</span>}</p>
              {a.store && (
                <p className="text-xs text-ink-3">
                  {a.products} produits · {a.published ? "en ligne" : "pas en ligne"}
                </p>
              )}
            </div>
            <div className="basis-32 text-xs tabular-nums">
              <p>Solde IA {Number(a.balance_usd).toFixed(2)} $</p>
              <p className="text-ink-3">Dépensé {Number(a.spent_usd).toFixed(2)} $</p>
            </div>
            <div className="flex items-center gap-2">
              {a.ai_access === "pending" ? (
                <button
                  type="button"
                  disabled={busy === a.id}
                  onClick={() => void act(a.id, "activate")}
                  className="ui-btn ui-btn-primary h-8 px-3 text-[13px]"
                >
                  Activer (2 $)
                </button>
              ) : (
                <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[11px] font-medium text-ok">Actif</span>
              )}
              <button
                type="button"
                disabled={busy === a.id}
                onClick={() => {
                  const v = prompt("Crédit IA à offrir, en dollars", "5");
                  if (v) void act(a.id, "gift", Number(v.replace(",", ".")));
                }}
                className="ui-btn ui-btn-secondary h-8 px-3 text-[13px]"
              >
                Offrir
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
