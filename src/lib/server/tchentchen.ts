// Card payments through Tchentchen, the owner's payment service (built before the hackathon).
// Written from Tchentchen's public API reference (https://app.tchentchen.com/docs/home.html):
// no Tchentchen code is in this repository. The server calls its HTTP API with the secret key;
// the checkout page loads its SDK with a script tag and only ever sees a client token. Server only.
//
//   POST {base}/payments                  a payment: an order's card payment, or an in-shop QR
//   GET  {base}/payments/{id}             read before trusting any amount, even after an event
//   GET  {base}/payments?reference=<id>   every payment of an order (a new one per total change)
//   POST {base}/payments/{id}/cancel      an open payment can no longer be paid
//   POST {base}/payments/{id}/refunds     a refund
//   POST /api/pay/webhook                 payment.* events, signed with the same secret key
//
// Settings: TCHENTCHEN_API_BASE (https://app.tchentchen.com/api/v1/live, or .../sandbox for
// tests), TCHENTCHEN_SECRET_KEY (a Cloudflare secret; when unset, the key saved by the Connect
// page in /admin/tchentchen), SITE_URL (the site's address, a verified website of the account).
// Without a key the card row stays hidden. Amounts cross the API in minor units: 120.50 MAD is 12050.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { NotSignedInError } from "./auth";
import type { Sql } from "./db";
import { DbNotConfiguredError, withDb } from "./db";
import { unseal } from "./secret-box";

type TctEnv = {
  TCHENTCHEN_API_BASE?: string;
  TCHENTCHEN_SECRET_KEY?: string;
  TCHENTCHEN_KEYS_SECRET?: string;
  SITE_URL?: string;
};
const env = () => getCloudflareContext().env as unknown as TctEnv;

export type Mode = "live" | "sandbox";
export type TctConfig = { base: string; origin: string; mode: Mode; key: string; keySource: "secret" | "connected"; site: string };

