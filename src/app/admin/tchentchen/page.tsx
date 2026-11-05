// Platform owner: card payments through Tchentchen. Shows the mode, where the key comes from and
// whether Tchentchen accepts it, and the "Connect Tchentchen" button that fetches the keys.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminUser } from "@/lib/server/admin";
import SignOutButton from "../../SignOutButton";
import { withDb } from "@/lib/server/db";
import { listPayments, siteUrl, tctBase, tctConfig, TchentchenError } from "@/lib/server/tchentchen";

export const metadata: Metadata = { title: "Tchentchen · Admin · Tadasouk", robots: { index: false } };

type Account = { shop_url: string; has_sandbox: boolean; has_live: boolean; connected_at: Date };

const ERRORS: Record<string, string> = {
  refused: "Tchentchen n'a pas donné de code : la connexion a été annulée.",
  state: "La connexion a expiré ou ne vient pas de cette page. Recommencez.",
  no_site: "SITE_URL n'est pas réglé.",
  no_keys_secret: "Le secret TCHENTCHEN_KEYS_SECRET manque (32 caractères au moins) : les clés n'ont pas été demandées.",
  claim: "Tchentchen a refusé le code (valable 10 minutes, une seule fois). Recommencez.",
  no_keys: "Tchentchen n'a renvoyé aucune clé.",
};

export default async function TchentchenPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await adminUser())) notFound();
  const q = await searchParams;
  const env = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  const base = tctBase();
  const site = siteUrl();
  // Before the migration 20261104120000_tchentchen_payments is applied, the table is missing.
  const account = await withDb(
    (sql) => sql<Account[]>`
      select shop_url, sandbox_key is not null as has_sandbox, live_key is not null as has_live, connected_at
      from public.tchentchen_account where id`,
  ).then(
    (rows) => rows[0] ?? null,
    () => null,
  );
  const cfg = await tctConfig();

  // One read with the key: Tchentchen answers 401 to a key it does not know.
  let check: { ok: boolean; text: string } | null = null;
  if (cfg) {
    try {
      await listPayments(cfg, "tadasouk-connection-check");
      check = { ok: true, text: "Tchentchen accepte la clé." };
    } catch (err) {
      check = { ok: false, text: err instanceof TchentchenError ? err.message : "Tchentchen ne répond pas." };
    }
  }

  const rows: [string, string][] = [
    ["Mode", base ? (base.mode === "live" ? "Réel (live)" : "Test (sandbox)") : "TCHENTCHEN_API_BASE absent ou mal écrit"],
    ["Adresse de l'API", base?.base ?? "—"],
    ["Site (SITE_URL)", site ?? "absent"],
    ["Vérification du site", env.TCHENTCHEN_VERIFY_TOKEN?.trim() ? `${site ?? ""}/.well-known/tchentchen-verification.txt` : "TCHENTCHEN_VERIFY_TOKEN absent"],
    [
      "Clé utilisée",
      cfg
        ? `${cfg.key.slice(0, 8)}… (${cfg.keySource === "secret" ? "secret TCHENTCHEN_SECRET_KEY" : "connexion enregistrée"})`
        : "aucune : le paiement par carte reste caché",
    ],
    [
      "Connexion enregistrée",
      account
        ? `${account.connected_at.toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })} · ${[account.has_sandbox && "clé test", account.has_live && "clé réelle"].filter(Boolean).join(", ")}`
        : "aucune",
    ],
    ["Chiffrement des clés", env.TCHENTCHEN_KEYS_SECRET?.trim() ? "TCHENTCHEN_KEYS_SECRET présent" : "TCHENTCHEN_KEYS_SECRET absent"],
  ];

  return (
    <main className="mx-auto min-h-dvh max-w-3xl bg-white px-5 py-6 text-ink">
      <div className="flex items-baseline gap-4">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">Tchentchen</h1>
        <Link href="/admin" className="text-sm font-medium text-brand">
          Comptes
        </Link>
        <span className="ms-auto">
          <SignOutButton />
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-3">
        Les paiements par carte passent par l&apos;API publique et le SDK de Tchentchen, et arrivent sur le compte Stripe du compte
        Tchentchen connecté.
      </p>

      {q.connected && <p className="mt-4 rounded-md bg-ok/10 p-3 text-sm text-ok">Tchentchen est connecté : les clés sont enregistrées, chiffrées.</p>}
      {q.error && (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-danger">
          {ERRORS[q.error] ?? "La connexion n'a pas abouti."}
          {q.status ? ` (${q.status})` : ""}
        </p>
      )}

      <dl className="mt-5 divide-y divide-line rounded-md text-sm shadow-[0_0_0_1px_var(--line)]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-4 py-2.5">
            <dt className="w-44 shrink-0 text-ink-3">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {check && <p className={`mt-3 text-sm ${check.ok ? "text-ok" : "text-danger"}`}>{check.text}</p>}

      {/* A plain GET form, not a Link: the route redirects to Tchentchen (no client navigation, no prefetch). */}
      <form action="/api/tchentchen/connect" method="get" className="mt-6">
        <button type="submit" className="ui-btn ui-btn-primary h-11 px-5">
          Connect Tchentchen
        </button>
      </form>
      <p className="mt-2 text-[13px] text-ink-3">
        Ouvre Tchentchen, où vous choisissez le compte. Tchentchen renvoie ici une seule fois les clés test et réelle ; elles sont
        chiffrées avant d&apos;être enregistrées. Le secret TCHENTCHEN_SECRET_KEY, s&apos;il est réglé, passe avant elles.
      </p>
    </main>
  );
}