// https, or a local stand-in on localhost for tests.
const BASE = /^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:localhost|127\.0\.0\.1))(?::\d+)?\/api\/v1\/(live|sandbox)$/i;
const KEY_PREFIX: Record<Mode, string> = { live: "tct_live_", sandbox: "tct_test_" };
export const PAYMENT_ID = /^pay_[A-Za-z0-9_]{1,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The API address and its mode, from TCHENTCHEN_API_BASE; null when unset or malformed. */
export function tctBase() {
  const raw = env().TCHENTCHEN_API_BASE?.trim().replace(/\/+$/, "");
  const m = raw?.match(BASE);
  if (!raw || !m) return null;
  return { base: raw, origin: new URL(raw).origin, mode: m[1].toLowerCase() as Mode };
}

/** Tchentchen's own address (Connect page, SDK): the origin of the API base, by default app.tchentchen.com. */
export const tctOrigin = () => tctBase()?.origin ?? "https://app.tchentchen.com";

/** Holds the Connect page's state between /api/tchentchen/connect and /api/tchentchen/connected. */
export const CONNECT_STATE_COOKIE = "tct_connect_state";

/** The site's address (SITE_URL), an https origin; null when unset. */
export function siteUrl() {
  const raw = env().SITE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

// The key saved by the Connect page for this mode, opened with TCHENTCHEN_KEYS_SECRET. Read once
// a minute at most per Worker instance.
let connected: { at: number; mode: Mode; key: string | null } | null = null;
export const forgetConnectedKey = () => {
  connected = null;
};

async function connectedKey(mode: Mode) {
  if (connected && connected.mode === mode && Date.now() - connected.at < 60_000) return connected.key;
  const secret = env().TCHENTCHEN_KEYS_SECRET?.trim();
  let key: string | null = null;
  if (secret) {
    try {
      const [row] = await withDb((sql) => sql<{ sandbox_key: string | null; live_key: string | null }[]>`
        select sandbox_key, live_key from public.tchentchen_account where id`);
      const sealed = mode === "live" ? row?.live_key : row?.sandbox_key;
      if (sealed) key = await unseal(sealed, secret, `tchentchen:${mode}`);
    } catch (err) {
      if (!(err instanceof DbNotConfiguredError)) console.error("Tchentchen: the connected key cannot be read", err instanceof Error ? err.message : err);
    }
  }
  connected = { at: Date.now(), mode, key };
  return key;
}

/** Everything a call needs, or null when card payment is not set up (the card row stays hidden). */
export async function tctConfig(): Promise<TctConfig | null> {
  const b = tctBase();
  const site = siteUrl();
  if (!b || !site) return null;
  const fromSecret = env().TCHENTCHEN_SECRET_KEY?.trim();
  const key = fromSecret || (await connectedKey(b.mode));
  if (!key) return null;
  if (!key.startsWith(KEY_PREFIX[b.mode])) {
    // A test key on the live address (or the other way round) is refused by Tchentchen anyway.
    console.error(`Tchentchen: key ${key.slice(0, 8)}... does not match the ${b.mode} address`);
    return null;
  }
  return { ...b, key, keySource: fromSecret ? "secret" : "connected", site };
}

export class TchentchenNotConfiguredError extends Error {
  constructor() {
    super("Tchentchen is not set up: TCHENTCHEN_API_BASE, SITE_URL and a key (TCHENTCHEN_SECRET_KEY, or Connect in /admin/tchentchen).");
  }
}

export async function requireTct() {
  const cfg = await tctConfig();
  if (!cfg) throw new TchentchenNotConfiguredError();
  return cfg;
}

export const tchentchenConfigured = async () => !!(await tctConfig());

/** The browser SDK, loaded with a script tag by the checkout page. */
export const sdkUrl = (cfg: TctConfig) => `${cfg.origin}/sdk/v1/tchentchen.js`;

export class TchentchenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly param: string | null,
  ) {
    super(`Tchentchen answered ${status}${code ? ` ${code}` : ""}${param ? ` (${param})` : ""}`);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The API                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export type PaymentStatus = "open" | "processing" | "paid" | "expired" | "canceled";

export type Payment = {
  id: string;
  livemode: boolean;
  status: PaymentStatus;
  amount: number;
  amount_refunded: number;
  currency: string;
  reference: string;
  description: string | null;
  site_url: string;
  metadata: Record<string, string> | null;
  url: string;
  client_token?: string; // only in the create answer: for the page, never logged
  payment_method: { type: string; brand: string | null; last4: string | null; wallet: string | null } | null;
  expires_at: number;
  paid_at: number | null;
};

export type PaymentLine = { name: string; quantity: number; unit_amount: number; image_url?: string };

export type PaymentInput = {
  amount: number;
  currency: string;
  reference: string;
  site_url: string;
  description?: string;
  lines?: PaymentLine[];
  customer?: { name?: string; phone?: string; email?: string };
  metadata?: Record<string, string>;
  return_url?: string;
  events_url?: string;
  locale?: string;
  expires_in?: number;
};

async function call<T>(cfg: TctConfig, path: string, init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string }): Promise<T> {
  const headers: Record<string, string> = { "x-api-key": cfg.key, Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey.slice(0, 255);
  const res = await fetch(`${cfg.base}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { code?: string; param?: string } } | null;
    throw new TchentchenError(res.status, e?.error?.code ?? null, e?.error?.param ?? null);
  }
  return (await res.json()) as T;
}

const id = (paymentId: string) => {
  if (!PAYMENT_ID.test(paymentId)) throw new TchentchenError(400, "bad_payment_id", null);
  return encodeURIComponent(paymentId);
};

export const createPayment = (cfg: TctConfig, input: PaymentInput, idempotencyKey: string) =>
  call<Payment>(cfg, "/payments", { method: "POST", body: input, idempotencyKey });

export const getPayment = (cfg: TctConfig, paymentId: string) => call<Payment>(cfg, `/payments/${id(paymentId)}`, { method: "GET" });

export const listPayments = async (cfg: TctConfig, reference: string) =>
  (await call<{ data: Payment[] }>(cfg, `/payments?reference=${encodeURIComponent(reference)}`, { method: "GET" })).data ?? [];

export const cancelPayment = (cfg: TctConfig, paymentId: string) => call<Payment>(cfg, `/payments/${id(paymentId)}/cancel`, { method: "POST" });

// Refunds what is left of the payment. The idempotency key makes a retry return the same refund.
export const refundPayment = (cfg: TctConfig, paymentId: string, idempotencyKey: string) =>
  call<{ refund: { id: string; amount: number; status: string }; payment: Payment }>(cfg, `/payments/${id(paymentId)}/refunds`, {
    method: "POST",
    body: {},
    idempotencyKey,
  });

/* ------------------------------------------------------------------------------------------ */
/* Events                                                                                      */
/* ------------------------------------------------------------------------------------------ */

// X-Tct-Signature is the lowercase hex HMAC-SHA256 of "<X-Tct-Timestamp>.<raw body>", keyed by
// the secret key; refused when the timestamp is more than 5 minutes from our clock.
// crypto.subtle.verify compares in constant time.
export async function verifyEvent(headers: Headers, raw: Uint8Array, key: string) {
  const ts = headers.get("x-tct-timestamp") ?? "";
  const sig = (headers.get("x-tct-signature") ?? "").toLowerCase();
  if (!/^\d{1,12}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const prefix = new TextEncoder().encode(`${ts}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  const mac = Uint8Array.from(sig.match(/../g)!, (h) => parseInt(h, 16));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", k, mac, signed);
}

/* ------------------------------------------------------------------------------------------ */
/* Money in SmallStore's books                                                                */
/* ------------------------------------------------------------------------------------------ */

export const toMinor = (v: number | string) => Math.round(Number(v) * 100);
export const fromMinor = (v: number) => Math.round(v) / 100;

export const orderDescription = (storeName: string, number: number) => `${storeName}, commande n°${number}`.slice(0, 120);

export function sellerMetadata(store: { id: string; name: string; city: string | null }) {
  const m: Record<string, string> = { seller_id: store.id, seller_name: store.name.slice(0, 500) };
  if (store.city) m.seller_city = store.city.slice(0, 500);
  return m;
}

/** fr by default; ar reaches Stripe's card form only (Tchentchen's own pages fall back to French). */
export const payLocale = (lang: unknown) => (lang === "ar" || lang === "en" ? lang : "fr");

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/**
 * Records a payment Tchentchen says is paid (read with our key, never taken from a browser),
 * once per payment id. An order's payment counts only when its amount and currency equal the
 * order's total and the store in its metadata owns the order; an in-shop QR payment
 * ("qr_<uuid>") counts for the store in its metadata.
 */
export async function recordPaid(sql: Sql, cfg: TctConfig, p: Payment): Promise<"recorded" | "already" | "ignored"> {
  if (p.status !== "paid") return "ignored";
  const storeId = p.metadata?.seller_id ?? "";
  if (!UUID.test(storeId) || host(p.site_url) !== host(cfg.site)) {
    console.warn(`Tchentchen: paid payment ${p.id} is not one of this site's`);
    return "ignored";
  }
  return sql.begin(async (tx) => {
    let orderId: string | null = null;
    let method: "card" | "card_counter";
    if (UUID.test(p.reference)) {
      const [o] = await tx<{ id: string; total: string; currency: string }[]>`
        select id, total, currency from public.orders where id = ${p.reference}::uuid and store_id = ${storeId}::uuid for update`;
      if (!o || toMinor(o.total) !== p.amount || o.currency.toLowerCase() !== p.currency.toLowerCase()) {
        console.warn(`Tchentchen: paid payment ${p.id} does not match order ${p.reference}`);
        return "ignored";
      }
      orderId = o.id;
      method = "card";
    } else if (/^qr_[0-9a-f-]{36}$/i.test(p.reference)) {
      const [s] = await tx<{ currency: string }[]>`select currency from public.stores where id = ${storeId}::uuid`;
      if (!s || s.currency.toLowerCase() !== p.currency.toLowerCase()) return "ignored";
      method = "card_counter";
    } else {
      return "ignored";
    }
    const inserted = await tx`
      insert into public.payments (store_id, order_id, method, provider, amount, refunded, reference)
      values (${storeId}::uuid, ${orderId}::uuid, ${method}, 'tchentchen', ${fromMinor(p.amount)}, ${fromMinor(p.amount_refunded)}, ${p.id})
      on conflict (reference) where provider = 'tchentchen' do nothing
      returning id`;
    if (!inserted.length) return "already";
    if (orderId) {
      await tx`update public.orders set payment_status = 'paid' where id = ${orderId}::uuid and payment_status in ('unpaid', 'partial')`;
    }
    return "recorded";
  });
}

/** Keeps a recorded payment's refunded amount in step with Tchentchen; a fully refunded order shows as refunded. */
export async function recordRefunds(sql: Sql, p: Payment) {
  const [row] = await sql<{ order_id: string | null }[]>`
    update public.payments set refunded = least(${fromMinor(p.amount_refunded)}, amount)
    where provider = 'tchentchen' and reference = ${p.id} returning order_id`;
  if (!row?.order_id) return;
  await sql`
    update public.orders o set payment_status = 'refunded'
    where o.id = ${row.order_id}::uuid and o.payment_status <> 'refunded'
      and not exists (select 1 from public.payments x where x.order_id = o.id and x.provider = 'tchentchen' and x.refunded < x.amount)
      and exists (select 1 from public.payments x where x.order_id = o.id and x.provider = 'tchentchen')`;
}

/** Reads every payment of an order at Tchentchen and records the paid ones (the thank-you page, before a refund). */
export async function settleOrder(sql: Sql, cfg: TctConfig, orderId: string) {
  const payments = await listPayments(cfg, orderId);
  for (const p of payments) {
    if (p.reference !== orderId) continue;
    if (p.status === "paid") {
      await recordPaid(sql, cfg, p);
      if (p.amount_refunded > 0) await recordRefunds(sql, p);
    }
  }
  return payments;
}

export function payErrorResponse(err: unknown) {
  if (err instanceof TchentchenNotConfiguredError) {
    return NextResponse.json({ error: "tct_not_configured", message: "Le paiement par carte n'est pas encore connecté." }, { status: 503 });
  }
  if (err instanceof NotSignedInError) {
    return NextResponse.json({ error: "signed_out" }, { status: 401 });
  }
  if (err instanceof TchentchenError) {
    console.error(err.message);
    return NextResponse.json({ error: "tct_upstream", code: err.code, message: "Tchentchen ne répond pas. Réessayez." }, { status: 502 });
  }
  if (err instanceof DbNotConfiguredError) {
    console.error(err.message);
    return NextResponse.json({ error: "no_database" }, { status: 500 });
  }
  console.error(err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
